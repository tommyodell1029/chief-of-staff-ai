"use client";
// LaunchPad Local clients: where each one ranks on Google Maps for their searches, and the monthly report.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Check {
  rank: number | null;
  leader: string | null;
  createdAt: string;
}
interface Client {
  id: number;
  name: string;
  plan: string;
  contactName: string | null;
  email: string | null;
  city: string;
  website: string | null;
  status: string;
  snapshot: {
    keywords: { keyword: string; latest?: Check; before?: Check }[];
    rating: number | null;
    reviews: number | null;
    checks: number;
  };
}

const EMPTY = { name: "", city: "", keywords: "", plan: "visibility", contactName: "", email: "", website: "" };
const rankText = (r?: number | null) => (r ? `#${r}` : "not top 20");

export default function Clients() {
  const [data, setData] = useState<{ clients: Client[]; plans: Record<string, { label: string; usd: number }> } | null>(null);
  const [form, setForm] = useState(EMPTY);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/clients")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);
  useEffect(() => load(), [load]);

  const post = async (body: Record<string, unknown>, label: string) => {
    setBusy(label);
    const res = await fetch("/api/clients", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    if (!res.ok) setFlash(d.error ?? "Something went wrong.");
    load();
    return { ok: res.ok, d };
  };

  const active = data?.clients.filter((c) => c.status !== "ended") ?? [];
  const mrr = active.filter((c) => c.status === "active").reduce((s, c) => s + (data?.plans[c.plan]?.usd ?? 0), 0);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/outreach" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Outreach
        </Link>
        <h1 className="text-xl font-semibold">Clients</h1>
        {active.length > 0 && <span className="text-sm text-muted">{active.length} active · ${mrr.toLocaleString()}/mo</span>}
        <button onClick={() => setAdding(!adding)} className="ml-auto rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg">
          + Add client
        </button>
      </header>
      <p className="mb-3 text-sm text-muted">
        Every Monday Jarvis checks where each client shows up on Google Maps for their searches, and Client Success drafts that week&apos;s Google post for
        you to paste. On the 1st, each client&apos;s one-page report is drafted in Gmail for your OK.
      </p>
      {flash && <p className="mb-3 rounded-lg bg-panel-2 px-3 py-2 text-sm">{flash}</p>}

      {adding && (
        <div className="mb-4 grid gap-2 rounded-2xl border border-line bg-panel p-3 text-sm sm:grid-cols-2">
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Business name (as on Google Maps)" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
          <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City, e.g. Tampa, FL" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
          <input value={form.keywords} onChange={(e) => setForm({ ...form, keywords: e.target.value })} placeholder="Up to 3 searches, comma-separated: plumber, water heater repair" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5 sm:col-span-2" />
          <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="Website (helps find them)" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
          <select value={form.plan} onChange={(e) => setForm({ ...form, plan: e.target.value })} className="rounded-lg border border-line bg-panel-2 px-2 py-1.5">
            <option value="visibility">Local Visibility ($249/mo)</option>
            <option value="mappack">Map Pack Pro ($449/mo)</option>
          </select>
          <input value={form.contactName} onChange={(e) => setForm({ ...form, contactName: e.target.value })} placeholder="Contact name" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
          <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} placeholder="Contact email (for reports)" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
          <button
            disabled={!!busy || !form.name.trim() || !form.keywords.trim()}
            onClick={async () => {
              const { ok } = await post({ action: "add", ...form }, "add");
              if (ok) {
                setForm(EMPTY);
                setAdding(false);
                setFlash("Client added. Tap “Check ranks now” for a first reading (uses one Maps search per keyword).");
              }
            }}
            className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg disabled:opacity-40 sm:col-span-2"
          >
            Add client
          </button>
        </div>
      )}

      {data && data.clients.length === 0 && !adding && (
        <p className="rounded-2xl border border-dashed border-line p-4 text-sm text-muted">No clients yet. When your first one signs, add them here (or tell Jarvis).</p>
      )}
      <ul className="space-y-2">
        {data?.clients.map((c) => (
          <li key={c.id} className={`rounded-2xl border border-line bg-panel p-3 text-sm ${c.status === "ended" ? "opacity-50" : ""}`}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="font-medium">{c.name}</span>
              <span className="text-xs text-muted">
                {data.plans[c.plan]?.label ?? c.plan} · {c.city}
                {c.status !== "active" ? ` · ${c.status}` : ""}
              </span>
              {c.snapshot.rating !== null && (
                <span className="ml-auto text-xs text-muted">
                  {c.snapshot.rating}★ ({c.snapshot.reviews} reviews)
                </span>
              )}
            </div>
            <ul className="mt-2 space-y-0.5">
              {c.snapshot.keywords.map((k) => (
                <li key={k.keyword} className="flex flex-wrap gap-x-2">
                  <span className="text-muted">“{k.keyword}”</span>
                  <span className={k.latest?.rank && k.latest.rank <= 3 ? "text-accent" : ""}>{k.latest ? rankText(k.latest.rank) : "not checked yet"}</span>
                  {k.before && <span className="text-xs text-muted">(was {rankText(k.before.rank)})</span>}
                  {k.latest?.leader && k.latest.rank !== 1 && <span className="text-xs text-muted">· #1: {k.latest.leader}</span>}
                </li>
              ))}
            </ul>
            <div className="mt-2 flex flex-wrap gap-2">
              <button onClick={() => post({ action: "check", id: c.id }, `check${c.id}`)} disabled={!!busy} className="rounded-lg border border-line px-3 py-1 text-xs text-muted disabled:opacity-50">
                {busy === `check${c.id}` ? "Checking Google Maps…" : "Check ranks now"}
              </button>
              <button
                onClick={async () => {
                  const { ok, d } = await post({ action: "report", id: c.id }, `report${c.id}`);
                  if (ok) setFlash(`${d.result} It's in Waiting on you.`);
                }}
                disabled={!!busy}
                className="rounded-lg border border-line px-3 py-1 text-xs text-muted disabled:opacity-50"
              >
                {busy === `report${c.id}` ? "Drafting…" : "Draft monthly report"}
              </button>
              <select
                value={c.status}
                onChange={(e) => post({ action: "update", id: c.id, status: e.target.value }, "status")}
                className="ml-auto rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs"
              >
                <option value="active">Active</option>
                <option value="paused">Paused</option>
                <option value="ended">Ended</option>
              </select>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
