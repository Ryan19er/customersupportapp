import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { buildLearningSnippetText } from "@/lib/build-learning-snippet-text";
import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";

const noteSchema = z.object({
  contact_id: z.string().uuid(),
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

  const { data, error } = await supabase
    .from("tech_notes")
    .insert({
      contact_id: payload.contact_id,
      session_id: payload.session_id,
      message_id: payload.message_id,
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

