import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

const schema = z.object({
  image_id: z.string().uuid(),
});

const SYSTEM = `You are labeling laser cut quality images for Stealth Machine Tools.
Return only JSON:
{
  "label_primary": "good_cut|bad_cut|nozzle_issue",
  "defect_tags": ["..."],
  "likely_causes": ["..."],
  "recommended_checks": ["..."],
  "confidence": 0.0
}`;

export async function POST(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });
  const supabase = init.client;
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });

  const { data: image } = await supabase
    .from("vision_training_images")
    .select("id,storage_bucket,storage_path")
    .eq("id", parsed.data.image_id)
    .maybeSingle();
  if (!image) return NextResponse.json({ error: "Image not found" }, { status: 404 });
  const storageBucket = String((image as { storage_bucket?: string | null }).storage_bucket ?? "vision-training-images");
  const storagePath = String((image as { storage_path?: string | null }).storage_path ?? "");
  const pub = supabase.storage.from(storageBucket).getPublicUrl(storagePath);

  const fnUrl = `${process.env.SUPABASE_URL}/functions/v1/anthropic-chat`;
  const apikey = process.env.SUPABASE_ANON_KEY ?? "";
  const resp = await fetch(fnUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apikey ? { apikey, Authorization: `Bearer ${apikey}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 700,
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "text", text: "Label this laser cut image." },
            { type: "image", source: { type: "url", url: pub.data.publicUrl } },
          ],
        },
      ],
    }),
  });
  const raw = await resp.json().catch(() => null);
  if (!resp.ok) return NextResponse.json({ error: raw?.error ?? "Prelabel failed" }, { status: 500 });
  return NextResponse.json({ ok: true, text: raw?.text ?? "" });
}
