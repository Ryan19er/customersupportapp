"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { readJsonBody } from "@/lib/safe-fetch-json";
import { AdminHelp } from "./AdminHelp";

type SessionRow = {
  id: string;
  /** `support` = anon contact flow (`support_chat_*`); `auth` = signed-in (`chat_sessions` / `chat_messages`). */
  channel: "support" | "auth";
  contact_id: string | null;
  user_id?: string | null;
  title?: string | null;
  created_at: string;
  updated_at: string;
  chat_contacts?: {
    full_name?: string;
    email?: string;
    phone?: string;
    company_name?: string | null;
  };
};

type MessageRow = {
  id: string;
  role: "user" | "assistant";
  content: string;
  created_at: string;
  session_id: string;
};

type PromptVersion = {
  id: string;
  prompt_key: string;
  version: number;
  markdown_content: string;
  change_summary: string;
  created_by: string;
  created_at: string;
  is_active: boolean;
};

type CustomerQuestionQueueRow = {
  id: string;
  title: string;
  detail: string | null;
  status: string;
  source: string;
  created_by: string;
  created_at: string;
  resolved_at: string | null;
  resolved_by: string | null;
};

type TrainingThreadRow = {
  id: string;
  title: string;
  created_by: string;
  created_at: string;
  updated_at: string;
};

type AuditEvidence = {
  idx: number;
  type: string;
  id: string;
  heading?: string | null;
  product_slug?: string | null;
  subsystem?: string | null;
  score?: number;
};

type AuditGrade = {
  audit_id: string;
  overall: number | null;
  scores: Record<string, number> | null;
  rationale: string | null;
  auto_flagged: boolean;
  flag_reason: string | null;
  created_at: string;
};

type AuditRow = {
  id: string;
  session_id: string;
  session_channel: string;
  product_slug: string | null;
  user_query: string;
  assistant_text: string;
  resolver_meta: Record<string, unknown> | null;
  evidence: AuditEvidence[] | null;
  model: string | null;
  latency_ms: number | null;
  created_at: string;
  grade: AuditGrade | null;
};

type TrainingChatMsg = {
  id?: string;
  role: string;
  content: string;
};

export default function AdminPage() {
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<MessageRow[]>([]);
  const [busyMessages, setBusyMessages] = useState(false);

  const [noteBusy, setNoteBusy] = useState(false);
  const [noteStatus, setNoteStatus] = useState<string>("");
  const [selectedMessageId, setSelectedMessageId] = useState<string | null>(null);
  const [createdBy, setCreatedBy] = useState("admin");
  const [symptoms, setSymptoms] = useState("");
  const [rootCause, setRootCause] = useState("");
  const [fixSteps, setFixSteps] = useState("");
  const [partsUsed, setPartsUsed] = useState("");
  const [machineModel, setMachineModel] = useState("");
  const [machineSerial, setMachineSerial] = useState("");
  const [tags, setTags] = useState("");
  const [priorAssistantSummary, setPriorAssistantSummary] = useState("");

  const [trainingInput, setTrainingInput] = useState("");
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [trainingLog, setTrainingLog] = useState<TrainingChatMsg[]>([]);
  const [trainingThreads, setTrainingThreads] = useState<TrainingThreadRow[]>([]);
  const [selectedTrainingThreadId, setSelectedTrainingThreadId] = useState<string | null>(null);
  const [newThreadTitle, setNewThreadTitle] = useState("");
  const [trainingThreadFilter, setTrainingThreadFilter] = useState("");
  const [trainingThreadsBusy, setTrainingThreadsBusy] = useState(false);
  const [trainingThreadsError, setTrainingThreadsError] = useState<string | null>(null);
  const [trainingMessagesBusy, setTrainingMessagesBusy] = useState(false);
  const [trainingMessagesError, setTrainingMessagesError] = useState<string | null>(null);
  const [customerQuestionQueue, setCustomerQuestionQueue] = useState<CustomerQuestionQueueRow[]>([]);

  const [promptText, setPromptText] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [activeTab, setActiveTab] = useState<"main" | "info">("main");

  const [workspace, setWorkspace] = useState<"conversations" | "prompts" | "training">("conversations");
  const [apiError, setApiError] = useState<string | null>(null);
  const [sessionLoadWarnings, setSessionLoadWarnings] = useState<string[]>([]);
  const [messagesError, setMessagesError] = useState<string | null>(null);
  const [audits, setAudits] = useState<AuditRow[]>([]);
  const [promptError, setPromptError] = useState<string | null>(null);
  const [queueError, setQueueError] = useState<string | null>(null);
  const [selectedPromptKey, setSelectedPromptKey] = useState("support-system");
  const [promptKeys, setPromptKeys] = useState<string[]>(["support-system"]);
  const [sessionFilter, setSessionFilter] = useState("");

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const filteredSessions = useMemo(() => {
    const q = sessionFilter.trim().toLowerCase();
    if (!q) return sessions;
    return sessions.filter((s) => {
      const c = s.chat_contacts;
      const blob = [c?.full_name, c?.email, c?.phone, c?.company_name, s.title]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      return blob.includes(q);
    });
  }, [sessions, sessionFilter]);

  const searchHasNoMatches = useMemo(
    () =>
      Boolean(sessionFilter.trim()) &&
      sessions.length > 0 &&
      filteredSessions.length === 0,
    [sessionFilter, sessions.length, filteredSessions.length],
  );

  const filteredTrainingThreads = useMemo(() => {
    const q = trainingThreadFilter.trim().toLowerCase();
    if (!q) return trainingThreads;
    return trainingThreads.filter(
      (t) =>
        t.title.toLowerCase().includes(q) ||
        t.created_by.toLowerCase().includes(q),
    );
  }, [trainingThreads, trainingThreadFilter]);

  const loadSessions = useCallback(async () => {
    setApiError(null);
    setSessionLoadWarnings([]);
    try {
      const res = await fetch("/api/admin/conversations");
      const { parsed, data, parseError } = await readJsonBody<{
        sessions?: SessionRow[];
        warnings?: string[];
        error?: string;
      }>(res);
      if (!parsed || !data) {
        setApiError(parseError ?? "Invalid response from server");
        setSessions([]);
        return;
      }
      if (!res.ok) {
        setApiError(data.error ?? `HTTP ${res.status}`);
        setSessions([]);
        return;
      }
      const list = (data.sessions ?? []) as SessionRow[];
      setSessions(list);
      setSessionLoadWarnings(Array.isArray(data.warnings) ? data.warnings : []);
      setSelectedSessionId((prev) => {
        if (prev && list.some((s) => s.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setApiError(e instanceof Error ? e.message : "Failed to load conversations");
      setSessions([]);
    }
  }, []);

  const loadMessages = useCallback(async (sessionId: string, channel: "support" | "auth") => {
    setBusyMessages(true);
    setMessagesError(null);
    try {
      const res = await fetch(
        `/api/admin/conversations/${sessionId}/messages?channel=${encodeURIComponent(channel)}`,
      );
      const { parsed, data, parseError } = await readJsonBody<{ messages?: MessageRow[]; error?: string }>(
        res,
      );
      if (!parsed || !data) {
        setMessagesError(parseError ?? "Invalid response from server");
        setMessages([]);
        return;
      }
      if (!res.ok) {
        setMessagesError(data.error ?? `HTTP ${res.status}`);
        setMessages([]);
        return;
      }
      setMessages(data.messages ?? []);
    } catch (e) {
      setMessagesError(e instanceof Error ? e.message : "Failed to load messages");
      setMessages([]);
    } finally {
      setBusyMessages(false);
    }
  }, []);

  const loadAudits = useCallback(async (sessionId: string, channel: "support" | "auth") => {
    try {
      const res = await fetch(
        `/api/admin/audits?session_id=${encodeURIComponent(sessionId)}&channel=${encodeURIComponent(channel)}`,
      );
      const { parsed, data } = await readJsonBody<{ audits?: AuditRow[] }>(res);
      if (parsed && data?.audits) setAudits(data.audits);
      else setAudits([]);
    } catch {
      setAudits([]);
    }
  }, []);

  const loadPromptKeys = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/prompt-keys");
      const { parsed, data } = await readJsonBody<{ keys?: string[] }>(res);
      if (parsed && data && res.ok && Array.isArray(data.keys) && data.keys.length) {
        setPromptKeys(data.keys);
      }
    } catch {
      /* keep default */
    }
  }, []);

  const loadPromptHistory = useCallback(async (key: string) => {
    setPromptError(null);
    try {
      const res = await fetch(
        `/api/admin/prompts/history?prompt_key=${encodeURIComponent(key)}`,
      );
      const { parsed, data, parseError } = await readJsonBody<{
        versions?: PromptVersion[];
        error?: string;
      }>(res);
      if (!parsed || !data) {
        setPromptError(parseError ?? "Invalid response from server");
        setPromptVersions([]);
        return;
      }
      if (!res.ok) {
        setPromptError(data.error ?? `HTTP ${res.status}`);
        setPromptVersions([]);
        return;
      }
      const versions = data.versions ?? [];
      setPromptVersions(versions);
      const active = versions.find((v: PromptVersion) => v.is_active) ?? versions[0];
      if (active) {
        setPromptText(active.markdown_content ?? "");
      } else {
        setPromptText("");
      }
    } catch (e) {
      setPromptError(e instanceof Error ? e.message : "Failed to load prompts");
      setPromptVersions([]);
    }
  }, []);

  const loadCustomerQuestionQueue = useCallback(async () => {
    setQueueError(null);
    try {
      const res = await fetch("/api/admin/training-queue");
      const { parsed, data, parseError } = await readJsonBody<{
        items?: CustomerQuestionQueueRow[];
        error?: string;
      }>(res);
      if (!parsed || !data) {
        setQueueError(parseError ?? "Invalid response from server");
        setCustomerQuestionQueue([]);
        return;
      }
      if (!res.ok) {
        setQueueError(data.error ?? `HTTP ${res.status}`);
        setCustomerQuestionQueue([]);
        return;
      }
      setCustomerQuestionQueue(data.items ?? []);
    } catch (e) {
      setQueueError(e instanceof Error ? e.message : "Failed to load queue");
      setCustomerQuestionQueue([]);
    }
  }, []);

  const loadTrainingThreads = useCallback(async () => {
    setTrainingThreadsError(null);
    setTrainingThreadsBusy(true);
    try {
      const res = await fetch("/api/admin/training-threads");
      const { parsed, data, parseError } = await readJsonBody<{
        threads?: TrainingThreadRow[];
        error?: string;
      }>(res);
      if (!parsed || !data) {
        setTrainingThreadsError(parseError ?? "Invalid response from server");
        setTrainingThreads([]);
        return;
      }
      if (!res.ok) {
        setTrainingThreadsError(data.error ?? `HTTP ${res.status}`);
        setTrainingThreads([]);
        return;
      }
      const list = data.threads ?? [];
      setTrainingThreads(list);
      setSelectedTrainingThreadId((prev) => {
        if (prev && list.some((t) => t.id === prev)) return prev;
        return list[0]?.id ?? null;
      });
    } catch (e) {
      setTrainingThreadsError(e instanceof Error ? e.message : "Failed to load training sessions");
      setTrainingThreads([]);
    } finally {
      setTrainingThreadsBusy(false);
    }
  }, []);

  const loadTrainingMessages = useCallback(async (threadId: string) => {
    setTrainingMessagesError(null);
    setTrainingMessagesBusy(true);
    try {
      const res = await fetch(
        `/api/admin/training-chat?thread_id=${encodeURIComponent(threadId)}`,
      );
      const { parsed, data, parseError } = await readJsonBody<{
        messages?: Array<{ id: string; role: string; content: string }>;
        error?: string;
      }>(res);
      if (!parsed || !data) {
        setTrainingMessagesError(parseError ?? "Invalid response from server");
        setTrainingLog([]);
        return;
      }
      if (!res.ok) {
        setTrainingMessagesError(data.error ?? `HTTP ${res.status}`);
        setTrainingLog([]);
        return;
      }
      const rows = data.messages ?? [];
      setTrainingLog(
        rows.map((m) => ({
          id: m.id,
          role: m.role,
          content: m.content,
        })),
      );
    } catch (e) {
      setTrainingMessagesError(e instanceof Error ? e.message : "Failed to load messages");
      setTrainingLog([]);
    } finally {
      setTrainingMessagesBusy(false);
    }
  }, []);

  useEffect(() => {
    void loadSessions();
    void loadPromptKeys();
    void loadCustomerQuestionQueue();
  }, [loadCustomerQuestionQueue, loadSessions, loadPromptKeys]);

  useEffect(() => {
    if (workspace !== "training") return;
    void loadTrainingThreads();
  }, [workspace, loadTrainingThreads]);

  useEffect(() => {
    if (!selectedTrainingThreadId) {
      setTrainingLog([]);
      return;
    }
    void loadTrainingMessages(selectedTrainingThreadId);
  }, [selectedTrainingThreadId, loadTrainingMessages]);

  useEffect(() => {
    void loadPromptHistory(selectedPromptKey);
  }, [loadPromptHistory, selectedPromptKey]);

  useEffect(() => {
    if (!selectedSessionId) return;
    const row = sessions.find((s) => s.id === selectedSessionId);
    const channel = row?.channel ?? "support";
    void loadMessages(selectedSessionId, channel);
    void loadAudits(selectedSessionId, channel);
  }, [loadAudits, loadMessages, selectedSessionId, sessions]);

  async function saveNote() {
    if (!activeSession) return;
    setNoteBusy(true);
    setNoteStatus("");
    try {
      const res = await fetch("/api/admin/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          conversation_channel: activeSession.channel,
          contact_id: activeSession.contact_id ?? null,
          session_id: activeSession.id,
          message_id: selectedMessageId,
          symptoms,
          root_cause: rootCause,
          fix_steps: fixSteps,
          parts_used: partsUsed || null,
          machine_model: machineModel || null,
          machine_serial: machineSerial || null,
          created_by: createdBy,
          tags: tags
            .split(",")
            .map((t) => t.trim())
            .filter(Boolean),
          prior_assistant_summary: priorAssistantSummary.trim() || null,
        }),
      });
      const { parsed, data } = await readJsonBody<{
        error?: string;
        ingestion?: {
          correctionId?: string;
          conflictId?: string | null;
          reviewQueueId?: string | null;
          canonicalStatus?: "draft" | "active";
        };
      }>(res);
      if (!parsed || !data) {
        setNoteStatus(`Save failed (HTTP ${res.status})`);
        return;
      }
      if (!res.ok) {
        setNoteStatus(data.error ?? "Failed to save note");
        return;
      }
      const correctionId = data.ingestion?.correctionId;
      const conflictId = data.ingestion?.conflictId;
      const queueId = data.ingestion?.reviewQueueId;
      const canonicalStatus = data.ingestion?.canonicalStatus;
      const parts: string[] = [];
      parts.push(`Correction ${correctionId ?? "n/a"} saved.`);
      parts.push("Field snippet is live for the next customer chat turn.");
      if (canonicalStatus === "draft" && queueId) {
        parts.push(`Canonical rule queued for review (${queueId}).`);
      } else if (canonicalStatus === "active") {
        parts.push("Canonical rule is live.");
      }
      if (conflictId) parts.push(`Conflict flagged (${conflictId}).`);
      setNoteStatus(parts.join(" "));
      setSymptoms("");
      setRootCause("");
      setFixSteps("");
      setPartsUsed("");
      setMachineModel("");
      setMachineSerial("");
      setTags("");
      setPriorAssistantSummary("");
    } finally {
      setNoteBusy(false);
    }
  }

  async function sendTrainingMessage() {
    if (!trainingInput.trim() || !selectedTrainingThreadId) return;
    const text = trainingInput.trim();
    setTrainingInput("");
    setTrainingLog((prev) => [...prev, { role: "user", content: text }]);
    setTrainingBusy(true);
    try {
      const res = await fetch("/api/admin/training-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: text,
          created_by: createdBy,
          thread_id: selectedTrainingThreadId,
        }),
      });
      const { parsed, data } = await readJsonBody<{ reply?: string; error?: string; queued?: number }>(res);
      const assistant =
        parsed && data && res.ok
          ? (data.reply ?? "")
          : `Error: ${parsed && data?.error ? data.error : `HTTP ${res.status}`}`;
      setTrainingLog((prev) => [...prev, { role: "assistant", content: assistant }]);
      if (parsed && data && res.ok && typeof data.queued === "number" && data.queued > 0) {
        await loadCustomerQuestionQueue();
      }
      if (parsed && data && res.ok) {
        void loadTrainingThreads();
      }
    } finally {
      setTrainingBusy(false);
    }
  }

  async function createTrainingThread() {
    const title = newThreadTitle.trim();
    if (!title) return;
    setTrainingThreadsBusy(true);
    setTrainingThreadsError(null);
    try {
      const res = await fetch("/api/admin/training-threads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ title, created_by: createdBy }),
      });
      const { parsed, data } = await readJsonBody<{
        thread?: TrainingThreadRow;
        error?: string;
      }>(res);
      if (!parsed || !data || !res.ok) {
        setTrainingThreadsError(data?.error ?? `HTTP ${res.status}`);
        return;
      }
      const t = data.thread;
      if (t) {
        setTrainingThreads((prev) => [t, ...prev.filter((x) => x.id !== t.id)]);
        setSelectedTrainingThreadId(t.id);
        setTrainingLog([]);
        setNewThreadTitle("");
      }
    } catch (e) {
      setTrainingThreadsError(e instanceof Error ? e.message : "Failed to create session");
    } finally {
      setTrainingThreadsBusy(false);
    }
  }

  async function resolveCustomerQueueItem(id: string) {
    const res = await fetch("/api/admin/training-queue", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, resolved_by: createdBy }),
    });
    if (res.ok) await loadCustomerQuestionQueue();
  }

  async function savePromptVersion() {
    if (!promptText.trim() || !changeSummary.trim()) return;
    setPromptBusy(true);
    try {
      const res = await fetch("/api/admin/prompts/save-version", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt_key: selectedPromptKey,
          markdown_content: promptText,
          change_summary: changeSummary,
          created_by: createdBy,
        }),
      });
      const { parsed, data } = await readJsonBody<{ error?: string }>(res);
      if (!parsed || !data || !res.ok) {
        alert(data?.error ?? `Failed to save prompt version (HTTP ${res.status})`);
        return;
      }
      setChangeSummary("");
      await loadPromptHistory(selectedPromptKey);
      await loadPromptKeys();
    } finally {
      setPromptBusy(false);
    }
  }

  async function rollbackPrompt(id: string) {
    const res = await fetch("/api/admin/prompts/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id }),
    });
    const { parsed, data } = await readJsonBody<{ error?: string }>(res);
    if (!parsed || !data || !res.ok) {
      alert(data?.error ?? `Rollback failed (HTTP ${res.status})`);
      return;
    }
    await loadPromptHistory(selectedPromptKey);
  }

  function prefillNoteFromSelectedMessage() {
    if (!selectedMessageId) return;
    const m = messages.find((x) => x.id === selectedMessageId);
    if (!m) return;
    const quote = `[${m.role} @ ${new Date(m.created_at).toISOString()}]\n${m.content}`;
    setSymptoms((prev) => (prev.trim() ? `${prev}\n\n---\n${quote}` : `Context from chat:\n${quote}`));
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/login";
  }

  const conversationLoadError = apiError || messagesError;
  const promptsLoadError = promptError;
  const trainingWorkspaceLoadError =
    trainingThreadsError || trainingMessagesError || queueError;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <header className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Stealth Technician Admin</h1>
            <p className="text-sm text-slate-400">
              Browse every customer chat (by name / email / phone), attach technician notes the AI can
              learn from, edit prompt files with version history, and run the internal training assistant.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-slate-700 bg-slate-950 p-0.5">
              <button
                type="button"
                onClick={() => setActiveTab("main")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  activeTab === "main"
                    ? "bg-red-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                Dashboard
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("info")}
                className={`rounded-md px-3 py-1.5 text-sm font-medium ${
                  activeTab === "info"
                    ? "bg-red-600 text-white"
                    : "text-slate-400 hover:text-slate-200"
                }`}
              >
                How to use
              </button>
            </div>
            <Link
              href="/admin/knowledge"
              className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-200"
            >
              Knowledge
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
                void loadSessions();
                void loadTrainingThreads();
                void loadCustomerQuestionQueue();
              }}
              className="rounded-md border border-slate-600 px-3 py-2 text-sm text-slate-300"
            >
              Refresh data
            </button>
            <button onClick={logout} className="rounded-md border border-slate-700 px-3 py-2 text-sm">
              Logout
            </button>
          </div>
        </header>

        {activeTab === "info" ? (
          <AdminHelp />
        ) : null}

        {activeTab === "main" ? (
          <>
            {sessionLoadWarnings.length > 0 ? (
              <div className="rounded-xl border border-amber-800/50 bg-amber-950/30 p-3 text-xs text-amber-100/90">
                <p className="font-medium text-amber-200">Partial session load</p>
                <ul className="mt-1 list-inside list-disc">
                  {sessionLoadWarnings.map((w) => (
                    <li key={w}>{w}</li>
                  ))}
                </ul>
              </div>
            ) : null}

            {workspace === "conversations" && conversationLoadError ? (
              <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-4 text-sm text-amber-50">
                <p className="font-semibold text-amber-200">Customer chats could not load</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-amber-100/90">
                  {apiError ? <li>Sessions: {apiError}</li> : null}
                  {messagesError ? <li>Transcript: {messagesError}</li> : null}
                </ul>
                <p className="mt-3 text-xs text-amber-200/80">
                  In Vercel → Environment Variables (Production), set{" "}
                  <code className="rounded bg-black/30 px-1">SUPABASE_URL</code> and{" "}
                  <code className="rounded bg-black/30 px-1">SUPABASE_SERVICE_ROLE_KEY</code> for this project,
                  then redeploy. Names must match exactly (not only NEXT_PUBLIC_*).
                </p>
              </div>
            ) : null}

            {workspace === "prompts" && promptsLoadError ? (
              <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-4 text-sm text-amber-50">
                <p className="font-semibold text-amber-200">Prompts could not load</p>
                <p className="mt-2 text-amber-100/90">{promptsLoadError}</p>
                <p className="mt-3 text-xs text-amber-200/80">
                  Same Supabase env as above; ensure migration 009 ran so{" "}
                  <code className="rounded bg-black/30 px-1">prompt_versions</code> has rows.
                </p>
              </div>
            ) : null}

            {workspace === "training" && trainingWorkspaceLoadError ? (
              <div className="rounded-xl border border-amber-700/60 bg-amber-950/40 p-4 text-sm text-amber-50">
                <p className="font-semibold text-amber-200">Team training workspace could not load completely</p>
                <ul className="mt-2 list-inside list-disc space-y-1 text-amber-100/90">
                  {trainingThreadsError ? <li>Sessions list: {trainingThreadsError}</li> : null}
                  {trainingMessagesError ? <li>Chat history: {trainingMessagesError}</li> : null}
                  {queueError ? <li>Ticket queue: {queueError}</li> : null}
                </ul>
                <p className="mt-3 text-xs text-amber-200/80">
                  Ensure Supabase env vars are set for this admin project. Training chat needs{" "}
                  <code className="rounded bg-black/30 px-1">training_threads</code> +{" "}
                  <code className="rounded bg-black/30 px-1">training_chat_messages.thread_id</code> (migration 011).
                  Queue needs <code className="rounded bg-black/30 px-1">admin_customer_question_queue</code> (008).
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2 rounded-xl border border-slate-800 bg-slate-900 p-2">
              {(
                [
                  ["conversations", "1 · Customer chats & notes"],
                  ["prompts", "2 · Prompt files & versions"],
                  ["training", "3 · Team training & ticket queue"],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  onClick={() => setWorkspace(id)}
                  className={`rounded-lg px-4 py-2 text-left text-sm font-medium transition-colors ${
                    workspace === id
                      ? "bg-red-600 text-white"
                      : "bg-slate-950 text-slate-400 hover:text-slate-200"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {workspace === "conversations" ? (
              <>
                <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
                  <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
                    <div className="mb-3 flex flex-col gap-2">
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <h2 className="font-semibold">All conversations</h2>
                        {!apiError ? (
                          <span className="text-xs text-slate-500">
                            {sessions.length} thread{sessions.length === 1 ? "" : "s"} (newest first)
                          </span>
                        ) : null}
                      </div>
                      <p className="text-xs text-slate-500">
                        Every contact chat and signed-in account thread loads here automatically—no search
                        required. Pick a row to open the transcript.
                      </p>
                      <input
                        value={sessionFilter}
                        onChange={(e) => setSessionFilter(e.target.value)}
                        placeholder="Optional: narrow list by name, email, or phone"
                        className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      />
                    </div>
                    <div className="max-h-[min(480px,55vh)] overflow-auto space-y-2">
                      {!apiError && searchHasNoMatches ? (
                        <p className="text-sm text-amber-200/90">
                          No conversations match that search. Clear the box to see all {sessions.length} again.
                        </p>
                      ) : null}
                      {!apiError && !searchHasNoMatches && sessions.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          No sessions yet. When anyone uses the customer app, their thread appears here
                          automatically.
                        </p>
                      ) : null}
                      {filteredSessions.map((s) => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => setSelectedSessionId(s.id)}
                          className={`w-full rounded-md border p-3 text-left ${
                            selectedSessionId === s.id
                              ? "border-red-500 bg-slate-800"
                              : "border-slate-800 bg-slate-950"
                          }`}
                        >
                          <p className="flex flex-wrap items-center gap-2">
                            <span className="font-medium">{s.chat_contacts?.full_name || "Unknown"}</span>
                            <span
                              className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${
                                s.channel === "auth"
                                  ? "bg-sky-900/80 text-sky-200"
                                  : "bg-slate-700 text-slate-300"
                              }`}
                            >
                              {s.channel === "auth" ? "Signed-in" : "Contact"}
                            </span>
                          </p>
                          {s.title ? (
                            <p className="text-xs text-slate-500 italic">{s.title}</p>
                          ) : null}
                          <p className="text-xs text-slate-400">{s.chat_contacts?.email || "No email"}</p>
                          <p className="text-xs text-slate-400">{s.chat_contacts?.phone || "—"}</p>
                          {s.chat_contacts?.company_name ? (
                            <p className="text-xs text-slate-500">{s.chat_contacts.company_name}</p>
                          ) : null}
                          <p className="text-xs text-slate-500">
                            Updated {new Date(s.updated_at).toLocaleString()}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 lg:col-span-2">
                    <h2 className="mb-2 font-semibold">Transcript</h2>
                    <p className="mb-2 text-xs text-slate-500">
                      Click a message to link it to a diagnosis note. Use the button below to paste the
                      selected text into “Symptoms”.
                    </p>
                    <div className="max-h-[min(480px,55vh)] overflow-auto space-y-2">
                      {!selectedSessionId ? (
                        <p className="text-sm text-slate-500">Select a session on the left.</p>
                      ) : null}
                      {busyMessages ? <p className="text-sm text-slate-400">Loading messages…</p> : null}
                      {messagesError ? (
                        <p className="text-sm text-red-400">{messagesError}</p>
                      ) : null}
                      {messages.map((m) => {
                        const audit =
                          m.role === "assistant"
                            ? audits.find((a) => a.assistant_text?.trim() === m.content?.trim())
                            : null;
                        return (
                          <div key={m.id} className="space-y-1">
                            <button
                              type="button"
                              onClick={() => setSelectedMessageId(m.id)}
                              className={`w-full rounded-md border p-3 text-left ${
                                selectedMessageId === m.id
                                  ? "border-emerald-500 bg-slate-800"
                                  : "border-slate-800 bg-slate-950"
                              }`}
                            >
                              <p className="text-xs uppercase tracking-wide text-slate-400">{m.role}</p>
                              <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                            </button>
                            {audit ? <AuditRibbon audit={audit} /> : null}
                          </div>
                        );
                      })}
                    </div>
                    <button
                      type="button"
                      disabled={!selectedMessageId}
                      onClick={prefillNoteFromSelectedMessage}
                      className="mt-2 rounded-md border border-emerald-800/60 px-3 py-2 text-xs text-emerald-300 disabled:opacity-40"
                    >
                      Add selected message to note (symptoms)
                    </button>
                  </div>
                </section>

                <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
                  <h2 className="font-semibold">Correct & Publish (customer AI law)</h2>
                  <p className="text-sm text-slate-400">
                    Save a correction once and it auto-applies immediately to runtime context. If it
                    conflicts with existing canonical guidance, it is still applied but flagged for
                    manual review.
                  </p>
                  <input
                    value={createdBy}
                    onChange={(e) => setCreatedBy(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="Your name"
                  />
                  <textarea
                    value={symptoms}
                    onChange={(e) => setSymptoms(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="Symptoms / what the customer or chat showed"
                    rows={2}
                  />
                  <textarea
                    value={priorAssistantSummary}
                    onChange={(e) => setPriorAssistantSummary(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="Optional: what the customer AI already tried in chat (so we learn gap vs fix)"
                    rows={2}
                  />
                  <textarea
                    value={rootCause}
                    onChange={(e) => setRootCause(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="Root cause"
                    rows={2}
                  />
                  <textarea
                    value={fixSteps}
                    onChange={(e) => setFixSteps(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                    placeholder="Fix steps / what worked"
                    rows={3}
                  />
                  <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
                    <input
                      value={partsUsed}
                      onChange={(e) => setPartsUsed(e.target.value)}
                      className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      placeholder="Parts (optional)"
                    />
                    <input
                      value={tags}
                      onChange={(e) => setTags(e.target.value)}
                      className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      placeholder="Tags, comma-separated"
                    />
                    <input
                      value={machineModel}
                      onChange={(e) => setMachineModel(e.target.value)}
                      className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      placeholder="Machine model"
                    />
                    <input
                      value={machineSerial}
                      onChange={(e) => setMachineSerial(e.target.value)}
                      className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      placeholder="Serial"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={saveNote}
                    disabled={noteBusy || !activeSession}
                    className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium disabled:opacity-60"
                  >
                    {noteBusy ? "Publishing…" : "Correct & Publish"}
                  </button>
                  {noteStatus ? <p className="text-sm text-emerald-400">{noteStatus}</p> : null}
                </section>
              </>
            ) : null}

            {workspace === "prompts" ? (
              <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
                <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4 xl:col-span-1">
                  <h2 className="font-semibold">Prompt files</h2>
                  <p className="text-xs text-slate-500">
                    Like files in a repo. The active version is what you deploy; older versions are
                    history (similar idea to Vercel deployments).
                  </p>
                  <label className="block text-xs font-medium text-slate-400">Active file (prompt_key)</label>
                  <select
                    value={selectedPromptKey}
                    onChange={(e) => setSelectedPromptKey(e.target.value)}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                  >
                    {promptKeys.map((k) => (
                      <option key={k} value={k}>
                        {k}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-slate-500">
                    New keys appear when you save a version under a new name. Seed migration 009 creates{" "}
                    <code className="text-slate-400">support-system</code> if the table was empty.
                  </p>
                </div>

                <div className="space-y-3 rounded-xl border border-slate-800 bg-slate-900 p-4 xl:col-span-2">
                  <h2 className="font-semibold">
                    Editor — {selectedPromptKey}{" "}
                    <span className="text-xs font-normal text-slate-500">(markdown / plain text)</span>
                  </h2>
                  {promptError ? <p className="text-sm text-red-400">{promptError}</p> : null}
                  <textarea
                    value={promptText}
                    onChange={(e) => setPromptText(e.target.value)}
                    rows={18}
                    className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs leading-relaxed"
                  />
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      value={changeSummary}
                      onChange={(e) => setChangeSummary(e.target.value)}
                      className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      placeholder="What changed (required to save new version)"
                    />
                    <button
                      type="button"
                      onClick={savePromptVersion}
                      disabled={promptBusy}
                      className="rounded-md bg-red-600 px-4 py-2 text-sm font-medium disabled:opacity-60"
                    >
                      {promptBusy ? "Saving…" : "Deploy new version"}
                    </button>
                  </div>
                </div>

                <div className="space-y-2 rounded-xl border border-slate-800 bg-slate-900 p-4 xl:col-span-3">
                  <h3 className="text-sm font-semibold text-slate-300">Version history</h3>
                  <div className="max-h-[240px] overflow-auto space-y-2">
                    {promptVersions.length === 0 ? (
                      <p className="text-sm text-slate-500">
                        No versions loaded. Run migration 009 or save once to create v1.
                      </p>
                    ) : null}
                    {promptVersions.map((v) => (
                      <div
                        key={v.id}
                        className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-800 p-3"
                      >
                        <div>
                          <p className="text-sm">
                            v{v.version}{" "}
                            {v.is_active ? (
                              <span className="text-emerald-400">● live</span>
                            ) : (
                              <span className="text-slate-500">○</span>
                            )}
                          </p>
                          <p className="text-xs text-slate-400">
                            {v.change_summary} · {v.created_by} ·{" "}
                            {new Date(v.created_at).toLocaleString()}
                          </p>
                        </div>
                        {!v.is_active ? (
                          <button
                            type="button"
                            onClick={() => rollbackPrompt(v.id)}
                            className="rounded-md border border-slate-600 px-3 py-1 text-xs"
                          >
                            Roll back to this
                          </button>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            ) : null}

            {workspace === "training" ? (
              <section className="rounded-xl border border-slate-800 bg-slate-900 p-4">
                <div className="grid grid-cols-1 gap-6 xl:grid-cols-12">
                  <div className="space-y-3 min-w-0 xl:col-span-3">
                    <div>
                      <h2 className="font-semibold">Training sessions</h2>
                      <p className="text-xs text-slate-500">
                        One session per field report, model deep-dive, or topic. Newest activity sorts to the
                        top.
                      </p>
                    </div>
                    <input
                      value={createdBy}
                      onChange={(e) => setCreatedBy(e.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      placeholder="Your name (for new sessions & messages)"
                    />
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                      <input
                        value={newThreadTitle}
                        onChange={(e) => setNewThreadTitle(e.target.value)}
                        className="min-w-0 flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                        placeholder="New session title (e.g. Matt Phillips — bad connector)"
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void createTrainingThread();
                        }}
                      />
                      <button
                        type="button"
                        onClick={() => void createTrainingThread()}
                        disabled={trainingThreadsBusy || !newThreadTitle.trim()}
                        className="rounded-md border border-slate-600 bg-slate-800 px-3 py-2 text-sm text-slate-200 disabled:opacity-50"
                      >
                        {trainingThreadsBusy ? "…" : "New session"}
                      </button>
                    </div>
                    <input
                      value={trainingThreadFilter}
                      onChange={(e) => setTrainingThreadFilter(e.target.value)}
                      className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      placeholder="Filter by title or author"
                    />
                    <div className="max-h-[min(360px,45vh)] overflow-auto space-y-2">
                      {trainingThreadsBusy && trainingThreads.length === 0 ? (
                        <p className="text-sm text-slate-500">Loading sessions…</p>
                      ) : null}
                      {!trainingThreadsBusy && trainingThreads.length === 0 ? (
                        <p className="text-sm text-slate-500">
                          No sessions yet. Add a title above (migration 011 must be applied).
                        </p>
                      ) : null}
                      {filteredTrainingThreads.map((t) => (
                        <button
                          key={t.id}
                          type="button"
                          onClick={() => setSelectedTrainingThreadId(t.id)}
                          className={`w-full rounded-md border p-3 text-left ${
                            selectedTrainingThreadId === t.id
                              ? "border-red-500 bg-slate-800"
                              : "border-slate-800 bg-slate-950"
                          }`}
                        >
                          <p className="text-sm font-medium leading-snug">{t.title}</p>
                          <p className="text-[11px] text-slate-500">
                            {t.created_by} · updated {new Date(t.updated_at).toLocaleString()}
                          </p>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="space-y-2 min-w-0 xl:col-span-5">
                    <h2 className="font-semibold">Internal training assistant</h2>
                    <p className="text-sm text-slate-400">
                      For Stealth staff only. Document field fixes, customer names (the AI will confirm
                      spelling), and machine details — stored per session. It can queue official follow-ups on
                      the right.
                    </p>
                    <div className="max-h-[min(420px,50vh)] overflow-auto rounded-md border border-slate-800 bg-slate-950 p-2 space-y-2">
                      {trainingMessagesBusy ? (
                        <p className="text-sm text-slate-500 px-2">Loading messages…</p>
                      ) : null}
                      {!trainingMessagesBusy && !selectedTrainingThreadId ? (
                        <p className="text-sm text-slate-500 px-2">
                          Create or select a training session on the left.
                        </p>
                      ) : null}
                      {!trainingMessagesBusy &&
                      selectedTrainingThreadId &&
                      trainingLog.length === 0 ? (
                        <p className="text-sm text-slate-500 px-2">
                          No messages in this session yet. Describe the job, customer, and fix — the assistant
                          will help structure it for the team.
                        </p>
                      ) : null}
                      {trainingLog.map((m, i) => (
                        <div
                          key={m.id ?? `${m.role}-${i}-${m.content.slice(0, 24)}`}
                          className="rounded-md border border-slate-800 p-2"
                        >
                          <p className="text-xs uppercase text-slate-400">{m.role}</p>
                          <p className="whitespace-pre-wrap text-sm leading-relaxed">{m.content}</p>
                        </div>
                      ))}
                    </div>
                    <textarea
                      value={trainingInput}
                      onChange={(e) => setTrainingInput(e.target.value)}
                      rows={4}
                      className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                      placeholder="Field report, model question, or how the public bot should behave…"
                      disabled={!selectedTrainingThreadId}
                    />
                    <button
                      type="button"
                      onClick={() => void sendTrainingMessage()}
                      disabled={trainingBusy || !selectedTrainingThreadId || !trainingInput.trim()}
                      className="rounded-md border border-slate-600 bg-slate-800 px-4 py-2 text-sm disabled:opacity-60"
                    >
                      {trainingBusy ? "Thinking…" : "Send"}
                    </button>
                  </div>

                  <div className="space-y-2 min-w-0 xl:col-span-4">
                    <h2 className="font-semibold text-amber-100/90">Ticket queue (hard questions)</h2>
                    <p className="text-sm text-slate-400">
                      When the training AI spots a gap, it files rows here (like internal tickets). Resolve
                      when the answer is in the manual, KB, or prompt.
                    </p>
                    <div className="max-h-[min(420px,50vh)] overflow-auto rounded-md border border-amber-900/40 bg-amber-950/20 p-2 space-y-2">
                      {customerQuestionQueue.filter((q) => q.status === "open").length === 0 ? (
                        <p className="text-sm text-slate-500 px-2">No open items.</p>
                      ) : null}
                      {customerQuestionQueue
                        .filter((q) => q.status === "open")
                        .map((q) => (
                          <div
                            key={q.id}
                            className="rounded-md border border-slate-700 bg-slate-950/80 p-3 space-y-1"
                          >
                            <p className="font-medium text-sm text-slate-100">{q.title}</p>
                            {q.detail ? (
                              <p className="text-xs text-slate-400 whitespace-pre-wrap">{q.detail}</p>
                            ) : null}
                            <p className="text-[10px] text-slate-500">
                              {new Date(q.created_at).toLocaleString()} · {q.created_by}
                            </p>
                            <button
                              type="button"
                              onClick={() => resolveCustomerQueueItem(q.id)}
                              className="text-xs rounded border border-emerald-800/60 px-2 py-1 text-emerald-300 hover:bg-emerald-950/50"
                            >
                              Mark resolved
                            </button>
                          </div>
                        ))}
                    </div>
                  </div>
                </div>
              </section>
            ) : null}
          </>
        ) : null}
      </div>
    </main>
  );
}

function AuditRibbon({ audit }: { audit: AuditRow }) {
  const [open, setOpen] = useState(false);
  const grade = audit.grade;
  const overall = grade?.overall ?? null;
  const overallText = overall === null ? "—" : overall.toFixed(2);
  const flagged = grade?.auto_flagged === true;
  const evidence = audit.evidence ?? [];
  return (
    <div className="rounded-md border border-slate-800 bg-slate-950/70 px-3 py-2 text-xs text-slate-300">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between gap-2 text-left"
      >
        <span className="flex items-center gap-2">
          <span className={flagged ? "text-amber-300" : "text-emerald-300"}>
            {flagged ? "Flagged" : "OK"}
          </span>
          <span className="text-slate-400">grade {overallText}</span>
          {audit.product_slug ? (
            <span className="rounded bg-slate-800 px-1.5 py-0.5 text-[10px] text-slate-200">
              {audit.product_slug}
            </span>
          ) : null}
          <span className="text-slate-500">· {evidence.length} sources</span>
        </span>
        <span className="text-slate-500">{open ? "hide" : "show"}</span>
      </button>
      {open ? (
        <div className="mt-2 space-y-1">
          {grade?.rationale ? (
            <p className="text-[11px] text-slate-400 italic">{grade.rationale}</p>
          ) : null}
          {grade?.flag_reason ? (
            <p className="text-[11px] text-amber-300">Reason: {grade.flag_reason}</p>
          ) : null}
          {evidence.length === 0 ? (
            <p className="text-[11px] text-slate-500">No evidence was retrieved for this reply.</p>
          ) : (
            <ul className="space-y-0.5">
              {evidence.map((e) => (
                <li key={`${e.type}-${e.id}-${e.idx}`} className="text-[11px] text-slate-400">
                  [E{e.idx}] {e.type}
                  {e.product_slug ? ` · ${e.product_slug}` : ""}
                  {e.subsystem ? ` · ${e.subsystem}` : ""}
                  {e.heading ? ` · ${e.heading}` : ""}
                  {typeof e.score === "number" ? ` · ${e.score.toFixed(2)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </div>
  );
}
