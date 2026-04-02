import { NextRequest, NextResponse } from "next/server";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

type Params = Promise<{ sessionId: string }>;

export async function GET(req: NextRequest, { params }: { params: Params }) {
  const { sessionId } = await params;
  const channel = req.nextUrl.searchParams.get("channel");
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) {
    return NextResponse.json({ error: init.error, messages: [] }, { status: 503 });
  }
  const supabase = init.client;

  const selectCols = "id, role, content, created_at, session_id";

  async function fromSupport() {
    return supabase
      .from("support_chat_messages")
      .select(selectCols)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
  }

  async function fromAuth() {
    return supabase
      .from("chat_messages")
      .select(selectCols)
      .eq("session_id", sessionId)
      .order("created_at", { ascending: true });
  }

  if (channel === "auth") {
    const { data, error } = await fromAuth();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ messages: data ?? [], channel: "auth" });
  }

  if (channel === "support") {
    const { data, error } = await fromSupport();
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    return NextResponse.json({ messages: data ?? [], channel: "support" });
  }

  // Legacy / unknown: try support first (older app default), then signed-in tables.
  const support = await fromSupport();
  if (!support.error && (support.data?.length ?? 0) > 0) {
    return NextResponse.json({ messages: support.data ?? [], channel: "support" });
  }
  const auth = await fromAuth();
  if (auth.error) {
    return NextResponse.json({ error: auth.error.message }, { status: 500 });
  }
  return NextResponse.json({ messages: auth.data ?? [], channel: "auth" });
}

