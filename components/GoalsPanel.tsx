"use client";
// Goals & scorecard for one business: progress toward each goal, proposed goals to approve, numbers Tommy reports
// himself, and the latest Monday review.
import { useCallback, useEffect, useState } from "react";
import Markdown from "./Markdown";

interface Line {
  goal: { id: number; title: string; metric: string; target: number; deadline: string | null; status: string };
  label: string;
  unit: string;
  current: number | null;
  weekAgo: number | null;
  pct: number;
  pace: "met" | "on_track" | "behind" | "no_data" | "not_started";
  daysLeft: number | null;
}
interface Data {
  lines: Line[];
  review: { weekOf: string; summary: string } | null;
  metrics: { key: string; label: string; auto: boolean }[];
}

// What to type in the target box for the chosen measure.
function targetHint(label?: string): string {
  if (!label) return "Target (pick a measure first)";
  const what = label.replace(/\s*\(.*\)\s*/, "").replace(/\$/, "").trim().toLowerCase();
  if (/\$/.test(label)) return `Target dollars, e.g. 1000`;
  if (/last 7 days/.test(label)) return `Target ${what} per 7 days, e.g. 10`;
  return `Target ${what}, e.g. 1000`;
}

const fmt = (v: number | null, unit: string) => (v === null ? "—" : unit === "$" ? `$${Math.round(v).toLocaleString()}` : `${Math.round(v * 10) / 10}`);
const PACE: Record<Line["pace"], { text: string; cls: string }> = {
  met: { text: "met ✓", cls: "text-accent" },
  on_track: { text: "on track", cls: "text-accent" },
  behind: { text: "behind", cls: "text-warn" },
  no_data: { text: "no data yet", cls: "text-muted" },
  not_started: { text: "proposed", cls: "text-warn" },
};

export default function GoalsPanel({ businessId }: { businessId: number }) {
  const [data, setData] = useState<Data | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ title: "", metric: "", target: "", deadline: "" });
  const [reviewOpen, setReviewOpen] = useState(false);

  const load = useCallback(() => {
    fetch(`/api/businesses/${businessId}/goals`)
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, [businessId]);
  useEffect(() => load(), [load]);

  const act = async (body: Record<string, unknown>) => {
    await fetch(`/api/businesses/${businessId}/goals`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    load();
  };

  const editTarget = (l: Line, approve: boolean) => {
    const v = prompt(`Target for "${l.goal.title}" (${l.label})`, String(l.goal.target));
    if (v === null) return;
    const target = Number(v.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(target)) return;
    const d = prompt("Deadline (YYYY-MM-DD), or leave as is", l.goal.deadline ?? "");
    act({ action: approve ? "approve" : "update", goalId: l.goal.id, target, deadline: d || undefined });
  };

  const record = (key: string, label: string) => {
    const v = prompt(`Current ${label}?`);
    if (v === null) return;
    const value = Number(v.replace(/[$,\s]/g, ""));
    if (Number.isFinite(value)) act({ action: "record", metric: key, value });
  };

  if (!data) return null;
  const active = data.lines.filter((l) => l.pace !== "not_started");
  const proposed = data.lines.filter((l) => l.pace === "not_started");
  const manual = data.metrics.filter((m) => !m.auto);

  return (
    <section className="mb-6">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold tracking-wide text-muted">GOALS &amp; SCORECARD</h2>
        <button onClick={() => setAdding(!adding)} className="text-xs text-accent">
          + Add a goal
        </button>
        {manual.map((m) => (
          <button key={m.key} onClick={() => record(m.key, m.label)} className="rounded-md border border-line px-2 py-0.5 text-xs text-muted hover:text-ink">
            Update {m.label.toLowerCase()}
          </button>
        ))}
      </div>

      {proposed.length > 0 && (
        <div className="mb-3 rounded-2xl border border-warn/40 bg-warn/5 p-3 text-sm">
          <p className="mb-2 text-warn">Jarvis suggests these goals. Approve them as they are, change the numbers, or drop them.</p>
          <ul className="space-y-2">
            {proposed.map((l) => (
              <li key={l.goal.id} className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 flex-1">
                  {l.goal.title}
                  <span className="text-xs text-muted">
                    {" "}
                    · {l.label}
                    {l.goal.deadline ? ` · by ${l.goal.deadline}` : ""}
                  </span>
                </span>
                <button onClick={() => act({ action: "approve", goalId: l.goal.id })} className="rounded-md bg-accent px-2 py-1 text-xs font-semibold text-bg">
                  Approve
                </button>
                <button onClick={() => editTarget(l, true)} className="rounded-md border border-line px-2 py-1 text-xs text-muted">
                  Change &amp; approve
                </button>
                <button onClick={() => act({ action: "drop", goalId: l.goal.id })} className="px-2 py-1 text-xs text-muted hover:text-danger">
                  Drop
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {active.length === 0 && proposed.length === 0 && <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">No goals yet. Add one, or tell Jarvis.</p>}
      <ul className="space-y-2">
        {active.map((l) => (
          <li key={l.goal.id} className="rounded-2xl border border-line bg-panel p-3 text-sm">
            <div className="flex flex-wrap items-baseline gap-x-3">
              <button onClick={() => editTarget(l, false)} className="font-medium hover:text-accent" title="Change target or deadline">
                {l.goal.title}
              </button>
              <span className="font-mono">
                {fmt(l.current, l.unit)} / {fmt(l.goal.target, l.unit)}
              </span>
              <span className={`text-xs ${PACE[l.pace].cls}`}>{PACE[l.pace].text}</span>
              <span className="ml-auto text-xs text-muted">
                {l.weekAgo !== null && l.current !== null ? `week ago ${fmt(l.weekAgo, l.unit)} · ` : ""}
                {l.daysLeft !== null ? `${l.daysLeft} days left` : ""}
              </span>
            </div>
            <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2">
              <div className={`h-full ${l.pace === "behind" ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.max(l.pct, 1)}%` }} />
            </div>
          </li>
        ))}
      </ul>

      {adding && (
        <div className="mt-3 grid gap-2 rounded-2xl border border-line bg-panel p-3 text-sm sm:grid-cols-4">
          <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Goal, e.g. 20 orders a week" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5 sm:col-span-2" />
          <select value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })} className="min-w-0 rounded-lg border border-line bg-panel-2 px-2 py-1.5">
            <option value="">Measured by…</option>
            {data.metrics.map((m) => (
              <option key={m.key} value={m.key}>
                {m.label}
                {m.auto ? "" : " (you update it)"}
              </option>
            ))}
          </select>
          <input
            value={form.target}
            onChange={(e) => setForm({ ...form, target: e.target.value })}
            placeholder={targetHint(data.metrics.find((m) => m.key === form.metric)?.label)}
            inputMode="decimal"
            className="rounded-lg border border-line bg-panel-2 px-2 py-1.5"
          />
          <input value={form.deadline} onChange={(e) => setForm({ ...form, deadline: e.target.value })} type="date" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
          <button
            disabled={!form.title.trim() || !form.metric || !Number.isFinite(Number(form.target))}
            onClick={() => {
              act({ action: "create", title: form.title, metric: form.metric, target: Number(form.target), deadline: form.deadline || undefined });
              setForm({ title: "", metric: "", target: "", deadline: "" });
              setAdding(false);
            }}
            className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg disabled:opacity-40"
          >
            Add goal
          </button>
        </div>
      )}

      {data.review && (
        <div className="mt-3 rounded-2xl border border-line bg-panel p-3 text-sm">
          <button onClick={() => setReviewOpen(!reviewOpen)} className="flex w-full items-center justify-between text-left">
            <span className="font-medium">Monday review · week of {data.review.weekOf}</span>
            <span className="text-xs text-accent">{reviewOpen ? "Hide" : "Read"}</span>
          </button>
          {reviewOpen && (
            <div className="mt-2">
              <Markdown text={data.review.summary} />
            </div>
          )}
        </div>
      )}
    </section>
  );
}
