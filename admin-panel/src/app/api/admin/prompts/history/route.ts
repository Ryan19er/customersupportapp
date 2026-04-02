import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const init = getSupabaseAdminClientSafe();
    if (!init.ok) {
      return NextResponse.json({ error: init.error, versions: [] }, { status: 503 });
    }
    const supabase = init.client;
    const promptKey = req.nextUrl.searchParams.get("prompt_key") ?? "support-system";

    const { data, error } = await supabase
      .from("prompt_versions")
      .select("*")
      .eq("prompt_key", promptKey)
      .order("version", { ascending: false })
      .limit(100);

    if (error) {
      return NextResponse.json({ error: error.message, versions: [] }, { status: 500 });
    }
    return NextResponse.json({ versions: data ?? [] });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message, versions: [] }, { status: 500 });
  }
}

