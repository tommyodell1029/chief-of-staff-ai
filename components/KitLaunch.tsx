"use client";
// The Launch screen: when everything required is green, one press turns on the crews and outreach.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/lib/client/identity";

interface Item {
  id: string;
  label: string;
  ok: boolean;
  required: boolean;
  detail: string;
  fix?: { label: string; href?: string; action?: string };
}
interface KitState {
  kit: boolean;
  profile: { owner: { name: string }; assistant: { name: string } } | null;
  readiness: Item[];
  launched: number | null;
  paused: boolean;
}

export default function KitLaunch() {
  const idn = useIdentity();
  const [s, setS] = useState<KitState | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [lanes, setLanes] = useState<{ id: string; label: string; auto: boolean; current: number; streak: number; dailyCap: number }[]>([]);

  const load = useCallback(() => {
    fetch("/api/kit")
      .then((r) => r.json())
      .then(setS)
      .catch(() => {});
    fetch("/api/trust")
      .then((r) => r.json())
      .then((d) => setLanes(d.lanes ?? []))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const act = async (action: string) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/kit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (d.message || d.error) setMsg({ ok: res.ok, text: d.message ?? d.error });
    load();
  };

  if (s && !s.kit) return <div className="mx-auto max-w-xl p-6 text-sm text-muted">Launch is for client assistants (KIT_MODE=1).</div>;
  const required = s?.readiness.filter((i) => i.required) ?? [];
  const ready = required.length > 0 && required.every((i) => i.ok);
  const running = !!s?.launched && !s.paused;

  return (
    <div className="mx-auto max-w-xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Home
        </Link>
        <h1 className="text-xl font-semibold">Launch</h1>
      </header>

      <div className={`mb-4 rounded-2xl border p-5 text-center ${running ? "border-accent bg-accent/10" : "border-line bg-panel"}`}>
        {running ? (
          <>
            <p className="text-lg font-semibold text-accent">🚀 {idn.assistant} is running</p>
            <p className="text-sm text-muted">Since {new Date(s!.launched!).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Anything that sends, spends or posts still comes to you first.</p>
            <div className="mt-3 flex justify-center gap-2">
              <Link href="/deck" className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg">
                Watch the Command Deck
              </Link>
              <button onClick={() => act("pause")} disabled={busy} className="rounded-lg border border-line px-4 py-2 text-sm text-muted hover:text-ink">
                Pause everything
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="text-lg font-semibold">{ready ? "Everything's ready." : "Almost there."}</p>
            <p className="text-sm text-muted">
              {ready ? `Press Launch and ${idn.assistant}'s crews start working${s?.readiness.some((i) => i.id === "sending") ? " and outreach goes live" : ""}.` : "Finish the items marked below, then Launch lights up."}
            </p>
            <button
              onClick={() => act("launch")}
              disabled={!ready || busy}
              className="mt-4 rounded-full bg-accent px-10 py-3 text-lg font-bold tracking-wide text-bg shadow-[0_0_30px_rgba(76,201,240,0.45)] disabled:opacity-30 disabled:shadow-none"
            >
              {busy ? "Launching…" : s?.paused ? "Launch again" : "LAUNCH"}
            </button>
          </>
        )}
      </div>
      {msg && <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-accent/10 text-accent" : "bg-warn/10 text-warn"}`}>{msg.text}</p>}

      <ul className="space-y-2">
        {s?.readiness.map((i) => (
          <li key={i.id} className="flex items-start gap-3 rounded-2xl border border-line bg-panel p-3 text-sm">
            <span className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-xs font-bold ${i.ok ? "bg-accent text-bg" : i.required ? "bg-warn text-bg" : "bg-panel-2 text-muted"}`}>{i.ok ? "✓" : i.required ? "!" : "·"}</span>
            <div className="min-w-0 flex-1">
              <p className="font-medium">
                {i.label}
                {!i.required && <span className="ml-1 text-xs font-normal text-muted">(optional)</span>}
              </p>
              <p className="text-xs text-muted">{i.detail}</p>
            </div>
            {i.fix &&
              (i.fix.href ? (
                <Link href={i.fix.href} className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink">
                  {i.fix.label}
                </Link>
              ) : (
                <button onClick={() => act(i.fix!.action!)} className="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-muted hover:text-ink">
                  {i.fix.label}
                </button>
              ))}
          </li>
        ))}
      </ul>

      {/* Autopilot: earned, lane by lane, after launch. */}
      {s?.profile && lanes.length > 0 && (
        <div className="mt-5 rounded-2xl border border-line bg-panel p-4 text-sm">
          <div className="flex items-baseline gap-2">
            <p className="font-semibold">Autopilot</p>
            <Link href="/trust" className="ml-auto text-xs text-accent underline">
              Manage
            </Link>
          </div>
          <p className="mt-1 text-xs text-muted">
            Everything starts on &ldquo;ask me&rdquo;. Approve a kind of action enough times without changes and {idn.assistant} offers to handle it on its own, under a daily
            cap. It tells you each time, and goes back to asking if anything fails. Money, calls and contracts always wait for you.
          </p>
          <ul className="mt-3 space-y-2">
            {lanes.map((l) => (
              <li key={l.id}>
                <div className="flex items-baseline gap-2 text-xs">
                  <span className="text-ink">{l.label}</span>
                  <span className={`ml-auto ${l.auto ? "text-accent" : "text-muted"}`}>{l.auto ? `on autopilot · up to ${l.dailyCap}/day` : `${Math.min(l.current, l.streak)}/${l.streak} clean approvals`}</span>
                </div>
                <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full bg-accent transition-all" style={{ width: `${l.auto ? 100 : Math.max(3, Math.min(100, (l.current / l.streak) * 100))}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
