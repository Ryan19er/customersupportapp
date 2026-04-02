import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClient } from "@/lib/supabase-server";

export async function GET() {
  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("admin_customer_question_queue")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

const resolveSchema = z.object({
  id: z.string().uuid(),
  resolved_by: z.string().min(1),
});

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = resolveSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = getSupabaseAdminClient();
  const { data, error } = await supabase
    .from("admin_customer_question_queue")
    .update({
      status: "resolved",
      resolved_at: new Date().toISOString(),
      resolved_by: parsed.data.resolved_by,
    })
    .eq("id", parsed.data.id)
    .eq("status", "open")
    .select("*")
    .maybeSingle();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ error: "Item not found or already resolved" }, { status: 404 });
  }
  return NextResponse.json({ item: data });
}
