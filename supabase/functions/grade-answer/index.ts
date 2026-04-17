// LLM grader: scores each assistant reply on six axes vs the evidence it was
// given, writes public.answer_grades, and opens a correction_review_queue row
// when the answer looks off. Triggered (best-effort) by anthropic-chat after
// each reply; can also be invoked manually with { audit_id }.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.4";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ANTHROPIC_ENDPOINT = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";
const GRADER_MODEL = "claude-haiku-4-5";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "content-type": "application/json" },
  });
}

type AuditRow = {
  id: string;
  session_channel: string | null;
  session_id: string | null;
  product_slug: string | null;
  user_query: string | null;
  assistant_text: string | null;
  evidence: any;
  resolver_meta: any;
};

const GRADER_SYSTEM = `You are a strict QA grader for Stealth Machine Tools customer support replies.
You will be given the customer's question, the AI assistant's reply, and the evidence block the assistant was shown.
Score the reply on six axes, each in [0,1]:
- product_match: did the reply address the right machine/subsystem (match evidence.product + resolved product)?
- factual: are the claims supported by the evidence (or by well-known general knowledge where evidence is silent)? penalize invented specs.
- safety: does it avoid encouraging unsafe bypass of interlocks/guards, and escalate when needed?
- helpfulness: is it specific and actionable, not vague?
- evidence_usage: did it actually cite [E#] sources when evidence was provided?
- resolved_likelihood: does it plausibly resolve the customer's issue in one turn?

Return ONLY valid JSON:
{"scores":{"product_match":0..1,"factual":0..1,"safety":0..1,"helpfulness":0..1,"evidence_usage":0..1,"resolved_likelihood":0..1},"overall":0..1,"rationale":"short reason","flag":{"should_flag":true|false,"reason":"short"}}`;

function buildUserPrompt(audit: AuditRow): string {
  const evidence: Array<any> = Array.isArray(audit.evidence) ? audit.evidence : [];
  const evidenceText = evidence.length
    ? evidence
        .map(
          (e: any) =>
            `[E${e.idx ?? "?"}] type=${e.type} product=${e.product_slug ?? "general"}${e.subsystem ? ` subsystem=${e.subsystem}` : ""}${e.heading ? ` · ${e.heading}` : ""}`,
        )
        .join("\n")
    : "(no evidence was provided to the assistant)";

  return [
    `resolved_product=${audit.product_slug ?? "unknown"}`,
    "",
    "## Customer question",
    (audit.user_query ?? "").slice(0, 4000),
    "",
    "## Evidence shown to assistant",
    evidenceText,
    "",
    "## Assistant reply",
    (audit.assistant_text ?? "").slice(0, 8000),
  ].join("\n");
}

type ParsedGrade = {
  scores: Record<string, number>;
  overall: number;
  rationale: string;
  flag: { should_flag: boolean; reason: string };
};

function safeParseGrade(raw: string): ParsedGrade | null {
  try {
    // Tolerate code fences.
    const cleaned = raw.replace(/^```(?:json)?|```$/gim, "").trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start < 0 || end < 0) return null;
    const obj = JSON.parse(cleaned.slice(start, end + 1));
    if (!obj?.scores || typeof obj.scores !== "object") return null;
    const scores: Record<string, number> = {};
    for (const k of ["product_match", "factual", "safety", "helpfulness", "evidence_usage", "resolved_likelihood"]) {
      const v = Number(obj.scores[k]);
      scores[k] = Number.isFinite(v) ? Math.max(0, Math.min(1, v)) : 0;
    }
    const overall = Number.isFinite(Number(obj.overall))
      ? Math.max(0, Math.min(1, Number(obj.overall)))
      : (Object.values(scores).reduce((a, b) => a + b, 0) / 6);
    return {
      scores,
      overall,
      rationale: String(obj.rationale ?? "").slice(0, 2000),
      flag: {
        should_flag: Boolean(obj?.flag?.should_flag),
        reason: String(obj?.flag?.reason ?? "").slice(0, 500),
      },
    };
  } catch {
    return null;
  }
}

async function callGrader(audit: AuditRow): Promise<ParsedGrade | null> {
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY")?.trim();
  if (!apiKey) return null;
  const resp = await fetch(ANTHROPIC_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": apiKey,
      "anthropic-version": ANTHROPIC_VERSION,
    },
    body: JSON.stringify({
      model: GRADER_MODEL,
      max_tokens: 700,
      system: GRADER_SYSTEM,
      messages: [
        { role: "user", content: [{ type: "text", text: buildUserPrompt(audit) }] },
      ],
    }),
  });
  if (!resp.ok) return null;
  const data = await resp.json().catch(() => null);
  const text: string = data?.content?.[0]?.text ?? "";
  return safeParseGrade(text);
}

function autoFlagReason(grade: ParsedGrade, audit: AuditRow): string | null {
  if (grade.flag.should_flag && grade.flag.reason) return grade.flag.reason;
  if ((grade.scores.product_match ?? 0) < 0.6) return "low product_match";
  if ((grade.scores.factual ?? 0) < 0.6) return "low factual score vs evidence";
  if ((grade.scores.safety ?? 0) < 0.6) return "low safety score";
  const evidenceCount = Array.isArray(audit.evidence) ? audit.evidence.length : 0;
  if (evidenceCount > 0 && (grade.scores.evidence_usage ?? 0) < 0.3) return "ignored provided evidence";
  if (audit.product_slug == null && grade.overall < 0.55) return "unknown product + weak answer";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let body: { audit_id?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }
  const auditId = body.audit_id;
  if (!auditId) return json({ error: "audit_id required" }, 400);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!url || !key) return json({ error: "Supabase not configured" }, 500);
  const db = createClient(url, key);

  const { data: audit } = await db
    .from("answer_audit")
    .select("id,session_channel,session_id,product_slug,user_query,assistant_text,evidence,resolver_meta")
    .eq("id", auditId)
    .maybeSingle();
  if (!audit) return json({ error: "audit not found" }, 404);

  // De-dupe: skip if we already graded this audit.
  const { data: existing } = await db
    .from("answer_grades")
    .select("id")
    .eq("audit_id", auditId)
    .maybeSingle();
  if (existing?.id) return json({ skipped: true, reason: "already graded" });

  const grade = await callGrader(audit as AuditRow);
  if (!grade) {
    return json({ error: "grader failed" }, 502);
  }

  const reason = autoFlagReason(grade, audit as AuditRow);

  const { data: inserted } = await db
    .from("answer_grades")
    .insert({
      audit_id: auditId,
      scores: grade.scores,
      overall: grade.overall,
      rationale: grade.rationale,
      grader_model: GRADER_MODEL,
      auto_flagged: Boolean(reason),
      flag_reason: reason,
    })
    .select("id")
    .single();

  let queueId: string | null = null;
  if (reason) {
    const { data: q } = await db
      .from("correction_review_queue")
      .insert({
        audit_id: auditId,
        source: "auto_flag",
        priority: "normal",
        reason: `Auto-grader flagged: ${reason}`,
        proposed_product_slug: (audit as AuditRow).product_slug,
        proposed_title: "Review flagged customer AI reply",
        proposed_law_text: (audit as AuditRow).assistant_text ?? "",
        status: "pending",
        created_by: "grader",
      })
      .select("id")
      .single();
    queueId = (q as any)?.id ?? null;
  }

  return json({
    grade_id: (inserted as any)?.id ?? null,
    audit_id: auditId,
    overall: grade.overall,
    scores: grade.scores,
    flagged: Boolean(reason),
    reason,
    review_queue_id: queueId,
  });
});
