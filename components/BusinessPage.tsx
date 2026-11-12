"use client";
// One business: approve or pause its crew, edit agents, hand out tasks, read reviewed results, log money.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import GoalsPanel from "./GoalsPanel";
import HolidayPanel from "./HolidayPanel";
import Markdown from "./Markdown";

interface Agent {
  id: number;
  name: string;
  job: string;
  model: string;
  allowedTools: string;
  autonomyLevel: string;
  status: string;
  notes: { id: number; title: string; body: string }[];
}
interface TaskRow {
  task: {
    id: number;
    instructions: string;
    status: string;
    result: string | null;
    review: string | null;
    reviewVerdict: string | null;
    cost: number;
    requestedBy: string;
    createdAt: string;
    finishedAt: string | null;
  };
  agent: { name: string } | null;
}

const MODEL_OPTIONS = [
  { id: "claude-sonnet-5-5", label: "Sonnet (writing, strategy)" },
  { id: "claude-haiku-5-5", label: "Haiku (fast, cheap, repetitive)" },
];
const TOOL_LABELS: Record<string, string> = {
  web_search: "Web search",
  save_note: "Own notebook",
  request_approval: "Ask you for approval",
  email_draft: "Gmail drafts (sent after approval)",
  create_post: "Studio posts",
  add_leads: "Add leads to outreach",
  create_listing: "Etsy listings (via Printify)",
};

export default function BusinessPage({ id }: { id: number }) {
  const [data, setData] = useState<{
    business: { id: number; name: string; status: string; notes: string | null };
    agents: Agent[];
    tasks: TaskRow[];
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch(`/api/businesses/${id}`)
      .then(async (r) => {
        if (!r.ok) throw new Error((await r.json()).error);
        return r.json();
      })
      .then(setData)
      .catch((e) => setError(e.message));
  }, [id]);

  useEffect(() => {
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, [load]);

  const setStatus = async (status: "active" | "paused") => {
    await fetch(`/api/businesses/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    load();
  };

  const logMoney = async (metric: "revenue" | "mrr") => {
    const v = prompt(
      metric === "revenue" ? "Money made (add a sale or a week's total), in dollars:" : "Current monthly recurring revenue (MRR), in dollars:",
    );
    if (v === null) return;
    const value = Number(v.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(value)) return;
    await fetch(`/api/businesses/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ metric, value }),
    });
  };

  if (error) return <p className="p-6 text-danger">{error}</p>;
  if (!data) return <p className="p-6 text-muted">Loading…</p>;
  const { business, agents, tasks } = data;

  return (
    <div className="mx-auto max-w-4xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">{business.name}</h1>
        <span
          className={`rounded-full px-2 py-0.5 text-xs ${
            business.status === "active" ? "bg-accent-dim/50 text-accent" : "bg-warn/15 text-warn"
          }`}
        >
          {business.status === "draft" ? "Crew awaiting your OK" : business.status}
        </span>
      </header>
      {business.notes && <p className="mb-4 text-sm text-muted">{business.notes}</p>}

      <div className="mb-5 flex flex-wrap gap-2">
        {business.status !== "active" ? (
          <button onClick={() => setStatus("active")} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg">
            {business.status === "draft" ? "Approve this crew" : "Resume crew"}
          </button>
        ) : (
          <button onClick={() => setStatus("paused")} className="rounded-lg border border-line px-4 py-2 text-sm text-muted">
            Pause crew
          </button>
        )}
        <button onClick={() => logMoney("revenue")} className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          + Log money made
        </button>
        <button onClick={() => logMoney("mrr")} className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          Set monthly recurring
        </button>
      </div>

      {business.status === "draft" && (
        <p className="mb-4 rounded-lg bg-warn/10 p-3 text-sm text-warn">
          Review each agent below (job, model, tools), then tap <b>Approve this crew</b>. Nothing runs until you do. Agents can&apos;t send,
          spend or post: anything like that comes to you as an approval request.
        </p>
      )}

      <GoalsPanel businessId={business.id} />
      {/photo|etsy|pod/i.test(business.name) && <HolidayPanel />}

      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted">CREW</h2>
      <div className="mb-6 grid gap-3 sm:grid-cols-2">
        {agents.map((a) => (
          <AgentCard key={a.id} agent={a} active={business.status === "active"} onChanged={load} />
        ))}
      </div>

      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted">TASKS</h2>
      {tasks.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">
          No tasks yet. Give an agent a task above, or ask Jarvis (“have the Prospector find 20 HVAC companies near me”).
        </p>
      ) : (
        <ul className="space-y-2">
          {tasks.map(({ task: t, agent }) => (
            <li key={t.id} className="rounded-2xl border border-line bg-panel p-3">
              <div className="flex flex-wrap items-center gap-2 text-xs text-muted">
                <span className="font-medium text-ink">{agent?.name}</span>
                <StatusPill status={t.status} verdict={t.reviewVerdict} />
                <span>from {t.requestedBy}</span>
                <span>{new Date(t.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
                {t.cost > 0 && <span>${t.cost.toFixed(3)}</span>}
              </div>
              <p className="mt-1 line-clamp-2 text-sm">{t.instructions}</p>
              {t.review && (
                <p className="mt-2 rounded-lg bg-accent-dim/30 p-2 text-sm">
                  <span className="text-accent">Jarvis: </span>
                  {t.review}
                </p>
              )}
              {t.result && t.status !== "queued" && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-sm text-accent">Full result</summary>
                  <div className="mt-2">
                    <Markdown text={t.result} />
                  </div>
                </details>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function StatusPill({ status, verdict }: { status: string; verdict: string | null }) {
  const label = status === "done" ? (verdict === "needs_work" ? "done, has issues" : "done ✓") : status;
  const cls =
    status === "done" ? (verdict === "needs_work" ? "text-warn" : "text-accent") : status === "failed" ? "text-danger" : "text-muted";
  return <span className={cls}>{label}</span>;
}

function AgentCard({ agent, active, onChanged }: { agent: Agent; active: boolean; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [job, setJob] = useState(agent.job);
  const [model, setModel] = useState(agent.model);
  const [tools, setTools] = useState<string[]>(JSON.parse(agent.allowedTools || "[]"));
  const [task, setTask] = useState("");
  const [sent, setSent] = useState(false);

  const save = async () => {
    await fetch(`/api/agents/${agent.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ job, model, tools }),
    });
    setEditing(false);
    onChanged();
  };

  const give = async () => {
    if (!task.trim()) return;
    await fetch("/api/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: agent.id, instructions: task }),
    });
    setTask("");
    setSent(true);
    setTimeout(() => setSent(false), 4000);
    onChanged();
  };

  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-start justify-between gap-2">
        <h3 className="font-semibold">{agent.name}</h3>
        <span className="text-[10px] text-muted">{MODEL_OPTIONS.find((m) => m.id === agent.model)?.label.split(" ")[0] ?? agent.model}</span>
      </div>
      {editing ? (
        <div className="mt-2 space-y-2 text-sm">
          <textarea value={job} onChange={(e) => setJob(e.target.value)} rows={4} className="w-full rounded-lg border border-line bg-panel-2 p-2" />
          <select value={model} onChange={(e) => setModel(e.target.value)} className="w-full rounded-lg border border-line bg-panel-2 p-2">
            {MODEL_OPTIONS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </select>
          <div className="flex flex-wrap gap-3">
            {Object.entries(TOOL_LABELS).map(([k, label]) => (
              <label key={k} className="flex items-center gap-1.5 text-xs">
                <input
                  type="checkbox"
                  checked={tools.includes(k)}
                  onChange={(e) => setTools(e.target.checked ? [...tools, k] : tools.filter((t) => t !== k))}
                />
                {label}
              </label>
            ))}
          </div>
          <div className="flex gap-2">
            <button onClick={save} className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg">
              Save
            </button>
            <button onClick={() => setEditing(false)} className="px-2 text-xs text-muted">
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <>
          <p className="mt-1 text-sm text-ink/90">{agent.job}</p>
          <p className="mt-2 text-[11px] text-muted">
            Tools: {tools.map((t) => TOOL_LABELS[t] ?? t).join(", ") || "none"} · cannot send, spend or post
          </p>
          <button onClick={() => setEditing(true)} className="mt-2 text-xs text-accent">
            Edit
          </button>
        </>
      )}
      <div className="mt-3 flex gap-2">
        <input
          value={task}
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && give()}
          placeholder={active ? `Give ${agent.name} a task…` : "Approve the crew to give tasks"}
          disabled={!active}
          className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-2 py-1.5 text-sm disabled:opacity-50"
        />
        <button onClick={give} disabled={!active || !task.trim()} className="rounded-lg border border-accent/50 px-3 text-sm text-accent disabled:opacity-30">
          Send
        </button>
      </div>
      {sent && <p className="mt-1 text-xs text-accent">Queued. Results appear below after Jarvis reviews them.</p>}
      {agent.notes.length > 0 && (
        <details className="mt-2 text-xs">
          <summary className="cursor-pointer text-muted">Notebook ({agent.notes.length})</summary>
          <ul className="mt-1 space-y-1">
            {agent.notes.map((n) => (
              <li key={n.id}>
                <b>{n.title}</b>: {n.body.slice(0, 200)}
              </li>
            ))}
          </ul>
        </details>
      )}
    </article>
  );
}
