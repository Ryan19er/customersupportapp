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
    display_title: string | null;
    source_type: string | null;
    source_ref: string | null;
    product_slug: string | null;
    subsystem: string | null;
    doc_type: string | null;
    ingested_at: string | null;
    chunk_count: number | null;
    file_url: string | null;
    byte_size: number | null;
  }>;
};

const PRODUCT_SLUG_OPTIONS = [
  "", // auto-detect
  "ss1510",
  "ss3015",
  "ss3015cp",
  "ss3015cpr",
  "sl3015cp",
  "x3",
  "ss2060",
  "ss2060a",
  "slx1390",
  "marking_laser",
  "press_brake",
  "rapid_sander",
];

const DOC_TYPE_OPTIONS = [
  "manual",
  "troubleshooting",
  "spec_sheet",
  "install_guide",
  "service_bulletin",
  "safety",
  "training",
  "faq",
  "other",
];

function humanFileSize(bytes: number | null | undefined): string {
  if (!bytes || bytes <= 0) return "—";
  const units = ["B", "KB", "MB", "GB"];
  let n = bytes;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0)} ${units[i]}`;
}

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

  // Upload panel state.
  const [uploadFiles, setUploadFiles] = useState<File[]>([]);
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadProductSlug, setUploadProductSlug] = useState("");
  const [uploadDocType, setUploadDocType] = useState("manual");
  const [uploadBusy, setUploadBusy] = useState(false);
  const [uploadLog, setUploadLog] = useState<string[]>([]);
  const [dragOver, setDragOver] = useState(false);

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

  const uploadAll = useCallback(async () => {
    if (uploadFiles.length === 0 || uploadBusy) return;
    setUploadBusy(true);
    setUploadLog([]);
    const created_by = "admin"; // TODO: thread real reviewer name when auth lands
    const append = (msg: string) => setUploadLog((l) => [...l, msg]);

    for (const f of uploadFiles) {
      append(`Uploading ${f.name}…`);
      try {
        const form = new FormData();
        form.append("file", f);
        if (uploadFiles.length === 1 && uploadTitle.trim()) {
          form.append("title", uploadTitle.trim());
          form.append("display_title", uploadTitle.trim());
        } else {
          form.append("title", f.name);
          form.append("display_title", f.name);
        }
        if (uploadProductSlug) form.append("product_slug", uploadProductSlug);
        form.append("doc_type", uploadDocType);
        form.append("created_by", created_by);

        const res = await fetch("/api/admin/knowledge/upload", {
          method: "POST",
          body: form,
        });
        const { parsed, data } = await readJsonBody<{
          ok?: boolean;
          chunkCount?: number;
          productSlug?: string | null;
          alreadyIngested?: boolean;
          error?: string;
        }>(res);
        if (!parsed || !data) {
          append(`✗ ${f.name}: HTTP ${res.status}`);
          continue;
        }
        if (!res.ok || !data.ok) {
          append(`✗ ${f.name}: ${data.error ?? `HTTP ${res.status}`}`);
          continue;
        }
        append(
          data.alreadyIngested
            ? `• ${f.name}: already ingested (${data.chunkCount ?? 0} chunks, ${data.productSlug ?? "general"})`
            : `✓ ${f.name}: ${data.chunkCount ?? 0} chunks embedded (${data.productSlug ?? "general"})`,
        );
      } catch (e) {
        append(`✗ ${f.name}: ${e instanceof Error ? e.message : "failed"}`);
      }
    }

    setUploadBusy(false);
    setUploadFiles([]);
    setUploadTitle("");
    void load();
  }, [uploadFiles, uploadBusy, uploadTitle, uploadProductSlug, uploadDocType, load]);

  const deleteDocument = useCallback(
    async (id: string, title: string) => {
      if (!confirm(`Delete "${title}"? This removes the file and all of its chunks from the AI's knowledge base.`)) {
        return;
      }
      const res = await fetch(`/api/admin/knowledge/documents/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const { data } = await readJsonBody<{ error?: string }>(res);
        alert(data?.error ?? `Delete failed (HTTP ${res.status})`);
        return;
      }
      void load();
    },
    [load],
  );

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
                Upload new knowledge files for the AI to train on.
                ----------------------------------------------------------- */}
            <section className="rounded-xl border border-emerald-900/50 bg-emerald-950/20 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="font-semibold text-emerald-100">
                    Upload manuals, guides, or notes
                  </h2>
                  <p className="mt-1 text-xs text-emerald-200/80">
                    Drop PDFs, DOCX, TXT, or MD files. We store the file, extract its text,
                    chunk + embed it, and the customer-facing AI can cite it (and offer it as a
                    download link) on the very next chat turn.
                  </p>
                </div>
              </div>

              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  const dropped = Array.from(e.dataTransfer.files ?? []);
                  if (dropped.length) setUploadFiles((prev) => [...prev, ...dropped]);
                }}
                className={`mt-3 rounded-lg border-2 border-dashed p-4 text-center text-sm ${
                  dragOver
                    ? "border-emerald-400 bg-emerald-900/30 text-emerald-100"
                    : "border-emerald-800 bg-slate-950 text-slate-300"
                }`}
              >
                <p>
                  Drag files here, or{" "}
                  <label className="cursor-pointer text-emerald-300 underline">
                    browse…
                    <input
                      type="file"
                      multiple
                      accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
                      className="hidden"
                      onChange={(e) => {
                        const picked = Array.from(e.target.files ?? []);
                        if (picked.length) setUploadFiles((prev) => [...prev, ...picked]);
                        e.currentTarget.value = "";
                      }}
                    />
                  </label>
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Max 50 MB per file. PDF / DOCX / TXT / MD. Scanned PDFs need OCR first.
                </p>
              </div>

              {uploadFiles.length > 0 ? (
                <ul className="mt-3 space-y-1 text-sm text-slate-200">
                  {uploadFiles.map((f, idx) => (
                    <li
                      key={`${f.name}-${idx}`}
                      className="flex items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-1.5"
                    >
                      <span className="truncate">
                        {f.name}{" "}
                        <span className="text-xs text-slate-500">
                          ({humanFileSize(f.size)})
                        </span>
                      </span>
                      <button
                        type="button"
                        className="text-xs text-slate-400 hover:text-amber-300"
                        onClick={() =>
                          setUploadFiles((prev) => prev.filter((_, i) => i !== idx))
                        }
                        disabled={uploadBusy}
                      >
                        remove
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}

              <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
                {uploadFiles.length === 1 ? (
                  <label className="text-xs text-slate-400 sm:col-span-3">
                    Title (shown to customers)
                    <input
                      className="mt-1 w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                      placeholder={uploadFiles[0].name}
                      value={uploadTitle}
                      onChange={(e) => setUploadTitle(e.target.value)}
                      disabled={uploadBusy}
                    />
                  </label>
                ) : null}
                <label className="text-xs text-slate-400">
                  Machine / product
                  <select
                    className="mt-1 w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                    value={uploadProductSlug}
                    onChange={(e) => setUploadProductSlug(e.target.value)}
                    disabled={uploadBusy}
                  >
                    {PRODUCT_SLUG_OPTIONS.map((slug) => (
                      <option key={slug || "auto"} value={slug}>
                        {slug === "" ? "Auto-detect from text" : slug}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="text-xs text-slate-400">
                  Doc type
                  <select
                    className="mt-1 w-full rounded border border-slate-800 bg-slate-950 px-2 py-1.5 text-sm text-slate-100"
                    value={uploadDocType}
                    onChange={(e) => setUploadDocType(e.target.value)}
                    disabled={uploadBusy}
                  >
                    {DOC_TYPE_OPTIONS.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </label>
                <div className="flex items-end">
                  <button
                    type="button"
                    onClick={() => void uploadAll()}
                    disabled={uploadFiles.length === 0 || uploadBusy}
                    className="w-full rounded-md border border-emerald-600 bg-emerald-600/90 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500 disabled:opacity-50"
                  >
                    {uploadBusy
                      ? "Uploading + embedding…"
                      : `Upload ${uploadFiles.length || ""} ${uploadFiles.length === 1 ? "file" : "files"}`}
                  </button>
                </div>
              </div>

              {uploadLog.length > 0 ? (
                <pre className="mt-3 max-h-48 overflow-y-auto rounded border border-slate-800 bg-black/50 p-2 text-[11px] leading-relaxed text-slate-200">
                  {uploadLog.join("\n")}
                </pre>
              ) : null}
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
              <p className="mb-3 text-xs text-slate-500">
                Everything below is live in the AI's knowledge base. Files with a download link
                will be offered to customers in chat when relevant.
              </p>
              <div className="space-y-2">
                {data.recent_documents.length === 0 ? (
                  <p className="text-sm text-slate-400">
                    No documents yet. Upload something above to get started.
                  </p>
                ) : null}
                {data.recent_documents.map((d) => (
                  <div
                    key={d.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-slate-800 bg-slate-950 px-3 py-2 text-sm"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium text-slate-100">
                        {d.display_title || d.title}
                      </p>
                      <p className="truncate text-xs text-slate-500">
                        <span className="mr-2 rounded bg-slate-800 px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-slate-300">
                          {d.product_slug ?? "general"}
                        </span>
                        {d.doc_type ? <span className="mr-2">{d.doc_type}</span> : null}
                        {d.source_type === "upload" ? (
                          <span className="text-emerald-400/80">uploaded</span>
                        ) : (
                          <span>{d.source_type ?? ""}</span>
                        )}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-xs text-slate-400">
                      <span>{d.chunk_count ?? 0} chunks</span>
                      <span>{humanFileSize(d.byte_size)}</span>
                      <span>
                        {d.ingested_at
                          ? new Date(d.ingested_at).toLocaleDateString()
                          : "—"}
                      </span>
                      {d.file_url ? (
                        <a
                          href={d.file_url}
                          target="_blank"
                          rel="noreferrer"
                          className="rounded border border-emerald-800 bg-emerald-900/30 px-2 py-1 text-emerald-200 hover:bg-emerald-900/50"
                        >
                          download
                        </a>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => void deleteDocument(d.id, d.display_title || d.title)}
                        className="rounded border border-slate-700 px-2 py-1 text-slate-300 hover:border-amber-700 hover:text-amber-200"
                      >
                        delete
                      </button>
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
