import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase-server";

/** Default prompt “files” (keys) used across the app. DB may add more over time. */
const DEFAULT_KEYS = ["support-system", "stealth-onboarding"];

export async function GET() {
  try {
    const supabase = getSupabaseAdminClient();
    const { data, error } = await supabase.from("prompt_versions").select("prompt_key");

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    const fromDb = [...new Set((data ?? []).map((r) => r.prompt_key as string))];
    const keys = [...new Set([...DEFAULT_KEYS, ...fromDb])].sort((a, b) => a.localeCompare(b));

    return NextResponse.json({ keys });
  } catch (e) {
    const message = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: message, keys: DEFAULT_KEYS }, { status: 500 });
  }
}
