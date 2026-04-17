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
  // Populated by enrichEvidenceWithDocuments() when the evidence points at a
  // public/signed document URL. The chat bot surfaces this as a tap-to-open
  // download link in the customer's reply.
  document_title?: string | null;
  file_url?: string | null;
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

// Latency matters here: every char we stuff into the prompt is time Claude
// spends reading before the first token comes back. Keep the top-N most
// relevant chunks, trimmed. Anything below the cutoff rarely helps the
// answer.
const EVIDENCE_MAX_CHUNKS = 6;
const EVIDENCE_CHUNK_CHARS = 900;

function renderEvidenceBlock(rows: EvidenceRow[]): string {
  if (!rows.length) return "### EVIDENCE\n(no retrieved evidence — ask customer for model/serial before giving machine-specific facts)";
  const trimmed = rows.slice(0, EVIDENCE_MAX_CHUNKS);
  const lines = ["### EVIDENCE (cite as [E1], [E2], ... in your answer)"];
  for (const r of trimmed) {
    const header =
      `[E${r.idx}] type=${r.type} product=${r.product_slug ?? "general"}` +
      (r.subsystem ? ` subsystem=${r.subsystem}` : "") +
      (r.heading ? ` · ${r.heading}` : "");
    lines.push(header);
    if (r.file_url) {
      const title = r.document_title ?? r.heading ?? "document";
      lines.push(`DOWNLOAD: [${title}](${r.file_url})`);
    }
    lines.push(r.text.slice(0, EVIDENCE_CHUNK_CHARS));
    lines.push("");
  }
  return lines.join("\n").trim();
}

/// Renders a compact list of all distinct downloadable docs that backed the
/// answer. The customer-facing prompt tells Claude to offer these as tappable
/// links at the end of its reply so users can open manuals on their phone
/// instead of hunting through a separate tab.
function renderDownloadsBlock(rows: EvidenceRow[]): string {
  const seen = new Set<string>();
  const items: string[] = [];
  for (const r of rows) {
    if (!r.file_url) continue;
    if (seen.has(r.file_url)) continue;
    seen.add(r.file_url);
    const title = r.document_title ?? r.heading ?? "Document";
    items.push(`- [${title}](${r.file_url})`);
  }
  if (!items.length) return "";
  return [
    "### AVAILABLE DOWNLOADS",
    "When one of these is relevant to the customer's question, offer it at the",
    "end of your reply as a tappable markdown link. Example:",
    "  You can download the full manual here: [SS3015CP Operator Manual](https://...)",
    "Only surface a link when it actually helps the customer's current issue.",
    ...items,
  ].join("\n");
}

/// Loads `knowledge_documents.display_title` + `file_url` for every unique
/// document_id referenced by the retrieved chunks, in one round-trip. Keeps
/// the per-turn latency flat even with many chunks.
async function enrichEvidenceWithDocuments(
  db: ReturnType<typeof createClient>,
  rows: EvidenceRow[],
): Promise<void> {
  const ids = Array.from(
    new Set(rows.map((r) => r.document_id).filter((x): x is string => !!x)),
  );
  if (!ids.length) return;
  const { data, error } = await db
    .from("knowledge_documents")
    .select("id, title, display_title, file_url")
    .in("id", ids);
  if (error || !data) return;
  const byId = new Map<string, { title: string | null; file_url: string | null }>();
  for (const d of data as any[]) {
    byId.set(d.id, {
      title: d.display_title ?? d.title ?? null,
      file_url: d.file_url ?? null,
    });
  }
  for (const r of rows) {
    if (!r.document_id) continue;
    const meta = byId.get(r.document_id);
    if (!meta) continue;
    r.document_title = meta.title;
    r.file_url = meta.file_url;
  }
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

  // --- Step 1: assemble conversation window + kick off independent work -----
  // Everything that doesn't depend on the resolved product_slug runs in
  // parallel. Previously these were sequential and added ~1-2s of dead
  // time before Claude even started generating.
  const { lastUser, recent } = messagesToTextWindow(messages);

  const profilePromise: Promise<string> =
    db && resolver.include_runtime_context && resolver.session_channel && resolver.session_id
      ? fetchProfileBlock(db, resolver)
      : Promise.resolve("");

  // Query embedding doesn't depend on the resolver — start immediately.
  const embeddingPromise: Promise<number[] | null> = ragEnabled && lastUser
    ? embedQueryDirect(lastUser)
    : Promise.resolve(null);

  const promptVersionPromise: Promise<{ id: string; markdown_content: string } | null> =
    db && resolver.include_runtime_context
      ? db
          .from("prompt_versions")
          .select("id, markdown_content")
          .eq("prompt_key", "support-system")
          .eq("is_active", true)
          .order("version", { ascending: false })
          .limit(1)
          .maybeSingle()
          .then(({ data }) => (data as any) ?? null)
      : Promise.resolve(null);

  const canonicalRowsPromise: Promise<any[]> =
    db && resolver.include_runtime_context
      ? db
          .from("canonical_knowledge")
          .select("id,title,law_text,product_slug,machine_model,status")
          .eq("status", "active")
          .order("created_at", { ascending: false })
          .limit(40)
          .then(({ data }) => (data as any[]) ?? [])
      : Promise.resolve([]);

  const profileBlock = await profilePromise;

  // --- Step 2: deterministic product resolver (needs profileBlock) ---------
  const resolved = await resolveProduct({
    db,
    profileBlock,
    recentConversation: recent,
    currentUserMessage: lastUser,
  });

  // --- Step 3: ranked retrieval (needs embedding + resolver) ---------------
  const [vec, activePromptRow, canonicalRows] = await Promise.all([
    embeddingPromise,
    promptVersionPromise,
    canonicalRowsPromise,
  ]);

  let evidence: EvidenceRow[] = [];
  if (ragEnabled && lastUser && db && vec) {
    const { data, error } = await db.rpc("retrieve_knowledge", {
      p_query_embedding: vec,
      p_query_text: lastUser,
      p_product_slug: resolved.product_slug,
      p_symptom_tags: resolved.symptom_tags ?? [],
      p_error_codes: resolved.error_codes ?? [],
      p_limit: 10,
    });
    if (error) {
      console.warn("[chat] retrieve_knowledge rpc error", error.message);
    } else {
      const rows = (data as any[] | null) ?? [];
      evidence = rows.map((r, idx) => ({
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
      // One batched lookup to attach document title + file_url (if present)
      // so the bot can offer downloads inline.
      await enrichEvidenceWithDocuments(db, evidence);
    }
  }

  // --- Step 5: canonical block (already prefetched, just filter+format) ---
  const canonicalLines = canonicalRows
    .filter((r: any) => {
      if (!resolved.product_slug) return true;
      return !r.product_slug || r.product_slug === resolved.product_slug;
    })
    .slice(0, 20)
    .map((r: any) => `- ${r.title}: ${String(r.law_text).slice(0, 600)}`);
  const canonicalBlock = canonicalLines.length
    ? ["### Canonical admin corrections (must follow)", ...canonicalLines].join("\n")
    : "";

  // --- Step 6: build merged system prompt --------------------------------
  const resolverBlock = resolved.product_slug
    ? `### RESOLVED CONTEXT\nproduct=${resolved.product_slug}${resolved.subsystem ? ` subsystem=${resolved.subsystem}` : ""}${resolved.error_codes.length ? ` error_codes=${resolved.error_codes.join(",")}` : ""}${resolved.symptom_tags.length ? ` symptoms=${resolved.symptom_tags.join(",")}` : ""}`
    : (resolved.confidence < 0.5
      ? "### RESOLVED CONTEXT\nproduct=UNKNOWN — if the customer's question is machine-specific, ask them which Stealth model + serial they're working on before answering."
      : "");

  const evidenceBlock = ragInjectIntoPrompt ? renderEvidenceBlock(evidence) : "";
  const downloadsBlock = ragInjectIntoPrompt ? renderDownloadsBlock(evidence) : "";

  const runtimeAddon = [
    activePromptRow?.markdown_content ?? "",
    profileBlock,
    resolverBlock,
    canonicalBlock,
    evidenceBlock,
    downloadsBlock,
  ]
    .filter(Boolean)
    .join("\n\n");

  const mergedSystem = [payload.system || "", runtimeAddon].filter(Boolean).join("\n\n");

  // --- Step 7: call Anthropic --------------------------------------------
  // Default max_tokens dropped 4096 -> 1024. Customer-support replies are
  // almost always short; the old ceiling made the model spend extra time
  // planning a longer answer than needed.
  const wantsStream = (payload as any).stream === true;
  const body = {
    model: payload.model || DEFAULT_MODEL,
    max_tokens: typeof payload.max_tokens === "number" ? payload.max_tokens : 1024,
    system: mergedSystem,
    messages,
    ...(wantsStream ? { stream: true } : {}),
  };

  const startedAt = Date.now();
  const upstream = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
      ...(wantsStream ? { accept: "text/event-stream" } : {}),
    },
    body: JSON.stringify(body),
  });

  if (!upstream.ok) {
    const raw = await upstream.text();
    let detail = `Anthropic HTTP ${upstream.status}`;
    try {
      const parsed = raw ? JSON.parse(raw) : null;
      detail = parsed?.error?.message || parsed?.message || raw || detail;
    } catch (_) {
      detail = raw || detail;
    }
    return json({ error: detail, status: upstream.status }, upstream.status);
  }

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

  const evidenceSummary = evidence.map((e) => ({
    idx: e.idx,
    type: e.type,
    id: e.id,
    heading: e.heading,
    product_slug: e.product_slug,
    subsystem: e.subsystem,
    score: e.score,
    document_title: e.document_title ?? null,
    file_url: e.file_url ?? null,
  }));

  // --- Non-streaming path (backward compat) ------------------------------
  if (!wantsStream) {
    const raw = await upstream.text();
    const latencyMs = Date.now() - startedAt;
    let parsed: any = null;
    try { parsed = raw ? JSON.parse(raw) : null; } catch (_) { parsed = null; }
    const text = parsed?.content?.[0]?.text;
    if (typeof text !== "string" || !text.trim()) {
      return json({ error: "Anthropic response missing text content", raw: parsed ?? raw }, 502);
    }
    let auditId: string | null = null;
    if (db) {
      auditId = await writeAnswerAudit({
        db, resolver, productSlug: resolved.product_slug,
        userQuery: lastUser, assistantText: text, evidence, resolverMeta,
        promptVersionId: activePromptRow?.id ?? null, model: body.model, latencyMs,
      });
      if (auditId) scheduleGrade(auditId);
    }
    return json({
      text,
      model: body.model,
      resolver_meta: { ...resolverMeta, audit_id: auditId, evidence_count: evidence.length },
      evidence: evidenceSummary,
    });
  }

  // --- Streaming path (SSE passthrough) ----------------------------------
  // We forward Anthropic's SSE stream to the client using our own compact
  // event schema (start/delta/done/error), and persist the audit + kick
  // off the grader after the stream closes. This is the big latency win:
  // the customer sees tokens ~500-800ms after send instead of waiting for
  // the full 5-10s generation.
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let acc = "";

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      send("start", { model: body.model });

      const reader = upstream.body?.getReader();
      if (!reader) {
        send("error", { message: "No upstream stream" });
        controller.close();
        return;
      }

      let buf = "";
      try {
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          // Anthropic SSE events are separated by \n\n.
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const lines = part.split("\n");
            let evt = "";
            let dataLine = "";
            for (const line of lines) {
              if (line.startsWith("event:")) evt = line.slice(6).trim();
              else if (line.startsWith("data:")) dataLine += line.slice(5).trim();
            }
            if (!dataLine) continue;
            let parsed: any = null;
            try { parsed = JSON.parse(dataLine); } catch (_) { continue; }
            if (evt === "content_block_delta" && parsed?.delta?.type === "text_delta") {
              const chunk = String(parsed.delta.text ?? "");
              if (chunk) {
                acc += chunk;
                send("delta", { text: chunk });
              }
            } else if (evt === "message_stop") {
              // emitted below in finally
            }
          }
        }
      } catch (err) {
        send("error", { message: (err as Error).message });
      }

      const latencyMs = Date.now() - startedAt;

      // Fire-and-forget audit + grader so we don't hold the stream open.
      const persist = async () => {
        if (!db || !acc.trim()) return;
        try {
          const auditId = await writeAnswerAudit({
            db, resolver, productSlug: resolved.product_slug,
            userQuery: lastUser, assistantText: acc, evidence, resolverMeta,
            promptVersionId: activePromptRow?.id ?? null, model: body.model, latencyMs,
          });
          if (auditId) scheduleGrade(auditId);
        } catch (err) {
          console.warn("[chat] audit persist failed", (err as Error).message);
        }
      };
      // @ts-ignore — EdgeRuntime is provided by Supabase Edge Functions.
      if (typeof EdgeRuntime !== "undefined" && EdgeRuntime.waitUntil) {
        // @ts-ignore
        EdgeRuntime.waitUntil(persist());
      } else {
        persist();
      }

      send("done", {
        model: body.model,
        resolver_meta: { ...resolverMeta, evidence_count: evidence.length },
        evidence: evidenceSummary,
        latency_ms: latencyMs,
      });
      controller.close();
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      ...corsHeaders,
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      "x-accel-buffering": "no",
    },
  });
});
