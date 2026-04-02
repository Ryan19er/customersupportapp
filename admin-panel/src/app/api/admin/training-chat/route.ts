import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClient } from "@/lib/supabase-server";
import { trainingSystemPrompt } from "@/lib/training-system-prompt";

const schema = z.object({
  message: z.string().min(1),
  created_by: z.string().min(1),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const input = parsed.data;

  const saveUser = await supabase.from("training_chat_messages").insert({
    role: "user",
    content: input.message,
    created_by: input.created_by,
  });
  if (saveUser.error) {
    return NextResponse.json({ error: saveUser.error.message }, { status: 500 });
  }

  const { data: historyRows } = await supabase
    .from("training_chat_messages")
    .select("role, content")
    .order("created_at", { ascending: true })
    .limit(24);

  const messages = (historyRows ?? []).map((r) => ({
    role: r.role,
    content: [{ type: "text", text: r.content }],
  }));

  const functionUrl = `${process.env.SUPABASE_URL}/functions/v1/anthropic-chat`;
  const apikey = process.env.SUPABASE_ANON_KEY ?? "";
  const proxyRes = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apikey ? { apikey } : {}),
      ...(apikey ? { Authorization: `Bearer ${apikey}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      system: trainingSystemPrompt,
      messages,
    }),
  });

  const proxyJson = await proxyRes.json().catch(() => null);
  if (!proxyRes.ok || !proxyJson?.text) {
    return NextResponse.json(
      { error: proxyJson?.error ?? "Training AI request failed" },
      { status: 500 },
    );
  }

  const assistant = String(proxyJson.text);
  const saveAssistant = await supabase.from("training_chat_messages").insert({
    role: "assistant",
    content: assistant,
    created_by: input.created_by,
  });
  if (saveAssistant.error) {
    return NextResponse.json({ error: saveAssistant.error.message }, { status: 500 });
  }

  return NextResponse.json({ reply: assistant });
}

