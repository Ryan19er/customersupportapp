import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";
import { extractQueueItemsFromAssistantText } from "@/lib/training-queue-parse";
import { trainingSystemPrompt } from "@/lib/training-system-prompt";

const threadIdSchema = z.string().uuid();

const postSchema = z.object({
  message: z.string().min(1),
  created_by: z.string().min(1),
  thread_id: z.string().uuid(),
});

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("thread_id");
  const tid = raw ? threadIdSchema.safeParse(raw) : null;
  if (!tid?.success) {
    return NextResponse.json({ error: "thread_id (uuid) required" }, { status: 400 });
  }

  const init = getSupabaseAdminClientSafe();
  if (!init.ok) {
    return NextResponse.json({ error: init.error }, { status: 503 });
  }
  const supabase = init.client;

  const { data, error } = await supabase
    .from("training_chat_messages")
    .select("id, role, content, created_at, created_by")
    .eq("thread_id", tid.data)
    .order("created_at", { ascending: true })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({ messages: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = postSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const init = getSupabaseAdminClientSafe();
  if (!init.ok) {
    return NextResponse.json({ error: init.error }, { status: 503 });
  }
  const supabase = init.client;
  const input = parsed.data;

  const saveUser = await supabase.from("training_chat_messages").insert({
    role: "user",
    content: input.message,
    created_by: input.created_by,
    thread_id: input.thread_id,
  });
  if (saveUser.error) {
    return NextResponse.json({ error: saveUser.error.message }, { status: 500 });
  }

  const { data: historyRows } = await supabase
    .from("training_chat_messages")
    .select("role, content")
    .eq("thread_id", input.thread_id)
    .order("created_at", { ascending: true })
    .limit(48);

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
      max_tokens: 8192,
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

  const rawAssistant = String(proxyJson.text);
  const { displayText, items: queueItems } = extractQueueItemsFromAssistantText(rawAssistant);

  const saveAssistant = await supabase.from("training_chat_messages").insert({
    role: "assistant",
    content: displayText,
    created_by: input.created_by,
    thread_id: input.thread_id,
  });
  if (saveAssistant.error) {
    return NextResponse.json({ error: saveAssistant.error.message }, { status: 500 });
  }

  let queued = 0;
  if (queueItems.length > 0) {
    const rows = queueItems.map((q) => ({
      title: q.title,
      detail: q.detail || null,
      source: "training_chat",
      status: "open" as const,
      created_by: input.created_by,
    }));
    const ins = await supabase.from("admin_customer_question_queue").insert(rows);
    if (ins.error) {
      console.error("admin_customer_question_queue insert:", ins.error.message);
    } else {
      queued = queueItems.length;
    }
  }

  return NextResponse.json({ reply: displayText, queued });
}
