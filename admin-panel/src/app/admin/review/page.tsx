"use client";

// Review queue UI.
//
// Previously this page asked admins to edit four raw DB fields (title,
// slug, machine_model, law_text) which felt like a database form instead
// of a correction flow. The new layout mirrors the "Teach the AI" pattern
// from the main admin page:
//
//   - Show the flagged chat turn and the current proposed rule as prose.
//   - Give the admin ONE natural-language textarea to say how the AI
//     should have answered.
//   - A primary "Teach the AI" button sends that instruction to Claude,
//     which rewrites the canonical rule and publishes it live (same
//     retrieval path the customer chat uses).
//   - Quick "Approve as-is" and "Reject" buttons for clear cases.
//   - Raw field editor is hidden behind a disclosure for power users.

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { readJsonBody } from "@/lib/safe-fetch-json";

type QueueItem = {
  id: string;
  correction_id: string | null;
  canonical_knowledge_id: string | null;
  audit_id: string | null;
  source: string;
  priority: string;
  reason: string;
  proposed_title: string | null;
  proposed_law_text: string | null;
  proposed_machine_model: string | null;
  proposed_product_slug: string | null;
  status: string;
  reviewed_by: string | null;
  reviewed_at: string | null;
  review_notes: string | null;
  created_by: string;
  created_at: string;
  correction: {
    symptom_summary?: string | null;
    prior_ai_summary?: string | null;
    root_cause?: string | null;
    fix_steps?: string | null;
    machine_model?: string | null;
    conversation_channel?: string | null;
  } | null;
  canonical: {
    id: string;
    title: string;
    law_text: string;
    product_slug: string | null;
    subsystem: string | null;
    status: string;
    machine_model: string | null;
  } | null;
  audit: {
    id: string;
    user_query: string | null;
    assistant_text: string | null;
    product_slug: string | null;
    evidence: Array<any> | null;
    resolver_meta: Record<string, unknown> | null;
  } | null;
};

type AdvancedEdits = {
  title: string;
  law_text: string;
  machine_model: string;
  product_slug: string;
};

export default function ReviewPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<
    "pending" | "approved" | "rejected" | "edited"
  >("pending");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState("admin");

  const [instructions, setInstructions] = useState<Record<string, string>>({});
  const [advanced, setAdvanced] = useState<Record<string, AdvancedEdits>>({});
  const [showAdvanced, setShowAdvanced] = useState<Record<string, boolean>>({});
  const [busyId, setBusyId] = useState<string | null>(null);
  const [statusMsg, setStatusMsg] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/review?status=${status}`);
      const { parsed, data, parseError } = await readJsonBody<{
        items?: QueueItem[];
        error?: string;
      }>(res);
      if (!parsed || !data) {
        setError(parseError ?? "Invalid response");
        setItems([]);
        return;
      }
      if (!res.ok) {
        setError(data.error ?? `HTTP ${res.status}`);
        setItems([]);
        return;
      }
      setItems(data.items ?? []);
      const nextAdvanced: Record<string, AdvancedEdits> = {};
      for (const it of data.items ?? []) {
        nextAdvanced[it.id] = {
          title: it.proposed_title ?? "",
          law_text: it.proposed_law_text ?? "",
          machine_model: it.proposed_machine_model ?? "",
          product_slug: it.proposed_product_slug ?? "",
        };
      }
      setAdvanced(nextAdvanced);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Plain-English correction → publish. Mirrors the main admin page's
  // "Teach the AI" flow.
  async function teach(it: QueueItem) {
    const instruction = (instructions[it.id] ?? "").trim();
    if (!instruction) {
      setStatusMsg((s) => ({
        ...s,
        [it.id]: "Type a correction in the box first.",
      }));
      return;
    }
    setBusyId(it.id);
    setStatusMsg((s) => ({ ...s, [it.id]: "Teaching the AI…" }));
    try {
      const res = await fetch("/api/admin/review/teach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: it.id,
          instruction,
          reviewed_by: reviewer,
        }),
      });
      const { parsed, data } = await readJsonBody<{
        error?: string;
        rewrite?: { title: string; law_text: string };
      }>(res);
      if (!res.ok || !parsed || !data || data.error) {
        setStatusMsg((s) => ({
          ...s,
          [it.id]: data?.error ?? `HTTP ${res.status}`,
        }));
        return;
      }
      setInstructions((s) => ({ ...s, [it.id]: "" }));
      setStatusMsg((s) => ({
        ...s,
        [it.id]: "Applied. The customer AI uses this on the next turn.",
      }));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  // Simple approve / reject. Same endpoint as before.
  async function simple(
    it: QueueItem,
    action: "approve" | "reject" | "edit_and_approve",
  ) {
    setBusyId(it.id);
    try {
      const body: any = {
        id: it.id,
        action,
        reviewed_by: reviewer,
      };
      if (action === "edit_and_approve") {
        body.edits = advanced[it.id];
      }
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const { parsed, data } = await readJsonBody<{ error?: string }>(res);
      if (!res.ok || !parsed || !data || data.error) {
        setStatusMsg((s) => ({
          ...s,
          [it.id]: data?.error ?? `HTTP ${res.status}`,
        }));
        return;
      }
      setStatusMsg((s) => ({
        ...s,
        [it.id]:
          action === "reject"
            ? "Rejected."
            : "Published. Live on next customer turn.",
      }));
      await load();
    } finally {
      setBusyId(null);
    }
  }

  const counts = useMemo(() => ({ shown: items.length }), [items.length]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-[1200px] space-y-4">
        <header className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Correction Review Queue</h1>
            <p className="text-sm text-slate-400">
              Items the auto-grader or ingestion flagged for a human look. Type
              how the AI should have answered, hit{" "}
              <span className="font-medium text-slate-200">Teach the AI</span>,
              and the fix goes live on the next customer turn.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin"
              className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300"
            >
              Back to dashboard
            </Link>
            <button
              type="button"
              onClick={() => void load()}
              className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300"
            >
              Refresh
            </button>
          </div>
        </header>

        <section className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-800 bg-slate-900 p-3">
          <label className="text-xs uppercase text-slate-400">Status</label>
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as any)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          >
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="edited">Edited + approved</option>
            <option value="rejected">Rejected</option>
          </select>
          <label className="ml-4 text-xs uppercase text-slate-400">
            Reviewer
          </label>
          <input
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
          <span className="ml-auto text-xs text-slate-500">
            {counts.shown} items
          </span>
        </section>

        {error ? (
          <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-4 text-sm text-amber-100">
            {error}
          </div>
        ) : null}

        {loading ? <p className="text-sm text-slate-400">Loading…</p> : null}

        <div className="space-y-4">
          {items.length === 0 && !loading ? (
            <p className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-sm text-slate-400">
              Queue is clear for status={status}.
            </p>
          ) : null}
          {items.map((it) => {
            const adv =
              advanced[it.id] ?? {
                title: "",
                law_text: "",
                machine_model: "",
                product_slug: "",
              };
            const instruction = instructions[it.id] ?? "";
            const msg = statusMsg[it.id];
            const advOpen = !!showAdvanced[it.id];
            const canEdit = it.status === "pending" || it.status === "edited";

            return (
              <article
                key={it.id}
                className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-4"
              >
                <header className="flex flex-wrap items-center gap-2 text-xs text-slate-400">
                  <span className="rounded bg-slate-800 px-2 py-0.5 uppercase tracking-wide">
                    {it.source}
                  </span>
                  <span
                    className={`rounded px-2 py-0.5 uppercase tracking-wide ${
                      it.priority === "urgent" || it.priority === "high"
                        ? "bg-red-900/60 text-red-200"
                        : "bg-slate-800 text-slate-300"
                    }`}
                  >
                    {it.priority}
                  </span>
                  <span>{new Date(it.created_at).toLocaleString()}</span>
                  <span className="ml-auto text-slate-500">
                    {it.proposed_product_slug ?? "general"} ·{" "}
                    {it.proposed_machine_model ?? "—"}
                  </span>
                </header>

                <p className="text-sm text-amber-200/90">{it.reason}</p>

                {/* The chat turn that triggered the flag — the thing the admin
                    is actually correcting. */}
                {it.audit ? (
                  <div className="space-y-2 rounded-md border border-slate-800 bg-slate-950/80 p-3 text-sm">
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">
                        Customer asked
                      </p>
                      <p className="whitespace-pre-wrap text-slate-200">
                        {it.audit.user_query ?? "—"}
                      </p>
                    </div>
                    <div>
                      <p className="text-[10px] uppercase tracking-wide text-slate-500">
                        AI replied
                      </p>
                      <p className="whitespace-pre-wrap text-slate-300">
                        {it.audit.assistant_text ?? "—"}
                      </p>
                    </div>
                  </div>
                ) : null}

                {/* Current proposed rule, shown as readable prose. */}
                {(it.proposed_title || it.proposed_law_text) && (
                  <div className="rounded-md border border-sky-900/60 bg-sky-950/30 p-3 text-sm">
                    <p className="text-[10px] uppercase tracking-wide text-sky-300">
                      Current proposed fix
                    </p>
                    <p className="mt-1 font-medium text-slate-100">
                      {it.proposed_title ?? "(no title)"}
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-slate-300">
                      {it.proposed_law_text ?? "(no rule text)"}
                    </p>
                  </div>
                )}

                {/* Plain-English correction box — the main interaction. */}
                <div className="space-y-2">
                  <label className="text-xs uppercase tracking-wide text-slate-400">
                    How should the AI have answered?
                  </label>
                  <textarea
                    value={instruction}
                    onChange={(e) =>
                      setInstructions((s) => ({ ...s, [it.id]: e.target.value }))
                    }
                    rows={3}
                    disabled={!canEdit || busyId === it.id}
                    placeholder={
                      it.proposed_law_text
                        ? "Refine the proposed fix above, or write the correct answer in plain English…"
                        : "Write the correct answer in plain English. The AI will turn it into a canonical rule and use it immediately."
                    }
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm placeholder:text-slate-500 disabled:opacity-50"
                  />
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      disabled={
                        !canEdit || busyId === it.id || !instruction.trim()
                      }
                      onClick={() => void teach(it)}
                      className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      {busyId === it.id ? "Teaching…" : "Teach the AI"}
                    </button>
                    <button
                      type="button"
                      disabled={
                        !canEdit ||
                        busyId === it.id ||
                        (!it.proposed_law_text && !it.canonical?.law_text)
                      }
                      onClick={() => void simple(it, "approve")}
                      className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      title="Publish the current proposed fix as-is"
                    >
                      Approve as-is
                    </button>
                    <button
                      type="button"
                      disabled={!canEdit || busyId === it.id}
                      onClick={() => void simple(it, "reject")}
                      className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() =>
                        setShowAdvanced((s) => ({ ...s, [it.id]: !advOpen }))
                      }
                      className="ml-auto text-xs text-slate-400 underline-offset-2 hover:text-slate-200 hover:underline"
                    >
                      {advOpen ? "Hide advanced" : "Advanced fields"}
                    </button>
                  </div>
                  {msg ? (
                    <p className="text-xs text-slate-300">{msg}</p>
                  ) : null}
                  <p className="text-[11px] text-slate-500">
                    Status:{" "}
                    <span className="font-medium text-slate-300">
                      {it.status}
                    </span>
                    {it.reviewed_by ? ` · by ${it.reviewed_by}` : ""}
                  </p>
                </div>

                {advOpen ? (
                  <details
                    open
                    className="rounded-md border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-300"
                  >
                    <summary className="cursor-pointer font-medium text-slate-200">
                      Advanced: edit raw fields
                    </summary>
                    <div className="mt-3 space-y-2">
                      <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                        <input
                          value={adv.title}
                          onChange={(e) =>
                            setAdvanced((s) => ({
                              ...s,
                              [it.id]: { ...adv, title: e.target.value },
                            }))
                          }
                          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                          placeholder="Canonical title"
                        />
                        <input
                          value={adv.product_slug}
                          onChange={(e) =>
                            setAdvanced((s) => ({
                              ...s,
                              [it.id]: {
                                ...adv,
                                product_slug: e.target.value,
                              },
                            }))
                          }
                          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                          placeholder="product_slug (e.g. ss3015cp)"
                        />
                        <input
                          value={adv.machine_model}
                          onChange={(e) =>
                            setAdvanced((s) => ({
                              ...s,
                              [it.id]: {
                                ...adv,
                                machine_model: e.target.value,
                              },
                            }))
                          }
                          className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                          placeholder="Machine model (optional)"
                        />
                      </div>
                      <textarea
                        value={adv.law_text}
                        onChange={(e) =>
                          setAdvanced((s) => ({
                            ...s,
                            [it.id]: { ...adv, law_text: e.target.value },
                          }))
                        }
                        rows={5}
                        className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2"
                        placeholder="Canonical rule text the AI will follow"
                      />
                      <button
                        type="button"
                        disabled={!canEdit || busyId === it.id}
                        onClick={() => void simple(it, "edit_and_approve")}
                        className="rounded-md bg-sky-700 px-3 py-2 text-sm font-medium text-white disabled:opacity-50"
                      >
                        Save raw edits + approve
                      </button>
                    </div>
                  </details>
                ) : null}

                {it.audit && it.audit.evidence && it.audit.evidence.length > 0 ? (
                  <details className="rounded-md border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-400">
                    <summary className="cursor-pointer text-slate-300">
                      Evidence used in the flagged reply
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {it.audit.evidence.map((e: any) => (
                        <li key={`${e.idx}-${e.id}`}>
                          [E{e.idx}] {e.type} · {e.product_slug ?? "general"} ·{" "}
                          {e.heading ?? "(no heading)"} · score{" "}
                          {Number(e.score ?? 0).toFixed(2)}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}

                {it.correction ? (
                  <details className="rounded-md border border-slate-800 bg-slate-950/70 p-3 text-xs text-slate-400">
                    <summary className="cursor-pointer text-slate-300">
                      Original technician correction (source)
                    </summary>
                    <div className="mt-2 space-y-1">
                      <p>
                        <span className="text-slate-500">symptoms:</span>{" "}
                        {it.correction.symptom_summary}
                      </p>
                      {it.correction.prior_ai_summary ? (
                        <p>
                          <span className="text-slate-500">prior AI:</span>{" "}
                          {it.correction.prior_ai_summary}
                        </p>
                      ) : null}
                      <p>
                        <span className="text-slate-500">root cause:</span>{" "}
                        {it.correction.root_cause}
                      </p>
                      <p>
                        <span className="text-slate-500">fix:</span>{" "}
                        {it.correction.fix_steps}
                      </p>
                    </div>
                  </details>
                ) : null}
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
