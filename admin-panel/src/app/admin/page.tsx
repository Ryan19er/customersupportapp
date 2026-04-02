"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AdminHelp } from "./AdminHelp";

type SessionRow = {
  id: string;
  contact_id: string;
  created_at: string;
  updated_at: string;
  chat_contacts?: {
    full_name?: string;
    email?: string;
    phone?: string;
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

  const [trainingInput, setTrainingInput] = useState("");
  const [trainingBusy, setTrainingBusy] = useState(false);
  const [trainingLog, setTrainingLog] = useState<Array<{ role: string; content: string }>>([]);

  const [promptText, setPromptText] = useState("");
  const [changeSummary, setChangeSummary] = useState("");
  const [promptBusy, setPromptBusy] = useState(false);
  const [promptVersions, setPromptVersions] = useState<PromptVersion[]>([]);
  const [activeTab, setActiveTab] = useState<"main" | "info">("main");

  const activeSession = useMemo(
    () => sessions.find((s) => s.id === selectedSessionId) ?? null,
    [sessions, selectedSessionId],
  );

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/admin/conversations");
    const data = await res.json();
    setSessions(data.sessions ?? []);
    if (!selectedSessionId && data.sessions?.length) {
      setSelectedSessionId(data.sessions[0].id);
    }
  }, [selectedSessionId]);

  const loadMessages = useCallback(async (sessionId: string) => {
    setBusyMessages(true);
    try {
      const res = await fetch(`/api/admin/conversations/${sessionId}/messages`);
      const data = await res.json();
      setMessages(data.messages ?? []);
    } finally {
      setBusyMessages(false);
    }
  }, []);

  const loadPromptHistory = useCallback(async () => {
    const res = await fetch("/api/admin/prompts/history?prompt_key=support-system");
    const data = await res.json();
    const versions = data.versions ?? [];
    setPromptVersions(versions);
    const active = versions.find((v: PromptVersion) => v.is_active) ?? versions[0];
    if (active && !promptText) {
      setPromptText(active.markdown_content ?? "");
    }
  }, [promptText]);

  useEffect(() => {
    void loadSessions();
    void loadPromptHistory();
  }, [loadPromptHistory, loadSessions]);

  useEffect(() => {
    if (!selectedSessionId) return;
    void loadMessages(selectedSessionId);
  }, [loadMessages, selectedSessionId]);

  async function saveNote() {
    if (!activeSession) return;
    setNoteBusy(true);
    setNoteStatus("");
    try {
      const res = await fetch("/api/admin/notes", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contact_id: activeSession.contact_id,
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
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setNoteStatus(data.error ?? "Failed to save note");
        return;
      }
      setNoteStatus("Note saved");
      setSymptoms("");
      setRootCause("");
      setFixSteps("");
      setPartsUsed("");
      setMachineModel("");
      setMachineSerial("");
      setTags("");
    } finally {
      setNoteBusy(false);
    }
  }

  async function sendTrainingMessage() {
    if (!trainingInput.trim()) return;
    const text = trainingInput.trim();
    setTrainingInput("");
    setTrainingLog((prev) => [...prev, { role: "user", content: text }]);
    setTrainingBusy(true);
    try {
      const res = await fetch("/api/admin/training-chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ message: text, created_by: createdBy }),
      });
      const data = await res.json();
      const assistant = res.ok ? data.reply : `Error: ${data.error ?? "failed"}`;
      setTrainingLog((prev) => [...prev, { role: "assistant", content: assistant }]);
    } finally {
      setTrainingBusy(false);
    }
  }

  async function savePromptVersion() {
    if (!promptText.trim() || !changeSummary.trim()) return;
    setPromptBusy(true);
    try {
      const res = await fetch("/api/admin/prompts/save-version", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          prompt_key: "support-system",
          markdown_content: promptText,
          change_summary: changeSummary,
          created_by: createdBy,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        alert(data.error ?? "Failed to save prompt version");
        return;
      }
      setChangeSummary("");
      await loadPromptHistory();
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
    const data = await res.json();
    if (!res.ok) {
      alert(data.error ?? "Rollback failed");
      return;
    }
    await loadPromptHistory();
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.href = "/login";
  }

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 p-4 md:p-6">
      <div className="mx-auto max-w-[1400px] space-y-4">
        <header className="flex flex-col gap-4 rounded-xl border border-slate-800 bg-slate-900 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h1 className="text-xl font-semibold">Stealth Technician Admin</h1>
            <p className="text-sm text-slate-400">
              Conversations, diagnosis notes, AI training channel, and prompt rollback.
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
        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
            <h2 className="mb-2 font-semibold">Conversations</h2>
            <div className="max-h-[500px] overflow-auto space-y-2">
              {sessions.map((s) => (
                <button
                  key={s.id}
                  onClick={() => setSelectedSessionId(s.id)}
                  className={`w-full rounded-md border p-3 text-left ${
                    selectedSessionId === s.id
                      ? "border-red-500 bg-slate-800"
                      : "border-slate-800 bg-slate-950"
                  }`}
                >
                  <p className="font-medium">{s.chat_contacts?.full_name || "Unknown"}</p>
                  <p className="text-xs text-slate-400">{s.chat_contacts?.email || "No email"}</p>
                  <p className="text-xs text-slate-500">
                    Updated {new Date(s.updated_at).toLocaleString()}
                  </p>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-3 lg:col-span-2">
            <h2 className="mb-2 font-semibold">Transcript</h2>
            <div className="max-h-[500px] overflow-auto space-y-2">
              {busyMessages ? <p className="text-sm text-slate-400">Loading messages...</p> : null}
              {messages.map((m) => (
                <button
                  key={m.id}
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
              ))}
            </div>
          </div>
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
            <h2 className="font-semibold">Save Diagnosis Note</h2>
            <p className="text-sm text-slate-400">
              Attach root cause and fix steps to selected conversation/message.
            </p>
            <input
              value={createdBy}
              onChange={(e) => setCreatedBy(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Created by"
            />
            <textarea
              value={symptoms}
              onChange={(e) => setSymptoms(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Symptoms observed"
              rows={2}
            />
            <textarea
              value={rootCause}
              onChange={(e) => setRootCause(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Actual root cause"
              rows={2}
            />
            <textarea
              value={fixSteps}
              onChange={(e) => setFixSteps(e.target.value)}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="How it was fixed"
              rows={3}
            />
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              <input
                value={partsUsed}
                onChange={(e) => setPartsUsed(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                placeholder="Parts used (optional)"
              />
              <input
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                className="rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
                placeholder="Tags comma-separated"
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
                placeholder="Machine serial"
              />
            </div>
            <button
              onClick={saveNote}
              disabled={noteBusy || !activeSession}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {noteBusy ? "Saving..." : "Save note"}
            </button>
            {noteStatus ? <p className="text-sm text-emerald-400">{noteStatus}</p> : null}
          </div>

          <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
            <h2 className="font-semibold">Training Channel</h2>
            <p className="text-sm text-slate-400">
              Internal AI channel for proposing better prompts and troubleshooting playbooks.
            </p>
            <div className="max-h-[250px] overflow-auto rounded-md border border-slate-800 bg-slate-950 p-2 space-y-2">
              {trainingLog.map((m, i) => (
                <div key={i} className="rounded-md border border-slate-800 p-2">
                  <p className="text-xs uppercase text-slate-400">{m.role}</p>
                  <p className="whitespace-pre-wrap text-sm">{m.content}</p>
                </div>
              ))}
            </div>
            <textarea
              value={trainingInput}
              onChange={(e) => setTrainingInput(e.target.value)}
              rows={3}
              className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Ask the training AI to improve prompts or capture a new issue pattern..."
            />
            <button
              onClick={sendTrainingMessage}
              disabled={trainingBusy}
              className="rounded-md border border-slate-700 px-3 py-2 text-sm disabled:opacity-60"
            >
              {trainingBusy ? "Thinking..." : "Send to training AI"}
            </button>
          </div>
        </section>

        <section className="rounded-xl border border-slate-800 bg-slate-900 p-4 space-y-2">
          <h2 className="font-semibold">Prompt Versioning (support-system)</h2>
          <textarea
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            rows={10}
            className="w-full rounded-md border border-slate-700 bg-slate-950 px-3 py-2 font-mono text-xs"
          />
          <div className="flex gap-2">
            <input
              value={changeSummary}
              onChange={(e) => setChangeSummary(e.target.value)}
              className="flex-1 rounded-md border border-slate-700 bg-slate-950 px-3 py-2 text-sm"
              placeholder="Change summary (required)"
            />
            <button
              onClick={savePromptVersion}
              disabled={promptBusy}
              className="rounded-md bg-red-600 px-3 py-2 text-sm font-medium disabled:opacity-60"
            >
              {promptBusy ? "Saving..." : "Save new version"}
            </button>
          </div>
          <div className="max-h-[220px] overflow-auto space-y-2">
            {promptVersions.map((v) => (
              <div key={v.id} className="flex items-center justify-between rounded-md border border-slate-800 p-2">
                <div>
                  <p className="text-sm">
                    v{v.version} {v.is_active ? "(active)" : ""}
                  </p>
                  <p className="text-xs text-slate-400">
                    {v.change_summary} · {v.created_by} · {new Date(v.created_at).toLocaleString()}
                  </p>
                </div>
                {!v.is_active ? (
                  <button
                    onClick={() => rollbackPrompt(v.id)}
                    className="rounded-md border border-slate-700 px-2 py-1 text-xs"
                  >
                    Rollback
                  </button>
                ) : null}
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

