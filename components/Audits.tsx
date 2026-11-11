"use client";
// Walk-in audits: run the free 5-point Google Maps check for any business, then print the one-page leave-behind.
import Link from "next/link";
import { useEffect, useState } from "react";

interface Row {
  id: number;
  business: string;
  city: string;
  createdAt: string;
  fixes: number;
  plan: string;
}

export default function Audits() {
  const [rows, setRows] = useState<Row[]>([]);
  const [form, setForm] = useState({ business: "", city: "", searches: "", website: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = () =>
    fetch("/api/audits")
      .then((r) => r.json())
      .then((d) => setRows(d.audits ?? []))
      .catch(() => {});
  useEffect(() => {
    load();
  }, []);

  const run = async () => {
    setBusy(true);
    setError(null);
    const res = await fetch("/api/audits", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (!res.ok) return setError(d.error ?? "Something went wrong.");
    window.location.href = `/audit/${d.audit.id}`;
  };

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/outreach" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Outreach
        </Link>
        <h1 className="text-xl font-semibold">Walk-in audits</h1>
      </header>
      <p className="mb-3 text-sm text-muted">
        Type a business and what customers search for. Jarvis checks Google Maps live (2–3 of your daily Maps searches, about 2¢ of AI) and makes a
        one-page printout to hand the owner: where they rank, their profile and reviews, who&apos;s beating them, and the fixes that matter.
      </p>

      <div className="mb-4 grid gap-2 rounded-2xl border border-line bg-panel p-3 text-sm sm:grid-cols-2">
        <input value={form.business} onChange={(e) => setForm({ ...form, business: e.target.value })} placeholder="Business name, e.g. River City Plumbing" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
        <input value={form.city} onChange={(e) => setForm({ ...form, city: e.target.value })} placeholder="City" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
        <input value={form.searches} onChange={(e) => setForm({ ...form, searches: e.target.value })} placeholder="What customers search, e.g. plumber, water heater repair" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
        <input value={form.website} onChange={(e) => setForm({ ...form, website: e.target.value })} placeholder="Their website (optional, helps find them)" className="rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
        <button onClick={run} disabled={busy || !form.business.trim() || !form.searches.trim()} className="rounded-lg bg-accent px-3 py-2 font-semibold text-bg disabled:opacity-40 sm:col-span-2">
          {busy ? "Checking Google Maps… (about 20 seconds)" : "Run the audit"}
        </button>
        {error && <p className="text-xs text-warn sm:col-span-2">{error}</p>}
      </div>

      {rows.length > 0 && <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted">RECENT</h2>}
      <ul className="space-y-2">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/audit/${r.id}`} className="flex flex-wrap items-baseline gap-x-3 rounded-2xl border border-line bg-panel p-3 text-sm hover:border-accent">
              <span className="font-medium">{r.business}</span>
              <span className="text-xs text-muted">{r.city}</span>
              <span className="ml-auto text-xs text-muted">
                {r.fixes} to fix · {r.plan === "mappack" ? "Map Pack Pro" : "Local Visibility"} · {new Date(r.createdAt).toLocaleDateString()}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
