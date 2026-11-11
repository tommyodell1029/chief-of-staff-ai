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

  const load = useCallback(() => {
    fetch("/api/kit")
      .then((r) => r.json())
      .then(setS)
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
    </div>
  );
}
