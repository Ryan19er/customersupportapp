/** Narrative block fed to the customer-facing AI via `learning_snippets.snippet_text`. */

export function buildLearningSnippetText(note: {
  symptoms: string;
  root_cause: string;
  fix_steps: string;
  parts_used?: string | null | undefined;
  prior_assistant_summary?: string | null | undefined;
  note_intent?: "good_advice" | "bad_advice" | "correction";
  tags?: string[];
}): string {
  const prior = note.prior_assistant_summary?.trim();
  const intent = note.note_intent ?? "correction";
  const intentLine =
    intent === "good_advice"
      ? "Learning intent: good_advice (verified guidance to keep using)."
      : "Learning intent: correction (override prior incorrect advice for this symptom/model).";
  const lines = [
    "FIELD-VERIFIED (Stealth technician — after real visit or confirmed fix):",
    intentLine,
    `Customer / symptom: ${note.symptoms.trim()}`,
    prior && prior.length > 0
      ? `Prior AI troubleshooting (incomplete; keep suggesting checks, but this was the real issue): ${prior}`
      : null,
    `Root cause: ${note.root_cause.trim()}`,
    `Fix: ${note.fix_steps.trim()}`,
    note.parts_used?.trim() ? `Parts: ${note.parts_used.trim()}` : null,
    note.tags?.length ? `Tags: ${note.tags.join(", ")}` : null,
  ].filter((x): x is string => Boolean(x));
  return lines.join("\n");
}
