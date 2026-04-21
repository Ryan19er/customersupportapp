import { NextResponse } from "next/server";
import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

export async function GET() {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });
  const supabase = init.client;

  const [{ data: images }, { data: audits }, { data: queue }] = await Promise.all([
    supabase.from("vision_training_images").select("label_status,label_primary,source"),
    supabase.from("vision_diagnosis_audit").select("classification,confidence,created_at").order("created_at", { ascending: false }).limit(500),
    supabase.from("vision_diagnosis_review_queue").select("status,queue_priority"),
  ]);

  const statusCounts: Record<string, number> = {};
  const labelCounts: Record<string, number> = {};
  for (const row of images ?? []) {
    const r = row as { label_status?: string | null; label_primary?: string | null };
    statusCounts[r.label_status ?? "unknown"] = (statusCounts[r.label_status ?? "unknown"] ?? 0) + 1;
    labelCounts[r.label_primary ?? "unlabeled"] = (labelCounts[r.label_primary ?? "unlabeled"] ?? 0) + 1;
  }
  const queueCounts: Record<string, number> = {};
  for (const q of queue ?? []) {
    queueCounts[q.status ?? "unknown"] = (queueCounts[q.status ?? "unknown"] ?? 0) + 1;
  }
  const avgConfidence =
    (audits ?? []).length > 0
      ? Number(
          (
            (audits ?? []).reduce((acc, a) => acc + Number(a.confidence ?? 0), 0) /
            (audits ?? []).length
          ).toFixed(3),
        )
      : null;

  return NextResponse.json({
    totals: {
      images: (images ?? []).length,
      audits: (audits ?? []).length,
      queue: (queue ?? []).length,
    },
    status_counts: statusCounts,
    label_counts: labelCounts,
    queue_counts: queueCounts,
    avg_confidence_last_500: avgConfidence,
  });
}
