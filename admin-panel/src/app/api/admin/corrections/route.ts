import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";
import { ingestCorrection } from "@/lib/ingest-correction";

const schema = z.object({
  source: z.enum(["manual_note", "synthesized_note", "training_chat", "queue_resolution"]).default("manual_note"),
  source_ref_id: z.string().uuid().optional().nullable(),
  conversation_channel: z.enum(["support", "auth", "training"]),
  support_session_id: z.string().uuid().optional().nullable(),
  support_message_id: z.string().uuid().optional().nullable(),
  auth_session_id: z.string().uuid().optional().nullable(),
  auth_message_id: z.string().uuid().optional().nullable(),
  training_thread_id: z.string().uuid().optional().nullable(),
  customer_identifier: z.string().optional().nullable(),
  machine_model: z.string().optional().nullable(),
  machine_serial: z.string().optional().nullable(),
  symptoms: z.string().min(1),
  prior_ai_summary: z.string().optional().nullable(),
  root_cause: z.string().min(1),
  fix_steps: z.string().min(1),
  parts_used: z.string().optional().nullable(),
  tags: z.array(z.string()).default([]),
  created_by: z.string().min(1),
  tech_note_id: z.string().uuid().optional().nullable(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const init = getSupabaseAdminClientSafe();
  if (!init.ok) {
    return NextResponse.json({ error: init.error }, { status: 503 });
  }

  try {
    const p = parsed.data;
    const ingestion = await ingestCorrection(init.client, {
      source: p.source,
      sourceRefId: p.source_ref_id ?? null,
      conversationChannel: p.conversation_channel,
      supportSessionId: p.support_session_id ?? null,
      supportMessageId: p.support_message_id ?? null,
      authSessionId: p.auth_session_id ?? null,
      authMessageId: p.auth_message_id ?? null,
      trainingThreadId: p.training_thread_id ?? null,
      customerIdentifier: p.customer_identifier ?? null,
      machineModel: p.machine_model ?? null,
      machineSerial: p.machine_serial ?? null,
      symptoms: p.symptoms,
      priorAiSummary: p.prior_ai_summary ?? null,
      rootCause: p.root_cause,
      fixSteps: p.fix_steps,
      partsUsed: p.parts_used ?? null,
      tags: p.tags,
      createdBy: p.created_by,
      techNoteId: p.tech_note_id ?? null,
    });

    return NextResponse.json({ ok: true, ingestion });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Ingestion failed" }, { status: 500 });
  }
}
