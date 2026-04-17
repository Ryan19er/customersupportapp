import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

// GET /api/admin/audits?session_id=...&channel=support|auth
// Returns recent answer_audit rows for a session, joined with the latest grade per audit.
export async function GET(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error, audits: [] }, { status: 503 });
  const supabase = init.client;

  const sessionId = req.nextUrl.searchParams.get("session_id");
  const channel = req.nextUrl.searchParams.get("channel");
  if (!sessionId) return NextResponse.json({ error: "session_id required" }, { status: 400 });

  let q = supabase
    .from("answer_audit")
    .select(
      "id, session_channel, session_id, product_slug, user_query, assistant_text, resolver_meta, evidence, model, latency_ms, created_at",
    )
    .eq("session_id", sessionId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (channel) q = q.eq("session_channel", channel);
  const { data: audits, error } = await q;
  if (error) return NextResponse.json({ error: error.message, audits: [] }, { status: 500 });

  const auditIds = (audits ?? []).map((a) => a.id);
  const grades = auditIds.length
    ? await supabase
        .from("answer_grades")
        .select("audit_id, overall, scores, rationale, auto_flagged, flag_reason, created_at")
        .in("audit_id", auditIds)
    : { data: [] as any[] };
  const gMap: Record<string, any> = {};
  for (const r of (grades.data as any[] | null) ?? []) gMap[r.audit_id] = r;

  return NextResponse.json({
    audits: (audits ?? []).map((a) => ({ ...a, grade: gMap[a.id] ?? null })),
  });
}
