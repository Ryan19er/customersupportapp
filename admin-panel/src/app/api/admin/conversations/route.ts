import { NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("support_chat_sessions")
    .select("id, contact_id, created_at, updated_at, chat_contacts(full_name, email, phone)")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ sessions: data ?? [] });
}

