import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

/**
 * Returns:
 *   - breakdown: how many of the last N graded answers were flagged for each reason
 *   - items: the most recent flagged answers with enough context for admins
 *     to drill in and fix (audit_id, queue_id, user_query, product_slug, etc.)
 *
 * "Flagged" = auto_flagged=true in answer_grades, set by grade-answer when the
 * AI reply scored low on product match / factual / safety / evidence usage,
 * OR when the resolver could not identify a product and the answer was weak.
 */
export async function GET(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });
  const supabase = init.client;

  const url = new URL(req.url);
  const window = Math.min(Math.max(Number(url.searchParams.get("window") ?? "200"), 20), 1000);
  const itemsLimit = Math.min(Math.max(Number(url.searchParams.get("limit") ?? "25"), 5), 100);

  const { data: grades, error: gradesErr } = await supabase
    .from("answer_grades")
    .select("id, audit_id, overall, auto_flagged, flag_reason, scores, created_at")
    .order("created_at", { ascending: false })
    .limit(window);
  if (gradesErr) return NextResponse.json({ error: gradesErr.message }, { status: 500 });

  const gradeRows = grades ?? [];
  const flagged = gradeRows.filter((g) => g.auto_flagged);

  const breakdown: Record<string, number> = {};
  for (const g of flagged) {
    const key = (g.flag_reason ?? "unspecified").toString();
    breakdown[key] = (breakdown[key] ?? 0) + 1;
  }

  const flaggedAuditIds = flagged.slice(0, itemsLimit).map((g) => g.audit_id);

  let audits: any[] = [];
  if (flaggedAuditIds.length > 0) {
    const { data: auditRows } = await supabase
      .from("answer_audit")
      .select(
        "id, session_channel, session_id, product_slug, user_query, assistant_text, evidence, created_at",
      )
      .in("id", flaggedAuditIds);
    audits = auditRows ?? [];
  }

  let queueRows: any[] = [];
  if (flaggedAuditIds.length > 0) {
    const { data: q } = await supabase
      .from("correction_review_queue")
      .select("id, audit_id, status")
      .in("audit_id", flaggedAuditIds);
    queueRows = q ?? [];
  }

  const queueByAudit = new Map<string, { id: string; status: string }>();
  for (const q of queueRows) queueByAudit.set(q.audit_id, { id: q.id, status: q.status });

  const auditsById = new Map<string, any>();
  for (const a of audits) auditsById.set(a.id, a);

  const items = flagged
    .slice(0, itemsLimit)
    .map((g) => {
      const a = auditsById.get(g.audit_id);
      if (!a) return null;
      const ev = Array.isArray(a.evidence) ? a.evidence : [];
      const q = queueByAudit.get(a.id);
      return {
        grade_id: g.id,
        audit_id: a.id,
        session_channel: a.session_channel,
        session_id: a.session_id,
        product_slug: a.product_slug,
        user_query: a.user_query,
        assistant_preview: (a.assistant_text ?? "").slice(0, 280),
        evidence_count: ev.length,
        reason: g.flag_reason ?? "unspecified",
        overall: g.overall,
        scores: g.scores,
        queue_id: q?.id ?? null,
        queue_status: q?.status ?? null,
        created_at: a.created_at,
      };
    })
    .filter(Boolean);

  return NextResponse.json({
    window,
    total_graded: gradeRows.length,
    flagged_count: flagged.length,
    flagged_pct: gradeRows.length > 0 ? Math.round((flagged.length / gradeRows.length) * 100) : 0,
    breakdown,
    items,
  });
}
