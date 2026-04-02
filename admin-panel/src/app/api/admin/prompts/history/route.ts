import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdminClient();
  const promptKey = req.nextUrl.searchParams.get("prompt_key") ?? "support-system";

  const { data, error } = await supabase
    .from("prompt_versions")
    .select("*")
    .eq("prompt_key", promptKey)
    .order("version", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ versions: data ?? [] });
}

