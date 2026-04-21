import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });
  const supabase = init.client;

  const url = new URL(req.url);
  const days = Math.min(Math.max(Number(url.searchParams.get("days") ?? "14"), 3), 60);
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

  const { data: grades, error } = await supabase
    .from("answer_grades")
    .select("created_at, auto_flagged, severity, reason_code, topic_fingerprint")
    .gte("created_at", since)
    .order("created_at", { ascending: true })
    .limit(5000);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  const byDay: Record<string, { graded: number; flagged: number }> = {};
  const reasonCounts: Record<string, number> = {};
  const severityCounts: Record<string, number> = {};
  const queueDecisionCounts: Record<string, number> = {};
  const topicCounts: Record<string, number> = {};

  for (const g of grades ?? []) {
    const day = String(g.created_at).slice(0, 10);
    byDay[day] = byDay[day] ?? { graded: 0, flagged: 0 };
    byDay[day].graded += 1;
    if (g.auto_flagged) byDay[day].flagged += 1;
    const rc = String((g as any).reason_code ?? "unspecified");
    reasonCounts[rc] = (reasonCounts[rc] ?? 0) + 1;
    const sev = String((g as any).severity ?? "unknown");
    severityCounts[sev] = (severityCounts[sev] ?? 0) + 1;
    const qd = String((g as any).queue_decision ?? "unknown");
    queueDecisionCounts[qd] = (queueDecisionCounts[qd] ?? 0) + 1;
    const topic = String((g as any).topic_fingerprint ?? "");
    if (topic) topicCounts[topic] = (topicCounts[topic] ?? 0) + 1;
  }

  const daily = Object.entries(byDay)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([day, v]) => ({
      day,
      graded: v.graded,
      flagged: v.flagged,
      flagged_pct: v.graded > 0 ? Math.round((v.flagged / v.graded) * 100) : 0,
    }));

  return NextResponse.json({
    days,
    daily,
    reason_counts: reasonCounts,
    severity_counts: severityCounts,
    queue_decision_counts: queueDecisionCounts,
    recurring_topics: Object.entries(topicCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20)
      .map(([topic, count]) => ({ topic, count })),
  });
}

