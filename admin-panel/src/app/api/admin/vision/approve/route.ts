import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

const schema = z.object({
  image_id: z.string().uuid(),
  reviewed_by: z.string().min(1),
  action: z.enum(["approve", "reject"]).default("approve"),
});

export async function POST(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });
  const supabase = init.client;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const p = parsed.data;

  const status = p.action === "approve" ? "approved" : "rejected";
  const { data, error } = await supabase
    .from("vision_training_images")
    .update({
      label_status: status,
      reviewed_by: p.reviewed_by,
      reviewed_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", p.image_id)
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, image: data });
}
