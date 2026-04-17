"use client";

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

type Action = "approve" | "reject" | "edit_and_approve";

export default function ReviewPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [status, setStatus] = useState<"pending" | "approved" | "rejected" | "edited">("pending");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reviewer, setReviewer] = useState("admin");
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [edits, setEdits] = useState<
    Record<string, { title: string; law_text: string; machine_model: string; product_slug: string }>
  >({});
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/review?status=${status}`);
      const { parsed, data, parseError } = await readJsonBody<{ items?: QueueItem[]; error?: string }>(res);
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
      // Seed edit state from proposed fields so textarea shows current text.
      const nextEdits: typeof edits = {};
      for (const it of data.items ?? []) {
        nextEdits[it.id] = {
          title: it.proposed_title ?? "",
          law_text: it.proposed_law_text ?? "",
          machine_model: it.proposed_machine_model ?? "",
          product_slug: it.proposed_product_slug ?? "",
        };
      }
      setEdits(nextEdits);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load review queue");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => {
    void load();
  }, [load]);

  async function submit(id: string, action: Action) {
    setBusyId(id);
    try {
      const body: any = {
        id,
        action,
        reviewed_by: reviewer,
        review_notes: notes[id] || null,
      };
      if (action === "edit_and_approve") {
        body.edits = edits[id];
      }
      const res = await fetch("/api/admin/review", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const { parsed, data } = await readJsonBody<{ error?: string }>(res);
      if (!res.ok || !parsed || !data || data.error) {
        alert(data?.error ?? `HTTP ${res.status}`);
        return;
      }
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
              Every new canonical rule, auto-flagged reply, and flagged conflict lands here. Approve to
              publish to the customer AI&apos;s runtime retrieval. Reject to discard.
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
          <label className="ml-4 text-xs uppercase text-slate-400">Reviewer</label>
          <input
            value={reviewer}
            onChange={(e) => setReviewer(e.target.value)}
            className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
          />
          <span className="ml-auto text-xs text-slate-500">{counts.shown} items</span>
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
            const ed = edits[it.id] ?? { title: "", law_text: "", machine_model: "", product_slug: "" };
            return (
              <article key={it.id} className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-3">
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
                    {it.proposed_product_slug ?? "general"} · {it.proposed_machine_model ?? "—"}
                  </span>
                </header>

                <p className="text-sm text-amber-200/90">{it.reason}</p>

                {it.audit ? (
                  <details className="rounded-md border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-300">
                    <summary className="cursor-pointer font-medium text-slate-200">
                      Flagged chat turn &amp; evidence used
                    </summary>
                    <div className="mt-2 space-y-2">
                      <div>
                        <p className="text-[10px] uppercase text-slate-500">Customer asked</p>
                        <p className="whitespace-pre-wrap">{it.audit.user_query ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-slate-500">Assistant replied</p>
                        <p className="whitespace-pre-wrap">{it.audit.assistant_text ?? "—"}</p>
                      </div>
                      <div>
                        <p className="text-[10px] uppercase text-slate-500">Evidence shown</p>
                        <ul className="space-y-1">
                          {(it.audit.evidence ?? []).map((e: any) => (
                            <li key={`${e.idx}-${e.id}`}>
                              [E{e.idx}] {e.type} · {e.product_slug ?? "general"} ·{" "}
                              {e.heading ?? "(no heading)"} · score {Number(e.score ?? 0).toFixed(2)}
                            </li>
                          ))}
                          {(!it.audit.evidence || it.audit.evidence.length === 0) && (
                            <li className="text-slate-500">no evidence</li>
                          )}
                        </ul>
                      </div>
                    </div>
                  </details>
                ) : null}

                {it.correction ? (
                  <details className="rounded-md border border-slate-800 bg-slate-950/80 p-3 text-xs text-slate-300">
                    <summary className="cursor-pointer font-medium text-slate-200">
                      Tech correction (source)
                    </summary>
                    <div className="mt-2 space-y-1">
                      <p>
                        <span className="text-slate-500">symptoms:</span> {it.correction.symptom_summary}
                      </p>
                      {it.correction.prior_ai_summary ? (
                        <p>
                          <span className="text-slate-500">prior AI:</span>{" "}
                          {it.correction.prior_ai_summary}
                        </p>
                      ) : null}
                      <p>
                        <span className="text-slate-500">root cause:</span> {it.correction.root_cause}
                      </p>
                      <p>
                        <span className="text-slate-500">fix:</span> {it.correction.fix_steps}
                      </p>
                    </div>
                  </details>
                ) : null}

                <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                  <input
                    value={ed.title}
                    onChange={(e) =>
                      setEdits((s) => ({ ...s, [it.id]: { ...ed, title: e.target.value } }))
                    }
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="Canonical title"
                  />
                  <input
                    value={ed.product_slug}
                    onChange={(e) =>
                      setEdits((s) => ({ ...s, [it.id]: { ...ed, product_slug: e.target.value } }))
                    }
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="product_slug (e.g. ss3015cp)"
                  />
                  <input
                    value={ed.machine_model}
                    onChange={(e) =>
                      setEdits((s) => ({ ...s, [it.id]: { ...ed, machine_model: e.target.value } }))
                    }
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="Machine model (optional)"
                  />
                  <input
                    value={notes[it.id] ?? ""}
                    onChange={(e) => setNotes((s) => ({ ...s, [it.id]: e.target.value }))}
                    className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="Review notes (optional)"
                  />
                </div>
                <textarea
                  value={ed.law_text}
                  onChange={(e) =>
                    setEdits((s) => ({ ...s, [it.id]: { ...ed, law_text: e.target.value } }))
                  }
                  rows={5}
                  className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  placeholder="Canonical rule text the AI will follow"
                />

                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    disabled={busyId === it.id || it.status !== "pending"}
                    onClick={() => void submit(it.id, "approve")}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === it.id || it.status !== "pending"}
                    onClick={() => void submit(it.id, "edit_and_approve")}
                    className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Save edits + approve
                  </button>
                  <button
                    type="button"
                    disabled={busyId === it.id || it.status !== "pending"}
                    onClick={() => void submit(it.id, "reject")}
                    className="rounded-md bg-red-700 px-3 py-2 text-sm font-medium disabled:opacity-50"
                  >
                    Reject
                  </button>
                  <span className="ml-auto text-xs text-slate-500">
                    status: <span className="font-medium">{it.status}</span>
                    {it.reviewed_by ? ` · by ${it.reviewed_by}` : ""}
                  </span>
                </div>
              </article>
            );
          })}
        </div>
      </div>
    </main>
  );
}
