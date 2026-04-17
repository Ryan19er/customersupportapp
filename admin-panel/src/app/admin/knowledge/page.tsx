"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { readJsonBody } from "@/lib/safe-fetch-json";

type Status = {
  documents: number;
  chunks: number;
  pending_review: number;
  avg_grade_last_200: number | null;
  flagged_pct_last_200: number;
  per_product: Record<string, number>;
  recent_documents: Array<{
    id: string;
    title: string;
    source_ref: string | null;
    product_slug: string | null;
    ingested_at: string | null;
    chunk_count: number | null;
  }>;
};

type FlaggedItem = {
  grade_id: string;
  audit_id: string;
  session_channel: "support" | "auth" | "training";
  session_id: string | null;
  product_slug: string | null;
  user_query: string | null;
  assistant_preview: string;
  evidence_count: number;
  reason: string;
  overall: number | null;
  scores: Record<string, number> | null;
  queue_id: string | null;
  queue_status: string | null;
  created_at: string;
};

type FlaggedResp = {
  window: number;
  total_graded: number;
  flagged_count: number;
  flagged_pct: number;
  breakdown: Record<string, number>;
  items: FlaggedItem[];
  error?: string;
};

// Plain-English explanations for every flag reason grade-answer can emit.
const REASON_EXPLAIN: Record<string, string> = {
  "low product_match":
    "The AI talked about the wrong machine. Retrieval pulled chunks for a different product, or the customer never identified their machine.",
  "low factual score vs evidence":
    "The AI said something the retrieved manuals/notes don't support. Either we don't have docs for this issue or the AI ignored them.",
  "low safety score":
    "The AI gave advice that could be unsafe (e.g. ignoring lockout/tagout, recommending unsupervised HV work).",
  "ignored provided evidence":
    "Retrieval found relevant chunks but the AI answered from general knowledge. Usually means the chunks weren't on-topic enough.",
  "unknown product + weak answer":
    "We couldn't identify the machine AND the answer was weak. Add customer-facing prompts that ask for model + serial, or ingest more generic SS/SL guidance.",
  unspecified:
    "Auto-grader flagged but didn't give a specific reason.",
};

export default function KnowledgePage() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const [flagged, setFlagged] = useState<FlaggedResp | null>(null);
  const [flaggedLoading, setFlaggedLoading] = useState(false);
  const [flaggedError, setFlaggedError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/knowledge");
      const { parsed, data, parseError } = await readJsonBody<Status & { error?: string }>(res);
      if (!parsed || !data) {
        setError(parseError ?? "Invalid response");
        return;
      }
      if (!res.ok) {
        setError((data as any).error ?? `HTTP ${res.status}`);
        return;
      }
      setData(data as Status);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, []);

  const loadFlagged = useCallback(async () => {
    setFlaggedLoading(true);
    setFlaggedError(null);
    try {
      const res = await fetch("/api/admin/knowledge/flagged?window=200&limit=25");
      const { parsed, data } = await readJsonBody<FlaggedResp>(res);
      if (!parsed || !data) {
        setFlaggedError(`HTTP ${res.status}`);
        return;
      }
      if (!res.ok) {
        setFlaggedError(data.error ?? `HTTP ${res.status}`);
        return;
      }
      setFlagged(data);
    } catch (e) {
      setFlaggedError(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setFlaggedLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    void loadFlagged();
  }, [load, loadFlagged]);

  const reasonEntries = flagged
    ? Object.entries(flagged.breakdown).sort((a, b) => b[1] - a[1])
    : [];

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-[1100px] space-y-4">
        <header className="flex flex-col gap-3 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Knowledge index</h1>
            <p className="text-sm text-slate-400">
              Live state of the RAG retrieval index, review backlog, and grader quality.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href="/admin"
              className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300"
            >
              Back to dashboard
            </Link>
            <Link
              href="/admin/review"
              className="rounded-md border border-emerald-700 bg-emerald-900/30 px-3 py-2 text-sm text-emerald-200"
            >
              Review queue
            </Link>
            <button
              type="button"
              onClick={() => {
                void load();
                void loadFlagged();
              }}
              className="rounded-md border border-slate-700 px-3 py-2 text-sm text-slate-300"
            >
              Refresh
            </button>
          </div>
        </header>

        {error ? (
          <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-4 text-sm text-amber-100">
            {error}
          </div>
        ) : null}
        {loading ? <p className="text-sm text-slate-400">Loading…</p> : null}

        {data ? (
          <>
            <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Card label="Documents" value={data.documents} />
              <Card label="Chunks" value={data.chunks} />
              <Card label="Pending review" value={data.pending_review} warn={data.pending_review > 0} />
              <Card
                label="Avg grade (last 200)"
                value={data.avg_grade_last_200 == null ? "—" : data.avg_grade_last_200.toFixed(2)}
                help="Auto-grader's overall score 0.00–1.00. >0.8 is solid, <0.5 means answers are off."
              />
              <Card
                label="% flagged (last 200)"
                value={`${data.flagged_pct_last_200}%`}
                warn={data.flagged_pct_last_200 > 15}
                help="Share of the last 200 AI replies the auto-grader marked for review. High = the AI is answering things we don't have good docs for. See 'Why are answers getting flagged?' below to fix it."
              />
            </section>

            {/* -----------------------------------------------------------
                WHY are answers getting flagged? Breakdown + drill-down list.
                ----------------------------------------------------------- */}
            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h2 className="font-semibold">Why are answers getting flagged?</h2>
                  <p className="text-xs text-slate-400">
                    Auto-grader reasons across the last {flagged?.window ?? 200} answers.{" "}
                    <span className="text-slate-500">
                      Fix these by either (a) ingesting a manual for the product, or (b) correcting
                      the reply from the chat tab — one correction kills every similar future flag.
                    </span>
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void loadFlagged()}
                  className="rounded-md border border-slate-700 px-2 py-1 text-xs text-slate-300"
                >
                  Refresh
                </button>
              </div>

              {flaggedError ? (
                <p className="mt-3 text-sm text-amber-300">{flaggedError}</p>
              ) : null}
              {flaggedLoading && !flagged ? (
                <p className="mt-3 text-sm text-slate-400">Loading flagged answers…</p>
              ) : null}

              {flagged && flagged.flagged_count === 0 ? (
                <p className="mt-3 text-sm text-emerald-300">
                  Nothing flagged in the last {flagged.window} answers. Nice.
                </p>
              ) : null}

              {flagged && flagged.flagged_count > 0 ? (
                <>
                  <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {reasonEntries.map(([reason, count]) => {
                      const pct =
                        flagged.total_graded > 0
                          ? Math.round((count / flagged.total_graded) * 100)
                          : 0;
                      return (
                        <li
                          key={reason}
                          className="rounded border border-slate-800 bg-slate-950 p-3 text-sm"
                        >
                          <div className="flex items-baseline justify-between gap-3">
                            <span className="font-medium text-slate-100">{reason}</span>
                            <span className="whitespace-nowrap text-xs text-slate-400">
                              {count} · {pct}%
                            </span>
                          </div>
                          <p className="mt-1 text-xs leading-relaxed text-slate-400">
                            {REASON_EXPLAIN[reason] ?? "Auto-grader flagged this group."}
                          </p>
                        </li>
                      );
                    })}
                  </ul>

                  <h3 className="mt-5 text-sm font-semibold text-slate-100">
                    Recent flagged answers
                  </h3>
                  <p className="text-xs text-slate-500">
                    Click a row to expand. Open the conversation to correct it in chat, or open the
                    review-queue entry to approve a canonical fix.
                  </p>
                  <ul className="mt-2 space-y-2">
                    {flagged.items.map((it) => {
                      const open = expanded[it.audit_id];
                      return (
                        <li
                          key={it.audit_id}
                          className="rounded border border-slate-800 bg-slate-950 text-sm"
                        >
                          <button
                            type="button"
                            onClick={() =>
                              setExpanded((e) => ({ ...e, [it.audit_id]: !e[it.audit_id] }))
                            }
                            className="flex w-full items-start justify-between gap-3 px-3 py-2 text-left"
                          >
                            <span className="min-w-0 flex-1">
                              <span className="mr-2 inline-block rounded bg-amber-900/40 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-amber-200">
                                {it.reason}
                              </span>
                              <span className="text-slate-300">
                                {it.user_query?.slice(0, 160) ?? "(empty query)"}
                              </span>
                            </span>
                            <span className="flex shrink-0 items-center gap-2 text-xs text-slate-400">
                              <span>{it.product_slug ?? "no-product"}</span>
                              <span>evidence {it.evidence_count}</span>
                              <span>
                                grade{" "}
                                {typeof it.overall === "number" ? it.overall.toFixed(2) : "—"}
                              </span>
                              <span>{open ? "▲" : "▼"}</span>
                            </span>
                          </button>
                          {open ? (
                            <div className="border-t border-slate-800 px-3 py-3 text-xs text-slate-300">
                              <p className="mb-2">
                                <span className="text-slate-500">AI said: </span>
                                <span className="whitespace-pre-wrap">
                                  {it.assistant_preview || "(empty)"}
                                </span>
                              </p>
                              {it.scores ? (
                                <p className="mb-2 text-slate-400">
                                  {Object.entries(it.scores)
                                    .map(([k, v]) => `${k}: ${Number(v).toFixed(2)}`)
                                    .join(" · ")}
                                </p>
                              ) : null}
                              <div className="flex flex-wrap gap-2">
                                {it.session_id ? (
                                  <Link
                                    href={`/admin?session=${it.session_id}&channel=${it.session_channel}`}
                                    className="rounded border border-emerald-800 bg-emerald-900/30 px-2 py-1 text-xs text-emerald-200"
                                  >
                                    Open chat & correct
                                  </Link>
                                ) : null}
                                {it.queue_id ? (
                                  <Link
                                    href={`/admin/review?status=${it.queue_status ?? "pending"}#${it.queue_id}`}
                                    className="rounded border border-slate-700 px-2 py-1 text-xs text-slate-200"
                                  >
                                    Open review-queue entry
                                  </Link>
                                ) : (
                                  <span className="text-[11px] text-slate-500">
                                    (no review-queue row — grader flagged without queueing)
                                  </span>
                                )}
                              </div>
                            </div>
                          ) : null}
                        </li>
                      );
                    })}
                  </ul>
                </>
              ) : null}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-2 font-semibold">Chunks per product</h2>
              {Object.keys(data.per_product).length === 0 ? (
                <p className="text-sm text-slate-400">
                  No chunks yet — run <code className="rounded bg-black/30 px-1">scripts/ingest_knowledge.py</code>{" "}
                  to ingest manuals.
                </p>
              ) : (
                <ul className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-3">
                  {Object.entries(data.per_product)
                    .sort((a, b) => b[1] - a[1])
                    .map(([slug, count]) => (
                      <li key={slug} className="flex justify-between rounded border border-slate-800 bg-slate-950 px-3 py-1.5">
                        <span className="font-medium">{slug}</span>
                        <span className="text-slate-400">{count}</span>
                      </li>
                    ))}
                </ul>
              )}
            </section>

            <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
              <h2 className="mb-2 font-semibold">Recently ingested documents</h2>
              <div className="space-y-2">
                {data.recent_documents.length === 0 ? (
                  <p className="text-sm text-slate-400">No documents yet.</p>
                ) : null}
                {data.recent_documents.map((d) => (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <div>
                      <p className="font-medium">{d.title}</p>
                      <p className="text-xs text-slate-500">
                        {d.product_slug ?? "general"} · {d.source_ref ?? ""}
                      </p>
                    </div>
                    <div className="text-xs text-slate-400">
                      {d.chunk_count ?? 0} chunks ·{" "}
                      {d.ingested_at ? new Date(d.ingested_at).toLocaleString() : "—"}
                    </div>
                  </div>
                ))}
              </div>
            </section>
          </>
        ) : null}
      </div>
    </main>
  );
}

function Card({
  label,
  value,
  warn,
  help,
}: {
  label: string;
  value: string | number;
  warn?: boolean;
  help?: string;
}) {
  return (
    <div
      className={`group relative rounded-xl border p-3 ${
        warn ? "border-amber-700/60 bg-amber-950/30" : "border-slate-800 bg-slate-900"
      }`}
      title={help}
    >
      <p className="flex items-center gap-1 text-[11px] uppercase tracking-wide text-slate-400">
        {label}
        {help ? (
          <span className="cursor-help rounded-full border border-slate-700 px-1 text-[9px] text-slate-400">
            ?
          </span>
        ) : null}
      </p>
      <p className={`text-2xl font-semibold ${warn ? "text-amber-200" : "text-slate-100"}`}>{value}</p>
      {help ? (
        <p className="mt-1 hidden text-[11px] leading-snug text-slate-400 group-hover:block">
          {help}
        </p>
      ) : null}
    </div>
  );
}
