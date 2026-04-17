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

export default function KnowledgePage() {
  const [data, setData] = useState<Status | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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

  useEffect(() => {
    void load();
  }, [load]);

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
              onClick={() => void load()}
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
              />
              <Card
                label="% flagged (last 200)"
                value={`${data.flagged_pct_last_200}%`}
                warn={data.flagged_pct_last_200 > 15}
              />
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

function Card({ label, value, warn }: { label: string; value: string | number; warn?: boolean }) {
  return (
    <div
      className={`rounded-xl border p-3 ${
        warn ? "border-amber-700/60 bg-amber-950/30" : "border-slate-800 bg-slate-900"
      }`}
    >
      <p className="text-[11px] uppercase tracking-wide text-slate-400">{label}</p>
      <p className={`text-2xl font-semibold ${warn ? "text-amber-200" : "text-slate-100"}`}>{value}</p>
    </div>
  );
}
