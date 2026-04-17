import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";
import { embedSingle } from "@/lib/embed-client";

export async function GET(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error, items: [] }, { status: 503 });
  const supabase = init.client;

  const status = req.nextUrl.searchParams.get("status") || "pending";
  const { data, error } = await supabase
    .from("correction_review_queue")
    .select(
      "id, correction_id, canonical_knowledge_id, audit_id, source, priority, reason, proposed_title, proposed_law_text, proposed_machine_model, proposed_product_slug, status, reviewed_by, reviewed_at, review_notes, created_by, created_at",
    )
    .eq("status", status)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) return NextResponse.json({ error: error.message, items: [] }, { status: 500 });

  // Hydrate with correction + canonical + audit context so UI is one round-trip.
  const items = data ?? [];
  const correctionIds = items.map((r) => r.correction_id).filter(Boolean) as string[];
  const canonicalIds = items.map((r) => r.canonical_knowledge_id).filter(Boolean) as string[];
  const auditIds = items.map((r) => r.audit_id).filter(Boolean) as string[];

  const [corrections, canonical, audits] = await Promise.all([
    correctionIds.length
      ? supabase
          .from("corrections")
          .select(
            "id, symptom_summary, prior_ai_summary, root_cause, fix_steps, machine_model, created_by, created_at, conversation_channel",
          )
          .in("id", correctionIds)
      : Promise.resolve({ data: [] as any[] } as any),
    canonicalIds.length
      ? supabase
          .from("canonical_knowledge")
          .select("id, title, law_text, product_slug, subsystem, status, machine_model")
          .in("id", canonicalIds)
      : Promise.resolve({ data: [] as any[] } as any),
    auditIds.length
      ? supabase
          .from("answer_audit")
          .select("id, user_query, assistant_text, product_slug, resolver_meta, evidence, created_at")
          .in("id", auditIds)
      : Promise.resolve({ data: [] as any[] } as any),
  ]);

  const byId = <T extends { id: string }>(rows: T[] | null | undefined): Record<string, T> => {
    const out: Record<string, T> = {};
    for (const r of rows ?? []) out[r.id] = r;
    return out;
  };
  const cMap = byId((corrections.data as any[]) ?? []);
  const kMap = byId((canonical.data as any[]) ?? []);
  const aMap = byId((audits.data as any[]) ?? []);

  return NextResponse.json({
    items: items.map((r) => ({
      ...r,
      correction: r.correction_id ? cMap[r.correction_id] ?? null : null,
      canonical: r.canonical_knowledge_id ? kMap[r.canonical_knowledge_id] ?? null : null,
      audit: r.audit_id ? aMap[r.audit_id] ?? null : null,
    })),
  });
}

const actionSchema = z.object({
  id: z.string().uuid(),
  action: z.enum(["approve", "reject", "edit_and_approve"]),
  reviewed_by: z.string().min(1),
  review_notes: z.string().optional().nullable(),
  edits: z
    .object({
      title: z.string().optional().nullable(),
      law_text: z.string().optional().nullable(),
      machine_model: z.string().optional().nullable(),
      product_slug: z.string().optional().nullable(),
    })
    .optional(),
});

export async function POST(req: NextRequest) {
  const init = getSupabaseAdminClientSafe();
  if (!init.ok) return NextResponse.json({ error: init.error }, { status: 503 });
  const supabase = init.client;

  const body = await req.json().catch(() => null);
  const parsed = actionSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  const p = parsed.data;

  const { data: row, error: rowErr } = await supabase
    .from("correction_review_queue")
    .select("id, correction_id, canonical_knowledge_id, proposed_title, proposed_law_text, proposed_machine_model, proposed_product_slug, status")
    .eq("id", p.id)
    .maybeSingle();
  if (rowErr || !row) return NextResponse.json({ error: rowErr?.message ?? "queue row not found" }, { status: 404 });
  if (row.status !== "pending" && row.status !== "edited") {
    return NextResponse.json({ error: `already ${row.status}` }, { status: 409 });
  }

  if (p.action === "reject") {
    await supabase
      .from("correction_review_queue")
      .update({ status: "rejected", reviewed_by: p.reviewed_by, reviewed_at: new Date().toISOString(), review_notes: p.review_notes ?? null })
      .eq("id", p.id);
    if (row.canonical_knowledge_id) {
      await supabase
        .from("canonical_knowledge")
        .update({ status: "rejected" })
        .eq("id", row.canonical_knowledge_id);
    }
    if (row.correction_id) {
      await supabase
        .from("corrections")
        .update({ review_status: "rejected", reviewed_by: p.reviewed_by, reviewed_at: new Date().toISOString() })
        .eq("id", row.correction_id);
    }
    return NextResponse.json({ ok: true, status: "rejected" });
  }

  // Approve or edit_and_approve: apply edits to canonical_knowledge, flip to active, and re-embed.
  const edits = p.edits ?? {};
  const finalTitle = edits.title ?? row.proposed_title ?? "Approved correction";
  const finalLawText = edits.law_text ?? row.proposed_law_text ?? "";
  const finalMachine = edits.machine_model ?? row.proposed_machine_model ?? null;
  const finalSlug = edits.product_slug ?? row.proposed_product_slug ?? null;

  let canonicalId = row.canonical_knowledge_id;
  const embedding = await embedSingle(finalLawText);

  if (canonicalId) {
    await supabase
      .from("canonical_knowledge")
      .update({
        title: finalTitle,
        law_text: finalLawText,
        machine_model: finalMachine,
        product_slug: finalSlug,
        status: "active",
        embedding,
        updated_at: new Date().toISOString(),
      })
      .eq("id", canonicalId);
  } else if (row.correction_id) {
    const { data: inserted } = await supabase
      .from("canonical_knowledge")
      .insert({
        correction_id: row.correction_id,
        title: finalTitle,
        law_text: finalLawText,
        machine_model: finalMachine,
        product_slug: finalSlug,
        status: "active",
        embedding,
        created_by: p.reviewed_by,
      })
      .select("id")
      .single();
    canonicalId = (inserted as any)?.id ?? null;
  }

  await supabase
    .from("correction_review_queue")
    .update({
      status: p.action === "edit_and_approve" ? "edited" : "approved",
      reviewed_by: p.reviewed_by,
      reviewed_at: new Date().toISOString(),
      review_notes: p.review_notes ?? null,
      proposed_title: finalTitle,
      proposed_law_text: finalLawText,
      proposed_machine_model: finalMachine,
      proposed_product_slug: finalSlug,
      canonical_knowledge_id: canonicalId,
    })
    .eq("id", p.id);

  if (row.correction_id) {
    await supabase
      .from("corrections")
      .update({ review_status: "approved", reviewed_by: p.reviewed_by, reviewed_at: new Date().toISOString() })
      .eq("id", row.correction_id);
  }

  await supabase.from("runtime_learning_revisions").insert({
    reason: "canonical_approved",
    correction_id: row.correction_id,
  });

  return NextResponse.json({ ok: true, status: "approved", canonical_id: canonicalId });
}
