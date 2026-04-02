import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClient } from "@/lib/supabase-server";

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
});

export async function GET(req: NextRequest) {
  const supabase = getSupabaseAdminClient();
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
  const supabase = getSupabaseAdminClient();
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
    })
    .select("*")
    .single();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ note: data });
}

