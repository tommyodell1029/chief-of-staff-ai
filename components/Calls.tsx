"use client";
// Calls: what Jarvis has phoned for you, what happened, and the transcript.
import Link from "next/link";
import { useEffect, useState } from "react";

interface Call {
  id: number;
  business: string;
  toNumber: string;
  task: string;
  details: string;
  status: string;
  outcome: string | null;
  summary: string | null;
  transcript: string | null;
  error: string | null;
  createdAt: string;
}

const STATUS: Record<string, string> = {
  awaiting_approval: "waiting for your OK",
  queued: "approved, calls after 9 am",
  calling: "on the phone…",
  done: "done",
  failed: "didn't work",
  denied: "you said no",
};
const OUTCOME: Record<string, string> = {
  booked: "✅ booked",
  done: "✅ done",
  not_available: "not available",
  no_answer: "no answer",
  voicemail: "voicemail",
  needs_tommy: "👉 needs you",
  failed: "didn't connect",
};

export default function Calls() {
  const [data, setData] = useState<{ calls: Call[]; number: string | null; problem: string | null } | null>(null);
  const [open, setOpen] = useState<number | null>(null);

  useEffect(() => {
    const load = () =>
      fetch("/api/calls")
        .then((r) => r.json())
        .then(setData)
        .catch(() => {});
    load();
    const t = setInterval(load, 15_000);
    return () => clearInterval(t);
  }, []);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">Calls</h1>
        {data?.number && <span className="text-xs text-muted">Calls from {data.number}</span>}
      </header>
      <p className="mb-3 text-sm text-muted">
        Ask Jarvis: “call Olive Garden on Southside and book a table for two Friday around 7.” You approve each call in Waiting on you. Jarvis&apos;s voice
        says it&apos;s an AI calling for you, never pays or gives card details, and calls only 9 am–8 pm.
      </p>
      {data?.problem && <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">Calling isn&apos;t ready: {data.problem} (see docs/calls-setup.md)</p>}
      <ul className="space-y-2">
        {data?.calls.map((c) => (
          <li key={c.id} className="rounded-2xl border border-line bg-panel p-3 text-sm">
            <button onClick={() => setOpen(open === c.id ? null : c.id)} className="flex w-full flex-wrap items-baseline gap-x-3 text-left">
              <span className="font-medium">{c.business}</span>
              <span className="text-muted">{c.task}</span>
              <span className={`ml-auto text-xs ${c.outcome === "needs_tommy" || c.status === "awaiting_approval" ? "text-warn" : "text-accent"}`}>
                {c.outcome ? OUTCOME[c.outcome] ?? c.outcome : STATUS[c.status] ?? c.status}
              </span>
            </button>
            {c.summary && <p className="mt-1">{c.summary}</p>}
            {c.error && <p className="mt-1 text-xs text-warn">{c.error}</p>}
            {open === c.id && (
              <div className="mt-2 space-y-2 text-xs text-muted">
                <p>
                  {c.toNumber} · {new Date(c.createdAt).toLocaleString()}
                </p>
                <p>Limits: {c.details}</p>
                {c.transcript && <pre className="whitespace-pre-wrap rounded-lg bg-panel-2 p-2 font-sans text-ink">{c.transcript}</pre>}
              </div>
            )}
          </li>
        ))}
        {data && data.calls.length === 0 && <li className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">No calls yet.</li>}
      </ul>
    </div>
  );
}
