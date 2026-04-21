import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

const schema = z.object({
  image_id: z.string().uuid(),
  created_by: z.string().min(1),
  annotation_mode: z.enum(["manual", "ai_assist"]).default("manual"),
  label_primary: z.enum(["good_cut", "bad_cut", "nozzle_issue"]).optional().nullable(),
  defect_tags: z.array(z.string()).default([]),
  likely_causes: z.array(z.string()).default([]),
  recommended_checks: z.array(z.string()).default([]),
  regions: z.array(z.any()).default([]),
  confidence: z.number().min(0).max(1).optional().nullable(),
  notes: z.string().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });
  const supabase = init.client;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const p = parsed.data;

  const { data: anno, error } = await supabase
    .from("vision_training_annotations")
    .insert({
      image_id: p.image_id,
      created_by: p.created_by,
      annotation_mode: p.annotation_mode,
      label_primary: p.label_primary ?? null,
      defect_tags: p.defect_tags,
      likely_causes: p.likely_causes,
      recommended_checks: p.recommended_checks,
      regions: p.regions,
      confidence: p.confidence ?? null,
      notes: p.notes ?? null,
    })
    .select("*")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  await supabase
    .from("vision_training_images")
    .update({
      label_primary: p.label_primary ?? null,
      defect_tags: p.defect_tags,
      notes: p.notes ?? null,
      label_status: "reviewed",
      updated_at: new Date().toISOString(),
    })
    .eq("id", p.image_id);

  return NextResponse.json({ ok: true, annotation: anno });
}
