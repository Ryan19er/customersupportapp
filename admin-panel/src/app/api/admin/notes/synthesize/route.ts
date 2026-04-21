import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";
import { ingestCorrection } from "@/lib/ingest-correction";

const threadMsg = z.object({
  role: z.enum(["user", "assistant"]),
  content: z.string(),
});

const bodySchema = z.object({
  conversation_channel: z.enum(["support", "auth"]).default("support"),
  contact_id: z.string().uuid().optional().nullable(),
  session_id: z.string().uuid(),
  message_id: z.string().uuid().optional().nullable(),
  created_by: z.string().min(1),
  note_intent: z.enum(["good_advice", "bad_advice", "correction"]).default("correction"),
  publish_now: z.boolean().default(true),
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
- prior_assistant_guidance (string): concise summary of what the ASSISTANT already suggested in this thread before the technician's conclusion.
- root_cause (string): actual cause the technician determined
- fix_steps (string): what fixed it, stepwise if needed
- parts_used (string or null)
- machine_model (string or null)
- machine_serial (string or null)
- tags (array of short strings, e.g. power, connector, ethernet — can be empty)

If unknown, use "Not specified" for required fields and null for optional machine/parts values.`;

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

  const { conversation_channel, contact_id, session_id, message_id, created_by, note_intent, publish_now, thread } =
    parsed.data;

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

  const isSupport = conversation_channel === "support";
  const { data: note, error } = await supabase
    .from("tech_notes")
    .insert({
      contact_id: isSupport ? contact_id ?? null : null,
      session_id: isSupport ? session_id : null,
      message_id: isSupport ? message_id ?? null : null,
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

  if (error || !note) {
    return NextResponse.json({ error: error?.message ?? "Failed to save note" }, { status: 500 });
  }

  try {
    const ingestion = await ingestCorrection(supabase, {
      source: "synthesized_note",
      sourceRefId: note.id,
      conversationChannel: conversation_channel,
      supportSessionId: isSupport ? session_id : null,
      supportMessageId: isSupport ? message_id ?? null : null,
      authSessionId: !isSupport ? session_id : null,
      authMessageId: !isSupport ? message_id ?? null : null,
      customerIdentifier: contact_id ?? null,
      machineModel: extracted.machine_model ?? null,
      machineSerial: extracted.machine_serial ?? null,
      symptoms: extracted.symptoms,
      priorAiSummary: prior,
      rootCause: extracted.root_cause,
      fixSteps: extracted.fix_steps,
      partsUsed: extracted.parts_used ?? null,
      tags: extracted.tags,
      noteIntent: note_intent,
      autoApproveCanonical: publish_now,
      createdBy: created_by,
      techNoteId: note.id,
    });

    return NextResponse.json({ note, ingestion });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Correction ingestion failed", note },
      { status: 500 },
    );
  }
}
