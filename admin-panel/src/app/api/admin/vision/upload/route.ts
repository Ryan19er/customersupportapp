import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

export const runtime = "nodejs";

const MAX_BYTES = 15 * 1024 * 1024;

export async function POST(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });
  const supabase = init.client;

  const form = await req.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "Expected multipart/form-data" }, { status: 400 });
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "Missing file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "File too large (max 15MB)" }, { status: 413 });

  const uploadedBy = String(form.get("uploaded_by") || "admin");
  const source = String(form.get("source") || "admin_upload");
  const productSlug = String(form.get("product_slug") || "").trim() || null;
  const machineModel = String(form.get("machine_model") || "").trim() || null;
  const materialType = String(form.get("material_type") || "").trim() || null;
  const thicknessRaw = String(form.get("thickness_mm") || "").trim();
  const gasType = String(form.get("gas_type") || "").trim() || null;
  const notes = String(form.get("notes") || "").trim() || null;
  const labelPrimary = String(form.get("label_primary") || "").trim() || null;
  const defectTags = String(form.get("defect_tags") || "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
  const sourceSessionChannel = String(form.get("source_session_channel") || "").trim() || null;
  const sourceSessionId = String(form.get("source_session_id") || "").trim() || null;
  const sourceMessageId = String(form.get("source_message_id") || "").trim() || null;
  const thickness = thicknessRaw ? Number(thicknessRaw) : null;

  const ext = file.name.includes(".") ? file.name.split(".").pop() : "jpg";
  const path = `${new Date().toISOString().slice(0, 10)}/${randomUUID()}.${ext}`;
  const bytes = Buffer.from(await file.arrayBuffer());
  const up = await supabase.storage.from("vision-training-images").upload(path, bytes, {
    contentType: file.type || "image/jpeg",
    upsert: false,
  });
  if (up.error) return NextResponse.json({ error: up.error.message }, { status: 500 });

  const { data: pub } = supabase.storage.from("vision-training-images").getPublicUrl(path);
  const { data, error } = await supabase
    .from("vision_training_images")
    .insert({
      source,
      source_session_channel: sourceSessionChannel,
      source_session_id: sourceSessionId,
      source_message_id: sourceMessageId,
      storage_bucket: "vision-training-images",
      storage_path: path,
      mime_type: file.type || "image/jpeg",
      uploaded_by: uploadedBy,
      product_slug: productSlug,
      machine_model: machineModel,
      material_type: materialType,
      thickness_mm: Number.isFinite(thickness) ? thickness : null,
      gas_type: gasType,
      label_primary: labelPrimary,
      defect_tags: defectTags,
      notes,
      label_status: "pending",
    })
    .select("id,storage_path,label_status,label_primary,defect_tags,created_at")
    .single();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ ok: true, image: { ...data, public_url: pub.publicUrl } });
}
