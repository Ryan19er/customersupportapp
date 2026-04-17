// Anthropic chat proxy + runtime RAG composer.
//
// This edge function is the single source of truth for how runtime context
// is assembled. Flutter sends the raw user/assistant history and a resolver
// payload; we (a) resolve the product + symptoms, (b) call the retrieve
// function for ranked evidence, (c) build the final system prompt with a
// numbered EVIDENCE block, (d) call Anthropic, and (e) write one row to
// public.answer_audit so every reply is traceable.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

import { resolveProduct } from "../_shared/resolve_product.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

type IncomingMessage = {
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
};

type ResolverPayload = {
  session_channel?: "support" | "auth" | "training";
  session_id?: string;
  include_runtime_context?: boolean;
  rag_enabled?: boolean; // default true; flip to false for A/B
};

type EvidenceRow = {
  idx: number;
  type: "chunk" | "canonical" | "snippet" | string;
  id: string;
  document_id: string | null;
  text: string;
  heading: string | null;
  product_slug: string | null;
  subsystem: string | null;
  symptom_tags: string[];
  error_codes: string[];
  score: number;
  scores: { vector: number; lexical: number; tag: number };
};

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const DEFAULT_MODEL = "claude-sonnet-4-6";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "content-type": "application/json",
    },
  });
}

async function fetchProfileBlock(db: ReturnType<typeof createClient>, resolver: ResolverPayload): Promise<string> {
  if (!resolver.session_id) return "";
  if (resolver.session_channel === "support") {
    const { data: s } = await db
      .from("support_chat_sessions")
      .select("contact_id, chat_contacts(full_name,email,phone,machine_model,machine_serial)")
      .eq("id", resolver.session_id)
      .maybeSingle();
    const c: any = (s as any)?.chat_contacts;
    if (!c) return "";
    return [
      "This is who you are talking to (saved app profile — use it so you know it is the same user):",
      ` Name: ${c.full_name ?? "—"}`,
      ` Email (contact): ${c.email ?? "—"}`,
      ` Phone: ${c.phone ?? "—"}`,
      ` Machine model: ${c.machine_model ?? "—"}`,
      ` Serial: ${c.machine_serial ?? "—"}`,
    ].join("\n");
  }
  if (resolver.session_channel === "auth") {
    const { data: s } = await db
      .from("chat_sessions")
      .select("user_id")
      .eq("id", resolver.session_id)
      .maybeSingle();
    const userId = (s as any)?.user_id;
    if (!userId) return "";
    const { data: p } = await db
      .from("profiles")
      .select("full_name,contact_email,phone,machine_model,machine_serial,company_name")
      .eq("id", userId)
      .maybeSingle();
    if (!p) return "";
    return [
      "This is who you are talking to (saved app profile — use it so you know it is the same user):",
      ` Name: ${(p as any).full_name ?? "—"}`,
      ` Email (contact): ${(p as any).contact_email ?? "—"}`,
      (p as any).company_name ? ` Company: ${(p as any).company_name}` : "",
      ` Phone: ${(p as any).phone ?? "—"}`,
      ` Machine model: ${(p as any).machine_model ?? "—"}`,
      ` Serial: ${(p as any).machine_serial ?? "—"}`,
    ]
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function messagesToTextWindow(messages: IncomingMessage[], limit = 8): { lastUser: string; recent: string } {
  const texts = messages.map((m) => ({
    role: m.role,
    text: (m.content ?? []).map((c) => c?.text ?? "").join(" ").trim(),
  }));
  const tail = texts.slice(-limit);
  const lastUser = [...tail].reverse().find((t) => t.role === "user")?.text ?? "";
  const recent = tail.map((t) => `${t.role}: ${t.text}`).join("\n");
  return { lastUser, recent };
}

async function embedQueryDirect(query: string): Promise<number[] | null> {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url) return null;
  const bearer = Deno.env.get("SUPABASE_ANON_KEY") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const fnUrl = `${url.replace(/\/+$/, "")}/functions/v1/embed`;
  try {
    const resp = await fetch(fnUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${bearer}`,
      },
      body: JSON.stringify({ input: [query.slice(0, 8000)] }),
    });
    const raw = await resp.text();
    if (!resp.ok) {
      console.warn("[chat] embed failed", resp.status, raw.slice(0, 200));
      return null;
    }
    const parsed = JSON.parse(raw);
    const vec = parsed?.vectors?.[0];
    return Array.isArray(vec) ? vec : null;
  } catch (e) {
    console.warn("[chat] embed threw", (e as Error).message);
    return null;
  }
}

async function fetchRetrieval(params: {
  db: ReturnType<typeof createClient>;
  query: string;
  product_slug: string | null;
  symptom_tags: string[];
  error_codes: string[];
  session_id?: string;
}): Promise<EvidenceRow[]> {
  const vec = await embedQueryDirect(params.query);
  if (!vec) {
    console.warn("[chat] retrieval skipped: no embedding");
    return [];
  }
  const limit = 10;
  const { data, error } = await params.db.rpc("retrieve_knowledge", {
    p_query_embedding: vec,
    p_query_text: params.query,
    p_product_slug: params.product_slug,
    p_symptom_tags: params.symptom_tags ?? [],
    p_error_codes: params.error_codes ?? [],
    p_limit: limit,
  });
  if (error) {
    console.warn("[chat] retrieve_knowledge rpc error", error.message);
    return [];
  }
  const rows = (data as any[] | null) ?? [];
  return rows.map((r, idx) => ({
    idx: idx + 1,
    type: r.source_type as string,
    id: r.source_id as string,
    document_id: r.document_id as string | null,
    text: String(r.text ?? "").slice(0, 1800),
    heading: r.heading ?? null,
    product_slug: r.product_slug ?? null,
    subsystem: r.subsystem ?? null,
    symptom_tags: r.symptom_tags ?? [],
    error_codes: r.error_codes ?? [],
    score: Number(r.total_score ?? 0),
    scores: {
      vector: Number(r.vector_score ?? 0),
      lexical: Number(r.lexical_score ?? 0),
      tag: Number(r.tag_score ?? 0),
    },
  }));
}

function renderEvidenceBlock(rows: EvidenceRow[]): string {
  if (!rows.length) return "### EVIDENCE\n(no retrieved evidence — ask customer for model/serial before giving machine-specific facts)";
  const lines = ["### EVIDENCE (cite as [E1], [E2], ... in your answer)"];
  for (const r of rows) {
    const header =
      `[E${r.idx}] type=${r.type} product=${r.product_slug ?? "general"}` +
      (r.subsystem ? ` subsystem=${r.subsystem}` : "") +
      (r.heading ? ` · ${r.heading}` : "");
    lines.push(header);
    lines.push(r.text.slice(0, 1400));
    lines.push("");
  }
  return lines.join("\n").trim();
}

async function writeAnswerAudit(params: {
  db: ReturnType<typeof createClient>;
  resolver: ResolverPayload;
  productSlug: string | null;
  userQuery: string;
  assistantText: string;
  evidence: EvidenceRow[];
  resolverMeta: Record<string, unknown>;
  promptVersionId: string | null;
  model: string;
  latencyMs: number;
}): Promise<string | null> {
  try {
    const { data } = await params.db
      .from("answer_audit")
      .insert({
        session_channel: params.resolver.session_channel ?? "support",
        session_id: params.resolver.session_id ?? null,
        product_slug: params.productSlug,
        user_query: params.userQuery.slice(0, 8000),
        assistant_text: params.assistantText.slice(0, 16000),
        resolver_meta: params.resolverMeta,
        evidence: params.evidence.map((e) => ({
          idx: e.idx,
          type: e.type,
          id: e.id,
          document_id: e.document_id,
          heading: e.heading,
          product_slug: e.product_slug,
          subsystem: e.subsystem,
          score: e.score,
          scores: e.scores,
        })),
        prompt_version_id: params.promptVersionId,
        model: params.model,
        latency_ms: params.latencyMs,
      })
      .select("id")
      .single();
    return (data as any)?.id ?? null;
  } catch {
    return null;
  }
}

// Fire-and-forget grader invocation (best-effort, non-blocking for the reply).
function scheduleGrade(auditId: string): void {
  const url = Deno.env.get("SUPABASE_URL") ?? "";
  if (!url || !auditId) return;
  const bearer = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || Deno.env.get("SUPABASE_ANON_KEY") || "";
  const fnUrl = `${url.replace(/\/+$/, "")}/functions/v1/grade-answer`;
  const promise = fetch(fnUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${bearer}`,
      apikey: bearer,
    },
    body: JSON.stringify({ audit_id: auditId }),
  })
    .then(async (r) => {
      const t = await r.text().catch(() => "");
      if (!r.ok) console.warn("[chat] grader http", r.status, t.slice(0, 200));
    })
    .catch((e) => console.warn("[chat] grader threw", (e as Error).message));

  // Supabase Edge Runtime exposes EdgeRuntime.waitUntil() for background tasks
  // that need to outlive the response. Bare fire-and-forget gets killed when
  // the response flushes.
  // deno-lint-ignore no-explicit-any
  const er = (globalThis as any).EdgeRuntime;
  if (er && typeof er.waitUntil === "function") {
    try { er.waitUntil(promise); } catch { /* ignore */ }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  if (!apiKey) {
    return json({ error: "Missing ANTHROPIC_API_KEY secret on Supabase Edge Functions." }, 500);
  }

  let payload: {
    model?: string;
    max_tokens?: number;
    system?: string;
    messages?: IncomingMessage[];
    resolver?: ResolverPayload;
  };

  try {
    payload = await req.json();
  } catch (_) {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  if (!messages.length) {
    return json({ error: "messages is required" }, 400);
  }

  const resolver = payload.resolver ?? {};
  // RAG_MODE env is the kill switch. Values: "on" (default), "off", "shadow".
  // - on:     evidence is attached to the prompt and returned to clients.
  // - shadow: retrieval still runs + audit captures it, but the prompt does not
  //           include the evidence block (used for dual-run regression checks).
  // - off:    retrieval is skipped entirely.
  const ragMode = (Deno.env.get("RAG_MODE") ?? "on").toLowerCase();
  const ragEnabled = resolver.rag_enabled !== false && ragMode !== "off";
  const ragInjectIntoPrompt = ragEnabled && ragMode !== "shadow";
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const supabaseKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const db = supabaseUrl && supabaseKey ? createClient(supabaseUrl, supabaseKey) : null;

  // --- Step 1: assemble conversation window + profile ---------------------
  const { lastUser, recent } = messagesToTextWindow(messages);
  let profileBlock = "";
  if (db && resolver.include_runtime_context && resolver.session_channel && resolver.session_id) {
    profileBlock = await fetchProfileBlock(db, resolver);
  }

  // --- Step 2: deterministic product resolver -----------------------------
  const resolved = await resolveProduct({
    db,
    profileBlock,
    recentConversation: recent,
    currentUserMessage: lastUser,
  });

  // --- Step 3: ranked retrieval ------------------------------------------
  let evidence: EvidenceRow[] = [];
  if (ragEnabled && lastUser && db) {
    evidence = await fetchRetrieval({
      db,
      query: lastUser,
      product_slug: resolved.product_slug,
      symptom_tags: resolved.symptom_tags,
      error_codes: resolved.error_codes,
      session_id: resolver.session_id,
    });
  }

  // --- Step 4: fetch active prompt version (audit + system prompt) -------
  let activePromptRow: { id: string; markdown_content: string } | null = null;
  if (db && resolver.include_runtime_context) {
    const { data } = await db
      .from("prompt_versions")
      .select("id, markdown_content")
      .eq("prompt_key", "support-system")
      .eq("is_active", true)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    activePromptRow = (data as any) ?? null;
  }

  // --- Step 5: fetch canonical list for the resolved product (always on top) ---
  let canonicalBlock = "";
  if (db && resolver.include_runtime_context) {
    const q = db
      .from("canonical_knowledge")
      .select("id,title,law_text,product_slug,machine_model,status")
      .eq("status", "active")
      .order("created_at", { ascending: false })
      .limit(40);
    const { data: canonical } = await q;
    const lines = (canonical ?? [])
      .filter((r: any) => {
        if (!resolved.product_slug) return true;
        return !r.product_slug || r.product_slug === resolved.product_slug;
      })
      .slice(0, 20)
      .map((r: any) => `- ${r.title}: ${String(r.law_text).slice(0, 600)}`);
    canonicalBlock = lines.length
      ? ["### Canonical admin corrections (must follow)", ...lines].join("\n")
      : "";
  }

  // --- Step 6: build merged system prompt --------------------------------
  const resolverBlock = resolved.product_slug
    ? `### RESOLVED CONTEXT\nproduct=${resolved.product_slug}${resolved.subsystem ? ` subsystem=${resolved.subsystem}` : ""}${resolved.error_codes.length ? ` error_codes=${resolved.error_codes.join(",")}` : ""}${resolved.symptom_tags.length ? ` symptoms=${resolved.symptom_tags.join(",")}` : ""}`
    : (resolved.confidence < 0.5
      ? "### RESOLVED CONTEXT\nproduct=UNKNOWN — if the customer's question is machine-specific, ask them which Stealth model + serial they're working on before answering."
      : "");

  const evidenceBlock = ragInjectIntoPrompt ? renderEvidenceBlock(evidence) : "";

  const runtimeAddon = [
    activePromptRow?.markdown_content ?? "",
    profileBlock,
    resolverBlock,
    canonicalBlock,
    evidenceBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const mergedSystem = [payload.system || "", runtimeAddon].filter(Boolean).join("\n\n");

  // --- Step 7: call Anthropic --------------------------------------------
  const body = {
    model: payload.model || DEFAULT_MODEL,
    max_tokens: typeof payload.max_tokens === "number" ? payload.max_tokens : 4096,
    system: mergedSystem,
    messages,
  };

  const startedAt = Date.now();
  const upstream = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  });
  const latencyMs = Date.now() - startedAt;

  const raw = await upstream.text();
  let parsed: any = null;
  try {
    parsed = raw ? JSON.parse(raw) : null;
  } catch (_) {
    parsed = null;
  }

  if (!upstream.ok) {
    const detail = parsed?.error?.message || parsed?.message || raw ||
      `Anthropic HTTP ${upstream.status}`;
    return json({ error: detail, status: upstream.status }, upstream.status);
  }

  const text = parsed?.content?.[0]?.text;
  if (typeof text !== "string" || !text.trim()) {
    return json({ error: "Anthropic response missing text content", raw: parsed ?? raw }, 502);
  }

  // --- Step 8: persist answer_audit + schedule grader --------------------
  const resolverMeta = {
    product_slug: resolved.product_slug,
    machine_family: resolved.machine_family,
    subsystem: resolved.subsystem,
    error_codes: resolved.error_codes,
    symptom_tags: resolved.symptom_tags,
    confidence: resolved.confidence,
    evidence_trace: resolved.evidence,
    prompt_version_id: activePromptRow?.id ?? null,
    rag_enabled: ragEnabled,
    rag_mode: ragMode,
    rag_injected_into_prompt: ragInjectIntoPrompt,
  };

  let auditId: string | null = null;
  if (db) {
    auditId = await writeAnswerAudit({
      db,
      resolver,
      productSlug: resolved.product_slug,
      userQuery: lastUser,
      assistantText: text,
      evidence,
      resolverMeta,
      promptVersionId: activePromptRow?.id ?? null,
      model: body.model,
      latencyMs,
    });
    if (auditId) scheduleGrade(auditId);
  }

  return json({
    text,
    model: body.model,
    resolver_meta: { ...resolverMeta, audit_id: auditId, evidence_count: evidence.length },
    evidence: evidence.map((e) => ({
      idx: e.idx,
      type: e.type,
      id: e.id,
      heading: e.heading,
      product_slug: e.product_slug,
      subsystem: e.subsystem,
      score: e.score,
    })),
  });
});
