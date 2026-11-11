"use client";
// Done-for-you builds (Chief of Staff AI): one card per client. Paste or dictate the kickoff call notes, Jarvis writes
// the setup file and the checklist, then work the checklist down to Launch.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Item {
  id: string;
  group: string;
  label: string;
  done: boolean;
}
interface Plan {
  owner: { name: string; address: string; city?: string };
  assistant: { name: string; personality: string; voice?: string };
  businesses: { name: string; summary: string; modules: string[]; offer?: string }[];
  outreach?: { business: string; target: string; offer: string; sendingDomain?: string; mailboxes: number; warmupStart?: string; warmupDays: number };
}
interface BuildView {
  id: number;
  client: string;
  email: string | null;
  status: string;
  notes: string | null;
  plan: Plan | null;
  checklist: Item[];
  progress: number;
  next: Item | null;
  warmupReady: string | null;
  warmupDaysLeft: number | null;
}

const STATUS_LABEL: Record<string, string> = { kickoff: "Kickoff", building: "Building", warming: "Warming up", ready: "Ready to launch", launched: "Launched", paused: "Paused" };

export default function Builds() {
  const [builds, setBuilds] = useState<BuildView[] | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const [form, setForm] = useState({ client: "", email: "" });
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/builds")
      .then((r) => r.json())
      .then((d) => setBuilds(d.builds ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => load(), [load]);

  const act = async (id: number, body: Record<string, unknown>) => {
    setErr(null);
    const res = await fetch(`/api/builds/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setErr(d.error ?? "Something went wrong.");
    load();
    return res.ok;
  };

  const create = async () => {
    const res = await fetch("/api/builds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await res.json().catch(() => ({}));
    if (res.ok) {
      setForm({ client: "", email: "" });
      setOpen(d.build.id);
      load();
    }
  };

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/outreach" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Outreach
        </Link>
        <h1 className="text-xl font-semibold">Chief of Staff AI builds</h1>
      </header>
      <p className="mb-3 text-sm text-muted">
        One card per done-for-you client. After the kickoff call, paste or dictate your notes: Jarvis writes their setup file and the build checklist. Work it
        down, start the warm-up countdown, and they press Launch on their own assistant when it&apos;s all green.
      </p>

      <div className="mb-4 flex flex-wrap gap-2 rounded-2xl border border-line bg-panel p-3 text-sm">
        <input value={form.client} onChange={(e) => setForm({ ...form, client: e.target.value })} placeholder="Client name" className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
        <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Email (optional)" className="min-w-0 flex-1 rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
        <button onClick={create} disabled={!form.client.trim()} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg disabled:opacity-40">
          + New build
        </button>
      </div>
      {err && <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{err}</p>}
      {builds && builds.length === 0 && <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">No builds yet. Add your first client after the kickoff call.</p>}

      <ul className="space-y-3">
        {builds?.map((b) => {
          const isOpen = open === b.id;
          const groups = [...new Set(b.checklist.map((i) => i.group))];
          return (
            <li key={b.id} className="rounded-2xl border border-line bg-panel p-3 text-sm">
              <button onClick={() => setOpen(isOpen ? null : b.id)} className="flex w-full flex-wrap items-baseline gap-x-3 text-left">
                <span className="font-medium">{b.client}</span>
                <span className={`text-xs ${b.status === "ready" ? "text-accent" : b.status === "launched" ? "text-accent" : "text-muted"}`}>{STATUS_LABEL[b.status] ?? b.status}</span>
                {b.warmupDaysLeft !== null && b.status !== "launched" && (
                  <span className="text-xs text-warn">{b.warmupDaysLeft === 0 ? "warm-up done" : `warm-up: ${b.warmupDaysLeft} day${b.warmupDaysLeft === 1 ? "" : "s"} left`}</span>
                )}
                <span className="ml-auto text-xs text-muted">{b.progress}%</span>
              </button>
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full bg-accent" style={{ width: `${Math.max(2, b.progress)}%` }} />
              </div>
              {!isOpen && b.next && <p className="mt-1 text-xs text-muted">Next: {b.next.label}</p>}

              {isOpen && (
                <div className="mt-3 space-y-4">
                  {/* Call notes → setup file */}
                  <div>
                    <p className="mb-1 text-xs uppercase tracking-wider text-muted">Kickoff call notes</p>
                    <textarea
                      defaultValue={b.notes ?? ""}
                      onChange={(e) => setNotes(e.target.value)}
                      rows={5}
                      placeholder="Paste or dictate: who they are, their business(es), what they want the assistant to do, outreach target and offer, the assistant's name and voice…"
                      className="w-full rounded-lg border border-line bg-panel-2 p-2"
                    />
                    <button
                      disabled={busy}
                      onClick={async () => {
                        setBusy(true);
                        await act(b.id, { action: "notes", notes: notes || b.notes || "" });
                        setBusy(false);
                      }}
                      className="mt-1 rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg disabled:opacity-40"
                    >
                      {busy ? "Writing the setup file…" : b.plan ? "Re-make the setup file" : "Make the setup file"}
                    </button>
                  </div>

                  {b.plan && (
                    <div className="rounded-lg bg-panel-2 p-3">
                      <p className="mb-1 text-xs uppercase tracking-wider text-muted">Setup file</p>
                      <p>
                        <b>{b.plan.assistant.name}</b> for {b.plan.owner.name} (calls them &quot;{b.plan.owner.address}&quot;){b.plan.owner.city ? ` · ${b.plan.owner.city}` : ""}
                      </p>
                      <p className="text-xs text-muted">{b.plan.assistant.personality}</p>
                      <ul className="mt-2 space-y-1">
                        {b.plan.businesses.map((x) => (
                          <li key={x.name}>
                            <span className="font-medium">{x.name}</span> <span className="text-xs text-muted">· {x.modules.join(", ")}</span>
                            <span className="block text-xs text-muted">{x.summary}</span>
                          </li>
                        ))}
                      </ul>
                      {b.plan.outreach && (
                        <p className="mt-2 text-xs">
                          Outreach for {b.plan.outreach.business}: {b.plan.outreach.target} · offer: {b.plan.outreach.offer}
                          {b.plan.outreach.sendingDomain ? ` · sends from ${b.plan.outreach.sendingDomain}` : ""}
                        </p>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <a href={`/api/builds/${b.id}/setup`} className="rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink">
                          Download setup file
                        </a>
                        {b.plan.outreach && (
                          <label className="flex items-center gap-1 text-xs text-muted">
                            Warm-up started
                            <input
                              type="date"
                              defaultValue={b.plan.outreach.warmupStart ?? ""}
                              onChange={(e) => e.target.value && act(b.id, { action: "warmup", date: e.target.value })}
                              className="rounded-md border border-line bg-panel px-1 py-0.5 text-ink"
                            />
                          </label>
                        )}
                        {b.warmupReady && <span className="text-xs text-muted">ready {new Date(b.warmupReady).toLocaleDateString([], { month: "short", day: "numeric" })}</span>}
                      </div>
                    </div>
                  )}

                  {/* Checklist */}
                  {groups.map((g) => (
                    <div key={g}>
                      <p className="mb-1 text-xs uppercase tracking-wider text-muted">{g}</p>
                      <ul className="space-y-1">
                        {b.checklist
                          .filter((i) => i.group === g)
                          .map((i) => (
                            <li key={i.id}>
                              <label className="flex items-start gap-2">
                                <input type="checkbox" checked={i.done} onChange={(e) => act(b.id, { action: "toggle", item: i.id, done: e.target.checked })} className="mt-0.5" />
                                <span className={i.done ? "text-muted line-through" : ""}>{i.label}</span>
                              </label>
                            </li>
                          ))}
                      </ul>
                    </div>
                  ))}

                  <label className="flex items-center gap-2 text-xs text-muted">
                    Status
                    <select value={b.status} onChange={(e) => act(b.id, { action: "status", status: e.target.value })} className="rounded-md border border-line bg-panel-2 px-2 py-1 text-ink">
                      {Object.entries(STATUS_LABEL).map(([k, v]) => (
                        <option key={k} value={k}>
                          {v}
                        </option>
                      ))}
                    </select>
                  </label>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}
