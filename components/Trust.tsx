"use client";
// The trust ladder: which kinds of actions Jarvis may do on his own, how close each is to autopilot, and what he
// did on autopilot lately.
import Link from "next/link";
import { useEffect, useState } from "react";
import { useIdentity } from "@/lib/client/identity";

interface LaneRow {
  id: string;
  label: string;
  detail: string;
  streak: number;
  dailyCap: number;
  auto: boolean;
  current: number;
  autoToday: number;
}
interface Data {
  lanes: LaneRow[];
  recent: { lane: string; label: string; outcome: string; summary: string | null; at: string }[];
}

export default function Trust() {
  const [data, setData] = useState<Data | null>(null);
  const idn = useIdentity();

  useEffect(() => {
    fetch("/api/trust")
      .then((r) => r.json())
      .then(setData)
      .catch(() => {});
  }, []);

  const toggle = async (l: LaneRow) => {
    const turnOn = !l.auto;
    if (turnOn && l.current < l.streak && !confirm(`${l.label} has ${l.current} of ${l.streak} clean approvals so far. Put it on autopilot anyway?`)) return;
    const res = await fetch("/api/trust", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ lane: l.id, auto: turnOn }) });
    if (res.ok) setData(await res.json());
  };

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">Autopilot</h1>
      </header>
      <p className="mb-4 text-sm text-muted">
        Every approval you give without changes counts toward a streak. When a streak is long enough, {idn.assistant} asks whether it can handle that kind of
        action on its own (autopilot). On autopilot it stays under a daily cap, tells you about each one, and goes back to asking if anything fails. Editing
        or denying one restarts its streak. Money, phone calls and contracts always wait for you.
      </p>

      <ul className="space-y-2">
        {data?.lanes.map((l) => (
          <li key={l.id} className="rounded-2xl border border-line bg-panel p-3 text-sm">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <span className="font-medium">{l.label}</span>
              <span className={`text-xs ${l.auto ? "text-accent" : "text-muted"}`}>{l.auto ? `autopilot · ${l.autoToday}/${l.dailyCap} today` : "asks you"}</span>
              <button
                onClick={() => toggle(l)}
                className={`ml-auto rounded-md px-3 py-1 text-xs font-semibold ${l.auto ? "border border-line text-muted hover:text-ink" : "bg-accent text-bg"}`}
              >
                {l.auto ? "Ask me again" : "Turn on autopilot"}
              </button>
            </div>
            <p className="mt-1 text-xs text-muted">{l.detail}</p>
            {!l.auto && (
              <div className="mt-2 flex items-center gap-2">
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full bg-accent" style={{ width: `${Math.max(2, Math.min(100, (l.current / l.streak) * 100))}%` }} />
                </div>
                <span className="text-xs text-muted">
                  {l.current}/{l.streak} clean approvals
                </span>
              </div>
            )}
          </li>
        ))}
      </ul>

      <h2 className="mb-2 mt-6 text-sm font-semibold tracking-wide text-muted">DONE ON AUTOPILOT (LAST 2 WEEKS)</h2>
      {data && data.recent.length === 0 && <p className="text-sm text-muted">Nothing yet.</p>}
      <ul className="space-y-1 text-sm">
        {data?.recent.map((r, i) => (
          <li key={i} className="flex flex-wrap gap-x-2">
            <span className="text-xs text-muted">{new Date(r.at).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span>
            <span className={r.outcome === "failed" ? "text-warn" : ""}>
              {r.label}: {r.summary}
              {r.outcome === "failed" ? " (failed, autopilot paused)" : ""}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
