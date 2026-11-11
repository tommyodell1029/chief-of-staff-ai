"use client";
// Etsy shop only: the Christmas listing refresh (draft → approve each) and the January undo.
import { useState } from "react";

export default function HolidayPanel() {
  const [cutoff, setCutoff] = useState("December 10");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const go = async (action: "start" | "undo") => {
    if (action === "undo" && !confirm("Put every listing back to how it was before the Christmas update?")) return;
    setBusy(action);
    setMsg(null);
    const res = await fetch("/api/etsy/holiday", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, cutoff }) });
    const d = await res.json().catch(() => ({}));
    setBusy(null);
    setMsg(d.result ?? d.error ?? "Something went wrong.");
  };

  return (
    <section className="mb-6 rounded-2xl border border-line bg-panel p-3 text-sm">
      <h2 className="mb-1 text-sm font-semibold tracking-wide text-muted">🎄 CHRISTMAS LISTINGS</h2>
      <p className="mb-2 text-xs text-muted">
        The Shop Marketer rewrites each listing&apos;s title, tags and opening lines for gift shoppers. Each one comes to you as before → after; approving
        changes only the words on Etsy (photos, prices and personalization stay). Undo it in January.
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <label className="text-xs text-muted">
          Order-by date{" "}
          <input value={cutoff} onChange={(e) => setCutoff(e.target.value)} className="ml-1 w-32 rounded-lg border border-line bg-panel-2 px-2 py-1 text-sm text-ink" />
        </label>
        <button onClick={() => go("start")} disabled={!!busy} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg disabled:opacity-50">
          {busy === "start" ? "Drafting (a minute or two)…" : "Draft Christmas updates"}
        </button>
        <button onClick={() => go("undo")} disabled={!!busy} className="rounded-lg border border-line px-3 py-1.5 text-muted disabled:opacity-50">
          {busy === "undo" ? "Restoring…" : "Undo holiday listings"}
        </button>
      </div>
      {msg && <p className="mt-2 text-xs">{msg}</p>}
    </section>
  );
}
