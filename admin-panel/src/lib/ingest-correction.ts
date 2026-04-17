import type { SupabaseClient } from "@supabase/supabase-js";

import { buildLearningSnippetText } from "@/lib/build-learning-snippet-text";
import { embedSingle } from "@/lib/embed-client";
import { classifyProduct, classifySubsystem, extractErrorCodes, extractSymptomTags } from "@/lib/product-classify";

type IngestInput = {
  source: "manual_note" | "synthesized_note" | "training_chat" | "queue_resolution";
  sourceRefId?: string | null;
  conversationChannel: "support" | "auth" | "training";
  supportSessionId?: string | null;
  supportMessageId?: string | null;
  authSessionId?: string | null;
  authMessageId?: string | null;
  trainingThreadId?: string | null;
  customerIdentifier?: string | null;
  machineModel?: string | null;
  machineSerial?: string | null;
  symptoms: string;
  priorAiSummary?: string | null;
  rootCause: string;
  fixSteps: string;
  partsUsed?: string | null;
  tags: string[];
  createdBy: string;
  /** Force canonical to go straight to active (bypasses review queue). */
  autoApproveCanonical?: boolean;
  // Legacy link so existing snippet relation survives migration.
  techNoteId?: string | null;
};

function normalizeTags(tags: string[]): string[] {
  return tags
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 40);
}

export async function ingestCorrection(
  supabase: SupabaseClient,
  input: IngestInput,
): Promise<{
  correctionId: string;
  conflictId: string | null;
  snippetId: string | null;
  reviewQueueId: string | null;
  canonicalStatus: "draft" | "active";
}> {
  const tags = normalizeTags(input.tags);

  const correctionInsert = await supabase
    .from("corrections")
    .insert({
      source: input.source,
      source_ref_id: input.sourceRefId ?? null,
      conversation_channel: input.conversationChannel,
      support_session_id: input.supportSessionId ?? null,
      support_message_id: input.supportMessageId ?? null,
      auth_session_id: input.authSessionId ?? null,
      auth_message_id: input.authMessageId ?? null,
      training_thread_id: input.trainingThreadId ?? null,
      customer_identifier: input.customerIdentifier ?? null,
      machine_model: input.machineModel ?? null,
      machine_serial: input.machineSerial ?? null,
      symptom_summary: input.symptoms,
      prior_ai_summary: input.priorAiSummary ?? null,
      root_cause: input.rootCause,
      fix_steps: input.fixSteps,
      parts_used: input.partsUsed ?? null,
      tags,
      auto_applied: true,
      review_status: "pending",
      conflict_status: "none",
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (correctionInsert.error || !correctionInsert.data) {
    throw new Error(correctionInsert.error?.message ?? "Failed to create correction");
  }

  const correctionId = correctionInsert.data.id as string;

  const lawText = [
    `When symptoms match: ${input.symptoms}`,
    input.priorAiSummary?.trim() ? `Previous AI guidance: ${input.priorAiSummary.trim()}` : null,
    `Verified root cause: ${input.rootCause}`,
    `Verified fix: ${input.fixSteps}`,
    input.partsUsed?.trim() ? `Parts: ${input.partsUsed.trim()}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  // Classify product + subsystem + symptoms/error codes once, reuse everywhere.
  const classifyHaystack = [input.symptoms, input.rootCause, input.fixSteps, input.machineModel ?? ""].join("\n");
  const productSlug = classifyProduct(classifyHaystack, input.machineModel ?? null);
  const subsystem = classifySubsystem(classifyHaystack);
  const symptomTags = Array.from(new Set([...tags, ...extractSymptomTags(classifyHaystack)]));
  const errorCodes = extractErrorCodes(classifyHaystack);

  // Embed law text (best-effort; a null embedding still ranks via lexical + tags).
  const lawEmbedding = await embedSingle(lawText);

  // Canonical: default to 'draft' and route through the review queue, unless
  // the caller explicitly requests auto-approval (migration backfill / admin override).
  const canonicalStatus: "draft" | "active" = input.autoApproveCanonical ? "active" : "draft";

  const canonInsert = await supabase
    .from("canonical_knowledge")
    .insert({
      correction_id: correctionId,
      title: (input.machineModel?.trim() || productSlug || "General") + " field correction",
      law_text: lawText,
      machine_model: input.machineModel ?? null,
      machine_serial: input.machineSerial ?? null,
      product_slug: productSlug,
      subsystem,
      symptom_tags: symptomTags,
      error_codes: errorCodes,
      tags,
      status: canonicalStatus,
      embedding: lawEmbedding,
      created_by: input.createdBy,
    })
    .select("id")
    .single();

  if (canonInsert.error || !canonInsert.data) {
    throw new Error(canonInsert.error?.message ?? "Failed to create canonical knowledge");
  }

  // Simple conflict check: same model/tag set but materially different root cause text.
  const { data: potentialConflicts } = await supabase
    .from("canonical_knowledge")
    .select("id, law_text, machine_model, product_slug")
    .eq("status", "active")
    .neq("id", canonInsert.data.id)
    .limit(30);

  let conflictId: string | null = null;
  const isConflict = (potentialConflicts ?? []).some((c: any) => {
    const sameProduct = !productSlug || !c.product_slug || c.product_slug === productSlug;
    const sameModel =
      !input.machineModel ||
      !c.machine_model ||
      String(c.machine_model).toLowerCase() === input.machineModel.toLowerCase();
    const mentionsRoot = String(c.law_text ?? "")
      .toLowerCase()
      .includes(input.rootCause.toLowerCase());
    return (sameProduct || sameModel) && !mentionsRoot;
  });

  if (isConflict) {
    await supabase.from("corrections").update({ conflict_status: "flagged" }).eq("id", correctionId);
    const ins = await supabase
      .from("correction_conflicts")
      .insert({
        correction_id: correctionId,
        canonical_knowledge_id: canonInsert.data.id,
        reason: "Potential contradiction against existing canonical guidance; manual review required.",
        status: "open",
      })
      .select("id")
      .single();
    conflictId = ins.data?.id ?? null;
  }

  // Snippet: always active immediately (fast feedback loop; canonical gate handles the long-lived law).
  const snippetText = buildLearningSnippetText({
    symptoms: input.symptoms,
    root_cause: input.rootCause,
    fix_steps: input.fixSteps,
    parts_used: input.partsUsed ?? null,
    prior_assistant_summary: input.priorAiSummary ?? null,
    tags,
  });
  const snippetEmbedding = await embedSingle(snippetText);

  // learning_snippets_tech_note_id_key is a PARTIAL unique index
  // (`where tech_note_id is not null`), which Postgres refuses to match
  // against ON CONFLICT (tech_note_id). So we do lookup-then-update/insert
  // instead of upsert.
  const snippetPayload = {
    correction_id: correctionId,
    snippet_text: snippetText,
    machine_model: input.machineModel ?? null,
    machine_serial: input.machineSerial ?? null,
    issue_tags: tags,
    product_slug: productSlug,
    subsystem,
    symptom_tags: symptomTags,
    error_codes: errorCodes,
    embedding: snippetEmbedding,
    confidence: 0.7,
    status: "active",
  };

  let snippetId: string | null = null;
  if (input.techNoteId) {
    const existing = await supabase
      .from("learning_snippets")
      .select("id")
      .eq("tech_note_id", input.techNoteId)
      .maybeSingle();
    if (existing.error) throw new Error(existing.error.message);
    if (existing.data?.id) {
      const upd = await supabase
        .from("learning_snippets")
        .update(snippetPayload)
        .eq("id", existing.data.id)
        .select("id")
        .single();
      if (upd.error) throw new Error(upd.error.message);
      snippetId = upd.data.id;
    }
  }
  if (!snippetId) {
    const ins = await supabase
      .from("learning_snippets")
      .insert({ tech_note_id: input.techNoteId ?? null, ...snippetPayload })
      .select("id")
      .single();
    if (ins.error) throw new Error(ins.error.message);
    snippetId = ins.data.id;
  }

  // Review queue: always open a row when canonical is in draft, or when a conflict fired.
  let reviewQueueId: string | null = null;
  if (canonicalStatus === "draft" || conflictId) {
    const source =
      input.source === "manual_note"
        ? "admin_manual"
        : input.source === "synthesized_note"
        ? "admin_synthesized"
        : "admin_training";
    const { data: q } = await supabase
      .from("correction_review_queue")
      .insert({
        correction_id: correctionId,
        canonical_knowledge_id: canonInsert.data.id,
        source: conflictId ? "conflict" : source,
        priority: conflictId ? "high" : "normal",
        reason: conflictId
          ? "Potential conflict with existing canonical guidance"
          : "New canonical rule awaiting admin approval",
        proposed_title: (input.machineModel?.trim() || productSlug || "General") + " field correction",
        proposed_law_text: lawText,
        proposed_machine_model: input.machineModel ?? null,
        proposed_product_slug: productSlug,
        status: "pending",
        created_by: input.createdBy,
      })
      .select("id")
      .single();
    reviewQueueId = (q as any)?.id ?? null;
  }

  const { data: promptRow } = await supabase
    .from("prompt_versions")
    .select("id")
    .eq("prompt_key", "support-system")
    .eq("is_active", true)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();

  await supabase.from("runtime_learning_revisions").insert({
    reason: "correction_ingested",
    correction_id: correctionId,
    prompt_version_id: promptRow?.id ?? null,
  });

  return {
    correctionId,
    conflictId,
    snippetId,
    reviewQueueId,
    canonicalStatus,
  };
}
