import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

export async function GET(_req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });
  const supabase = init.client;

  const [docsCount, chunksCount, lastDoc, perProduct, pendingQueue, grades] = await Promise.all([
    supabase.from("knowledge_documents").select("*", { count: "exact", head: true }),
    supabase.from("knowledge_chunks").select("*", { count: "exact", head: true }),
    supabase
      .from("knowledge_documents")
      .select("id,title,source_ref,product_slug,ingested_at,chunk_count")
      .order("ingested_at", { ascending: false, nullsFirst: false })
      .limit(10),
    supabase
      .from("knowledge_chunks")
      .select("product_slug")
      .limit(20000),
    supabase
      .from("correction_review_queue")
      .select("*", { count: "exact", head: true })
      .eq("status", "pending"),
    supabase
      .from("answer_grades")
      .select("overall, auto_flagged")
      .order("created_at", { ascending: false })
      .limit(200),
  ]);

  const perProductCounts: Record<string, number> = {};
  for (const r of (perProduct.data as any[] | null) ?? []) {
    const slug = r.product_slug ?? "general";
    perProductCounts[slug] = (perProductCounts[slug] ?? 0) + 1;
  }

  const gradeRows = (grades.data as any[] | null) ?? [];
  const avgOverall =
    gradeRows.length > 0
      ? Math.round(
          (gradeRows.reduce((a, b) => a + Number(b.overall ?? 0), 0) / gradeRows.length) * 100,
        ) / 100
      : null;
  const flaggedShare =
    gradeRows.length > 0
      ? Math.round((gradeRows.filter((r) => r.auto_flagged).length / gradeRows.length) * 100)
      : 0;

  return NextResponse.json({
    documents: docsCount.count ?? 0,
    chunks: chunksCount.count ?? 0,
    pending_review: pendingQueue.count ?? 0,
    avg_grade_last_200: avgOverall,
    flagged_pct_last_200: flaggedShare,
    per_product: perProductCounts,
    recent_documents: lastDoc.data ?? [],
  });
}
