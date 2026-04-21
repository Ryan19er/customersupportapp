import { NextRequest, NextResponse } from "next/server";
import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error, items: [] }, { status: 503 });
  const supabase = init.client;
  const status = req.nextUrl.searchParams.get("status");
  const source = req.nextUrl.searchParams.get("source");
  const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") || "200"), 500);

  let q = supabase
    .from("vision_training_images")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (status) q = q.eq("label_status", status);
  if (source) q = q.eq("source", source);
  const { data, error } = await q;
  if (error) return NextResponse.json({ error: error.message, items: [] }, { status: 500 });

  const items = (data ?? []).map((r) => {
    const { data: pub } = supabase.storage.from(r.storage_bucket || "vision-training-images").getPublicUrl(r.storage_path);
    return { ...r, public_url: pub.publicUrl };
  });
  return NextResponse.json({ items });
}
