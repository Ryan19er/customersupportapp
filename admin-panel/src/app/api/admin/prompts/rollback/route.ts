import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClient } from "@/lib/supabase-server";

const schema = z.object({
  id: z.string().uuid(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }
  const supabase = getSupabaseAdminClient();

  const { data: target, error: targetErr } = await supabase
    .from("prompt_versions")
    .select("id, prompt_key")
    .eq("id", parsed.data.id)
    .single();

  if (targetErr || !target) {
    return NextResponse.json({ error: "Prompt version not found" }, { status: 404 });
  }

  const off = await supabase
    .from("prompt_versions")
    .update({ is_active: false })
    .eq("prompt_key", target.prompt_key)
    .eq("is_active", true);
  if (off.error) {
    return NextResponse.json({ error: off.error.message }, { status: 500 });
  }

  const on = await supabase
    .from("prompt_versions")
    .update({ is_active: true })
    .eq("id", target.id)
    .select("*")
    .single();

  if (on.error) {
    return NextResponse.json({ error: on.error.message }, { status: 500 });
  }

  return NextResponse.json({ version: on.data });
}

