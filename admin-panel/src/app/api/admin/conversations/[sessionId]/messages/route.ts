import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClient } from "@/lib/supabase-server";

type Params = Promise<{ sessionId: string }>;

export async function GET(_req: NextRequest, { params }: { params: Params }) {
  const { sessionId } = await params;
  const supabase = getSupabaseAdminClient();

  const { data, error } = await supabase
    .from("support_chat_messages")
    .select("id, role, content, created_at, session_id")
    .eq("session_id", sessionId)
    .order("created_at", { ascending: true });

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: data ?? [] });
}

