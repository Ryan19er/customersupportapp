import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { buildLearningSnippetText } from "@/lib/build-learning-snippet-text";
import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

const threadMsg = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const bodySchema = z.object({
  contact_id: z.string().uuid(),
  session_id: z.string().uuid(),
  message_id: z.string().uuid().optional().nullable(),
  created_by: z.string().min(1),
  thread: z.array(threadMsg).min(1),
});

const extractedSchema = z.object({
  symptoms: z.string(),
  root_cause: z.string(),
  fix_steps: z.string(),
  parts_used: z.string().nullable().optional(),
  machine_model: z.string().nullable().optional(),
  machine_serial: z.string().nullable().optional(),
  tags: z.array(z.string()).default([]),
  /** What the customer-facing AI already suggested in the thread (may be wrong or incomplete). */
  prior_assistant_guidance: z.string().default(""),
});

function parseJsonFromAssistant(text: string): unknown {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  const raw = fence ? fence[1].trim() : trimmed;
  return JSON.parse(raw) as unknown;
}

const extractionSystem = `You extract structured repair notes for a database. The transcript may include USER (customer) and ASSISTANT (customer-facing AI) messages.

Output ONLY valid JSON, no markdown, no commentary. Keys:
- symptoms (string): what the customer reported / showed (from chat), not the final tech diagnosis
- prior_assistant_guidance (string): concise summary of what the ASSISTANT already suggested in this thread before the technician's conclusion (e.g. breakers, E-stop, power checks). If there was no assistant or nothing useful, use "Not specified".
- root_cause (string): actual cause the technician determined
- fix_steps (string): what fixed it, stepwise if needed
- parts_used (string or null)
- machine_model (string or null)
- machine_serial (string or null)
- tags (array of short strings, e.g. power, connector, ethernet — can be empty)

Use the conversation below. If something is unknown, use a short phrase like "Not specified" for required string fields; use null only for optional parts_used/machine_model/machine_serial when absent.`;

export async function POST(req: NextRequest) {
  const raw = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const init = getSupabaseAdminClientSafe();
  if (!init.ok) {
    return NextResponse.json({ error: init.error }, { status: 503 });
  }
  const supabase = init.client;

  const { contact_id, session_id, message_id, created_by, thread } = parsed.data;

  const transcript = thread
    .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
    .join("\n\n");

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
      max_tokens: 2048,
      system: extractionSystem,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `Technician conversation:\n\n${transcript}\n\nRespond with JSON only.`,
            },
          ],
        },
      ],
    }),
  });

  const proxyJson = await proxyRes.json().catch(() => null);
  if (!proxyRes.ok || !proxyJson?.text) {
    return NextResponse.json(
      { error: proxyJson?.error ?? "Extraction request failed" },
      { status: 500 },
    );
  }

  let extracted: z.infer<typeof extractedSchema>;
  try {
    const j = parseJsonFromAssistant(String(proxyJson.text));
    const ex = extractedSchema.safeParse(j);
    if (!ex.success) {
      return NextResponse.json(
        { error: "Could not parse structured note from AI response", raw: proxyJson.text },
        { status: 422 },
      );
    }
    extracted = ex.data;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "JSON parse failed", raw: proxyJson.text },
      { status: 422 },
    );
  }

  const prior =
    extracted.prior_assistant_guidance.trim() &&
    extracted.prior_assistant_guidance.trim().toLowerCase() !== "not specified"
      ? extracted.prior_assistant_guidance.trim()
      : null;

  const { data, error } = await supabase
    .from("tech_notes")
    .insert({
      contact_id,
      session_id,
      message_id: message_id ?? null,
      symptoms: extracted.symptoms,
      root_cause: extracted.root_cause,
      fix_steps: extracted.fix_steps,
      parts_used: extracted.parts_used ?? null,
      machine_model: extracted.machine_model ?? null,
      machine_serial: extracted.machine_serial ?? null,
      created_by,
      tags: extracted.tags,
      prior_assistant_summary: prior,
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const snippetText = buildLearningSnippetText({
    symptoms: data.symptoms,
    root_cause: data.root_cause,
    fix_steps: data.fix_steps,
    parts_used: data.parts_used,
    prior_assistant_summary: data.prior_assistant_summary,
    tags: data.tags ?? [],
  });

  const upsertSnip = await supabase.from("learning_snippets").upsert(
    {
      tech_note_id: data.id,
      snippet_text: snippetText,
      machine_model: data.machine_model,
      machine_serial: data.machine_serial,
      issue_tags: data.tags ?? [],
      confidence: 0.5,
    },
    { onConflict: "tech_note_id" },
  );
  if (upsertSnip.error) {
    console.error("learning_snippets upsert:", upsertSnip.error.message);
  }

  return NextResponse.json({ note: data });
}
