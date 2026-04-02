import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

const schema = z.object({
  prompt_key: z.string().min(1),
  markdown_content: z.string().min(1),
  change_summary: z.string().min(1),
  created_by: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const init = getSupabaseAdminClientSafe();
  if (!init.ok) {
    return NextResponse.json({ error: init.error }, { status: 503 });
  }
  const supabase = init.client;
  const input = parsed.data;

  const { data: maxRows, error: maxErr } = await supabase
    .from("prompt_versions")
    .select("version")
    .eq("prompt_key", input.prompt_key)
    .order("version", { ascending: false })
    .limit(1);

  if (maxErr) {
    return NextResponse.json({ error: maxErr.message }, { status: 500 });
  }

  const nextVersion = (maxRows?.[0]?.version ?? 0) + 1;

  const deactivate = await supabase
    .from("prompt_versions")
    .update({ is_active: false })
    .eq("prompt_key", input.prompt_key)
    .eq("is_active", true);
  if (deactivate.error) {
    return NextResponse.json({ error: deactivate.error.message }, { status: 500 });
  }

  const { data, error } = await supabase
    .from("prompt_versions")
    .insert({
      prompt_key: input.prompt_key,
      version: nextVersion,
      markdown_content: input.markdown_content,
      change_summary: input.change_summary,
      created_by: input.created_by,
      is_active: true,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ version: data });
}

