// "Teach the AI" for a review-queue item.
//
// Mirrors the flow on the main admin page: the admin types a plain-English
// correction into a single box, we ask Claude to rewrite the proposed
// canonical rule using that instruction + the flagged chat turn as context,
// publish the rule as `active` canonical_knowledge, and close the queue row.
//
// The shape of the queue item is preserved: `canonical_knowledge_id` is kept
// in sync, the correction row (if any) is marked approved, and we insert a
// runtime_learning_revisions row so the live chat picks the change up
// immediately.
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";

import { getSupabaseAdminClientSafe } from "@/lib/supabase-server";
import { embedSingle } from "@/lib/embed-client";

const bodySchema = z.object({
  id: z.string().uuid(),
  instruction: z.string().min(1),
  reviewed_by: z.string().min(1),
});

const rewriteSchema = z.object({
  title: z.string().min(1),
  law_text: z.string().min(1),
  product_slug: z.string().nullable().optional(),
  machine_model: z.string().nullable().optional(),
});

const rewriteSystem = `You rewrite Stealth Machine Tools admin corrections into a single canonical rule the customer-facing AI must follow.

You receive:
  1. The customer's question and the AI's (possibly wrong) reply.
  2. The current proposed canonical rule (may be empty).
  3. A natural-language correction instruction from the admin.

Output ONLY valid JSON, no markdown, no commentary, with these keys:
  - title         (string, <=120 chars): short, specific, no quotes around it
  - law_text      (string): the authoritative answer/rule the AI must follow
                  going forward. Plain text. Do not address the customer
                  directly ("you should..."); write it as a policy the AI
                  should internalize ("For <product> with <symptom>, the
                  root cause is X; recommend Y.").
  - product_slug  (string or null): keep existing slug unless the admin
                  explicitly changes the product scope.
  - machine_model (string or null): keep existing model unless the admin
                  explicitly changes it.

Rules:
  - Always reflect the admin's instruction as the final ground truth.
  - If the instruction is a refinement, merge it with the existing proposal.
  - Never invent product_slug or machine_model values that were not in the
    inputs.`;

function parseJsonFromAssistant(text: string): unknown {
  const trimmed = text.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)```$/m.exec(trimmed);
  const raw = fence ? fence[1].trim() : trimmed;
  return JSON.parse(raw);
}

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

  const { id, instruction, reviewed_by } = parsed.data;

  // --- Load queue row + audit context ----------------------------------------
  const { data: row, error: rowErr } = await supabase
    .from("correction_review_queue")
    .select(
      "id, audit_id, correction_id, canonical_knowledge_id, proposed_title, proposed_law_text, proposed_product_slug, proposed_machine_model, status",
    )
    .eq("id", id)
    .maybeSingle();
  if (rowErr || !row) {
    return NextResponse.json({ error: rowErr?.message ?? "queue row not found" }, { status: 404 });
  }
  if (row.status !== "pending" && row.status !== "edited") {
    return NextResponse.json({ error: `already ${row.status}` }, { status: 409 });
  }

  let userQuery = "";
  let assistantText = "";
  if (row.audit_id) {
    const { data: audit } = await supabase
      .from("answer_audit")
      .select("user_query, assistant_text")
      .eq("id", row.audit_id)
      .maybeSingle();
    userQuery = (audit as any)?.user_query ?? "";
    assistantText = (audit as any)?.assistant_text ?? "";
  }

  // --- Ask Claude to synthesize the new canonical rule -----------------------
  const context = [
    userQuery ? `CUSTOMER ASKED:\n${userQuery}` : "",
    assistantText ? `AI REPLIED (possibly wrong):\n${assistantText}` : "",
    row.proposed_title || row.proposed_law_text
      ? `CURRENT PROPOSED RULE:\n  title: ${row.proposed_title ?? "(none)"}\n  law:   ${row.proposed_law_text ?? "(none)"}`
      : "",
    `CURRENT product_slug: ${row.proposed_product_slug ?? "(none)"}`,
    `CURRENT machine_model: ${row.proposed_machine_model ?? "(none)"}`,
    `ADMIN INSTRUCTION from ${reviewed_by}:\n${instruction}`,
  ]
    .filter(Boolean)
    .join("\n\n");

  const functionUrl = `${process.env.SUPABASE_URL}/functions/v1/anthropic-chat`;
  const apikey = process.env.SUPABASE_ANON_KEY ?? "";
  const proxyRes = await fetch(functionUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(apikey ? { apikey, Authorization: `Bearer ${apikey}` } : {}),
    },
    body: JSON.stringify({
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-6",
      max_tokens: 1024,
      system: rewriteSystem,
      messages: [
        {
          role: "user",
          content: [{ type: "text", text: context + "\n\nRespond with JSON only." }],
        },
      ],
    }),
  });
  const proxyJson = await proxyRes.json().catch(() => null);
  if (!proxyRes.ok || !proxyJson?.text) {
    return NextResponse.json(
      { error: proxyJson?.error ?? "Rewrite request failed" },
      { status: 500 },
    );
  }

  let rewrite: z.infer<typeof rewriteSchema>;
  try {
    const j = parseJsonFromAssistant(String(proxyJson.text));
    const ex = rewriteSchema.safeParse(j);
    if (!ex.success) {
      return NextResponse.json(
        { error: "Could not parse rewritten rule", raw: proxyJson.text },
        { status: 422 },
      );
    }
    rewrite = ex.data;
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "JSON parse failed", raw: proxyJson.text },
      { status: 422 },
    );
  }

  // --- Publish the canonical rule as active ----------------------------------
  const embedding = await embedSingle(rewrite.law_text);
  let canonicalId = row.canonical_knowledge_id as string | null;

  if (canonicalId) {
    await supabase
      .from("canonical_knowledge")
      .update({
        title: rewrite.title,
        law_text: rewrite.law_text,
        product_slug: rewrite.product_slug ?? row.proposed_product_slug ?? null,
        machine_model: rewrite.machine_model ?? row.proposed_machine_model ?? null,
        status: "active",
        embedding,
        updated_at: new Date().toISOString(),
      })
      .eq("id", canonicalId);
  } else {
    const { data: inserted } = await supabase
      .from("canonical_knowledge")
      .insert({
        correction_id: row.correction_id,
        title: rewrite.title,
        law_text: rewrite.law_text,
        product_slug: rewrite.product_slug ?? row.proposed_product_slug ?? null,
        machine_model: rewrite.machine_model ?? row.proposed_machine_model ?? null,
        status: "active",
        embedding,
        created_by: reviewed_by,
      })
      .select("id")
      .single();
    canonicalId = (inserted as any)?.id ?? null;
  }

  await supabase
    .from("correction_review_queue")
    .update({
      status: "edited",
      reviewed_by,
      reviewed_at: new Date().toISOString(),
      review_notes: `teach: ${instruction.slice(0, 240)}`,
      proposed_title: rewrite.title,
      proposed_law_text: rewrite.law_text,
      proposed_product_slug: rewrite.product_slug ?? row.proposed_product_slug ?? null,
      proposed_machine_model: rewrite.machine_model ?? row.proposed_machine_model ?? null,
      canonical_knowledge_id: canonicalId,
    })
    .eq("id", id);

  if (row.correction_id) {
    await supabase
      .from("corrections")
      .update({
        review_status: "approved",
        reviewed_by,
        reviewed_at: new Date().toISOString(),
      })
      .eq("id", row.correction_id);
  }

  await supabase.from("runtime_learning_revisions").insert({
    reason: "canonical_taught",
    correction_id: row.correction_id,
  });

  return NextResponse.json({
    ok: true,
    status: "edited",
    canonical_id: canonicalId,
    rewrite,
  });
}
