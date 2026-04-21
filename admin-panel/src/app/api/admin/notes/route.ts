import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";
import { ingestCorrection } from "@/lib/ingest-correction";

const noteSchema = z.object({
  conversation_channel: z.enum(["support", "auth"]).default("support"),
  contact_id: z.string().uuid().optional().nullable(),
  session_id: z.string().uuid(),
  message_id: z.string().uuid().optional().nullable(),
  symptoms: z.string().min(1),
  root_cause: z.string().min(1),
  fix_steps: z.string().min(1),
  parts_used: z.string().optional().nullable(),
  machine_model: z.string().optional().nullable(),
  machine_serial: z.string().optional().nullable(),
  created_by: z.string().min(1),
  tags: z.array(z.string()).default([]),
  prior_assistant_summary: z.string().optional().nullable(),
  note_intent: z.enum(["good_advice", "bad_advice", "correction"]).default("correction"),
  publish_now: z.boolean().default(true),
});

export async function GET(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) {
    return NextResponse.json({ error: init.error, notes: [] }, { status: 503 });
  }
  const supabase = init.client;
  const q = req.nextUrl.searchParams.get("q")?.trim();

  let query = supabase
    .from("tech_notes")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (q) {
    query = query.or(
      `symptoms.ilike.%${q}%,root_cause.ilike.%${q}%,fix_steps.ilike.%${q}%,machine_model.ilike.%${q}%`,
    );
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ notes: data ?? [] });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = noteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid note payload" }, { status: 400 });
  }

  const init = getSupabaseAdminClientSafe();
  if (!init.ok) {
    return NextResponse.json({ error: init.error }, { status: 503 });
  }
  const supabase = init.client;
  const payload = parsed.data;

  const isSupport = payload.conversation_channel === "support";

  const { data: note, error: noteErr } = await supabase
    .from("tech_notes")
    .insert({
      contact_id: isSupport ? payload.contact_id : null,
      session_id: isSupport ? payload.session_id : null,
      message_id: isSupport ? payload.message_id : null,
      symptoms: payload.symptoms,
      root_cause: payload.root_cause,
      fix_steps: payload.fix_steps,
      parts_used: payload.parts_used,
      machine_model: payload.machine_model,
      machine_serial: payload.machine_serial,
      created_by: payload.created_by,
      tags: payload.tags,
      prior_assistant_summary: payload.prior_assistant_summary?.trim() || null,
    })
    .select("*")
    .single();

  if (noteErr || !note) {
    return NextResponse.json({ error: noteErr?.message ?? "Failed to create note" }, { status: 500 });
  }

  try {
    const ingestion = await ingestCorrection(supabase, {
      source: "manual_note",
      sourceRefId: note.id,
      conversationChannel: payload.conversation_channel,
      supportSessionId: isSupport ? payload.session_id : null,
      supportMessageId: isSupport ? payload.message_id ?? null : null,
      authSessionId: !isSupport ? payload.session_id : null,
      authMessageId: !isSupport ? payload.message_id ?? null : null,
      customerIdentifier: payload.contact_id ?? null,
      machineModel: payload.machine_model ?? null,
      machineSerial: payload.machine_serial ?? null,
      symptoms: payload.symptoms,
      priorAiSummary: payload.prior_assistant_summary ?? null,
      rootCause: payload.root_cause,
      fixSteps: payload.fix_steps,
      partsUsed: payload.parts_used ?? null,
      tags: payload.tags,
      noteIntent: payload.note_intent,
      autoApproveCanonical: payload.publish_now,
      createdBy: payload.created_by,
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
