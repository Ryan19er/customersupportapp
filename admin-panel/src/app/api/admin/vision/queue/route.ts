import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error, items: [] }, { status: 503 });
  const supabase = init.client;
  const status = req.nextUrl.searchParams.get("status") || "pending";
  const { data, error } = await supabase
    .from("vision_diagnosis_review_queue")
    .select("*, vision_diagnosis_audit(*)")
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) return NextResponse.json({ error: error.message, items: [] }, { status: 500 });
  return NextResponse.json({ items: data ?? [] });
}

const patchSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["resolved", "dismissed"]),
  reviewed_by: z.string().min(1),
  resolution_notes: z.string().optional().nullable(),
});

export async function PATCH(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });
  const supabase = init.client;
  const body = await req.json().catch(() => null);
  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const p = parsed.data;
  const { data, error } = await supabase
    .from("vision_diagnosis_review_queue")
    .update({
      status: p.status,
      reviewed_by: p.reviewed_by,
      reviewed_at: new Date().toISOString(),
      resolution_notes: p.resolution_notes ?? null,
    })
    .eq("id", p.id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, item: data });
}
