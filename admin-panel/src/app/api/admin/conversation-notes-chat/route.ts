import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { technicianNotesSystemPrompt } from "@/lib/technician-notes-system-prompt";

const schema = z.object({
  message: z.string().min(1),
  created_by: z.string().min(1),
  thread: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string(),
      }),
    )
    .default([]),
  context: z
    .object({
      sessionLabel: z.string().optional(),
      transcriptTail: z.string().max(120_000).optional(),
      linkedQuote: z.string().max(50_000).optional(),
    })
    .optional(),
});

type IncomingMessage = {
  role: "user" | "assistant";
  content: Array<{ type: "text"; text: string }>;
};

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const { message, created_by, thread, context } = parsed.data;

  let system = technicianNotesSystemPrompt;
  if (context?.sessionLabel) {
    system += `\n\nActive case: ${context.sessionLabel}`;
  }
  if (context?.transcriptTail?.trim()) {
    system += `\n\n--- Customer transcript (most recent lines) ---\n${context.transcriptTail.trim()}\n---`;
  }
  if (context?.linkedQuote?.trim()) {
    system += `\n\nTechnician highlighted this message from the customer thread:\n${context.linkedQuote.trim()}`;
  }

  const prior: IncomingMessage[] = thread.map((m) => ({
    role: m.role,
    content: [{ type: "text", text: m.content }],
  }));

  const messages: IncomingMessage[] = [
    ...prior,
    {
      role: "user",
      content: [{ type: "text", text: message }],
    },
  ];

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
      max_tokens: 4096,
      system,
      messages,
    }),
  });

  const proxyJson = await proxyRes.json().catch(() => null);
  if (!proxyRes.ok || !proxyJson?.text) {
    return NextResponse.json(
      { error: proxyJson?.error ?? "Technician AI request failed" },
      { status: 500 },
    );
  }

  return NextResponse.json({
    reply: String(proxyJson.text),
    created_by,
  });
}
