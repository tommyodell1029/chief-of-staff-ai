"use client";
// The main screen: Today bar on top, business tiles on the left, Jarvis on the right.
import { useCallback, useEffect, useState } from "react";
import BusinessTiles from "./BusinessTiles";
import JarvisPanel from "./JarvisPanel";
import TodayBar, { type Status } from "./TodayBar";

interface Recap {
  tasks: { id: number; agent: string; status: string; summary: string }[];
  approvals: number;
  opportunities: number;
  researchNotes: number;
}

const AWAY_MS = 3 * 3_600_000; // show "While you were away" after 3+ hours

export default function CommandCenter() {
  const [status, setStatus] = useState<Status | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [recap, setRecap] = useState<Recap | null>(null);

  const refreshStatus = useCallback(() => {
    fetch("/api/status")
      .then((r) => r.json())
      .then(setStatus)
      .catch(() => {});
    setRefreshKey((k) => k + 1);
  }, []);

  useEffect(() => {
    refreshStatus();
    const t = setInterval(refreshStatus, 60_000);
    return () => clearInterval(t);
  }, [refreshStatus]);

  // "While you were away": what the crews and the Growth Lab did since this device last opened Jarvis.
  useEffect(() => {
    let last = 0;
    try {
      last = Number(localStorage.getItem("jarvis.lastSeen")) || 0;
      localStorage.setItem("jarvis.lastSeen", String(Date.now()));
    } catch {}
    if (!last || Date.now() - last < AWAY_MS) return;
    fetch(`/api/recap?since=${last}`)
      .then((r) => r.json())
      .then((r: Recap) => {
        if (r.tasks.length || r.approvals || r.opportunities || r.researchNotes) setRecap(r);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1400px] flex-col gap-3 p-3 sm:p-4 lg:h-dvh">
      <TodayBar status={status} onChanged={refreshStatus} />
      {recap && <AwayRecap recap={recap} onClose={() => setRecap(null)} />}
      <main className="grid min-h-0 flex-1 grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        <section className="order-2 min-h-0 lg:order-1">
          <BusinessTiles refreshKey={refreshKey} onChanged={refreshStatus} />
        </section>
        <section className="order-1 flex min-h-[70dvh] flex-col lg:order-2 lg:min-h-0">
          <JarvisPanel voiceReady={status?.voice ?? false} briefing={status?.briefing ?? null} onChanged={refreshStatus} />
        </section>
      </main>
    </div>
  );
}

function AwayRecap({ recap, onClose }: { recap: Recap; onClose: () => void }) {
  const parts = [
    recap.tasks.length && `${recap.tasks.length} crew task${recap.tasks.length === 1 ? "" : "s"} finished`,
    recap.approvals && `${recap.approvals} need${recap.approvals === 1 ? "s" : ""} your OK`,
    recap.opportunities && `${recap.opportunities} new idea${recap.opportunities === 1 ? "" : "s"} on the shortlist`,
    recap.researchNotes && `${recap.researchNotes} research note${recap.researchNotes === 1 ? "" : "s"}`,
  ].filter(Boolean);
  return (
    <section className="rounded-2xl border border-accent/40 bg-accent-dim/20 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="text-sm font-semibold text-accent">While you were away, sir</h2>
          <p className="text-sm">{parts.join(" · ")}.</p>
          {recap.tasks.length > 0 && (
            <ul className="mt-2 space-y-1 text-sm text-ink/85">
              {recap.tasks.slice(0, 5).map((t) => (
                <li key={t.id}>
                  <b>{t.agent}</b>
                  {t.status === "failed" ? " (failed)" : ""}: {t.summary || "finished"}
                </li>
              ))}
            </ul>
          )}
        </div>
        <button onClick={onClose} className="text-sm text-muted hover:text-ink" aria-label="Dismiss">
          ✕
        </button>
      </div>
    </section>
  );
}
