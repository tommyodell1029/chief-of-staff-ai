"use client";
import { useIdentity } from "@/lib/client/identity";
// HUD: a big, glanceable, read-only view for a wall screen, desk tablet or TV. Refreshes itself.
import Link from "next/link";
import { useEffect, useState } from "react";
import Core, { type CorePhase, type Satellite } from "./Core";
import { dueLabel, type TodoInfo } from "./TodayBar";

interface HudData {
  todos: TodoInfo[];
  events: string[];
  waiting: number;
  shortlist: number;
  week: number;
  mrr: number;
  fuNumber: number | null;
  businesses: { id: number; name: string; status: string; moneyThisWeek: number; tasksDone: number; waiting: number }[];
  recent: { id: number; agent: string; summary: string }[];
  spend: { totalUsd: number; monthUsd: number; monthCapUsd: number };
  goals?: { business: string; title: string; pct: number; pace: string; current: number | null; target: number; unit: string }[];
}

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function Hud({ station = false }: { station?: boolean }) {
  const idn = useIdentity();
  const [data, setData] = useState<HudData | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [phase, setPhase] = useState<CorePhase>("idle");

  // On the station, the big core follows what Jarvis is doing (the Station component broadcasts it).
  useEffect(() => {
    if (!station) return;
    const on = (e: Event) => setPhase((e as CustomEvent<CorePhase>).detail);
    window.addEventListener("jarvis-phase", on);
    return () => window.removeEventListener("jarvis-phase", on);
  }, [station]);

  useEffect(() => {
    const load = () =>
      fetch("/api/hud")
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => d && setData(d))
        .catch(() => {});
    load();
    setNow(new Date());
    const a = setInterval(load, 30_000);
    const b = setInterval(() => setNow(new Date()), 1_000);
    // Keep a wall display awake where the browser allows it.
    const nav = navigator as Navigator & { wakeLock?: { request: (t: "screen") => Promise<unknown> } };
    nav.wakeLock?.request("screen").catch(() => {});
    return () => {
      clearInterval(a);
      clearInterval(b);
    };
  }, []);

  const fuPct = data?.fuNumber ? Math.min(100, (data.mrr / data.fuNumber) * 100) : 0;
  // One satellite per business: its name and best goal progress (warning color if a goal is behind).
  const satellites: Satellite[] = (data?.businesses ?? []).map((b) => {
    const gs = (data?.goals ?? []).filter((g) => g.business === b.name);
    const short = b.name.replace(/\s*\(.*\)\s*/, "").split(/\s+/).slice(0, 2).join(" ");
    const pct = gs.length ? Math.round(gs.reduce((sum, g) => sum + g.pct, 0) / gs.length) : null;
    return { label: pct === null ? short : `${short} ${pct}%`, warn: gs.some((g) => g.pace === "behind") };
  });

  return (
    <div className={`min-h-dvh bg-bg p-6 text-ink lg:p-10 ${station ? "pb-44" : ""}`}>
      <div className="mx-auto grid max-w-[1600px] gap-6 lg:grid-cols-3">
        <section className="lg:col-span-3 flex flex-wrap items-end justify-between gap-4 border-b border-line pb-6">
          <div>
            <div className="text-sm font-semibold tracking-[0.35em] text-accent">{idn.assistant.toUpperCase()}</div>
            <div className="font-mono text-6xl font-light tracking-tight lg:text-8xl">
              {now?.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) ?? " "}
            </div>
            <div className="text-xl text-muted">{now?.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" })}</div>
          </div>
          {station && (
            <div className="hidden md:block">
              <Core phase={phase} size={260} satellites={satellites} />
            </div>
          )}
          <div className="flex gap-8 text-right">
            <Big label="This week" value={data ? money(data.week) : "—"} />
            <Big label="Monthly recurring" value={data ? money(data.mrr) : "—"} />
            <Big label="Waiting on you" value={data ? String(data.waiting) : "—"} warn={!!data?.waiting} />
          </div>
        </section>

        <Panel title="Next up">
          {data?.todos.length ? (
            <ul className="space-y-3">
              {data.todos.map((t) => {
                const due = dueLabel(t.dueAt);
                return (
                  <li key={t.id} className="text-2xl">
                    {t.title}
                    {due && <span className={`ml-3 text-lg ${due.overdue ? "text-warn" : "text-muted"}`}>{due.text}</span>}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="text-xl text-muted">Nothing on the list.</p>
          )}
          {data && data.events.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-sm tracking-[0.2em] text-muted">TODAY&apos;S CALENDAR</h3>
              <ul className="space-y-1 text-lg">
                {data.events.map((e) => (
                  <li key={e}>{e}</li>
                ))}
              </ul>
            </>
          )}
        </Panel>

        <Panel title="Businesses">
          <ul className="space-y-4">
            {data?.businesses.map((b) => (
              <li key={b.id} className="flex items-baseline justify-between gap-4">
                <span className="text-xl">{b.name}</span>
                <span className="shrink-0 font-mono text-lg text-muted">
                  {money(b.moneyThisWeek)} · {b.tasksDone} done{b.waiting ? <span className="text-warn"> · {b.waiting} waiting</span> : null}
                </span>
              </li>
            ))}
          </ul>
          {data?.goals && data.goals.length > 0 && (
            <div className="mt-6 space-y-3">
              <h3 className="text-sm tracking-[0.2em] text-muted">GOALS</h3>
              {data.goals.slice(0, 6).map((g) => (
                <div key={`${g.business}-${g.title}`}>
                  <div className="flex justify-between gap-3 text-base">
                    <span className="truncate">{g.title}</span>
                    <span className={`shrink-0 font-mono ${g.pace === "behind" ? "text-warn" : "text-muted"}`}>
                      {g.current === null ? "—" : g.unit === "$" ? `$${Math.round(g.current).toLocaleString()}` : Math.round(g.current)} /{" "}
                      {g.unit === "$" ? `$${g.target.toLocaleString()}` : g.target}
                    </span>
                  </div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
                    <div className={`h-full ${g.pace === "behind" ? "bg-warn" : "bg-accent"}`} style={{ width: `${Math.max(g.pct, 1)}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}
          {data?.fuNumber ? (
            <div className="mt-8">
              <div className="flex justify-between text-sm text-muted">
                <span>F-U MONEY</span>
                <span>
                  {money(data.mrr)} / {money(data.fuNumber)} a month
                </span>
              </div>
              <div className="mt-2 h-3 overflow-hidden rounded-full bg-panel-2">
                <div className="h-full bg-accent" style={{ width: `${Math.max(fuPct, 1)}%` }} />
              </div>
            </div>
          ) : null}
        </Panel>

        <Panel title="Crew updates">
          {data?.recent.length ? (
            <ul className="space-y-4">
              {data.recent.map((r) => (
                <li key={r.id} className="text-lg">
                  <span className="text-accent">{r.agent}: </span>
                  {r.summary}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xl text-muted">No crew results yet.</p>
          )}
          {data && data.shortlist > 0 && <p className="mt-6 text-lg text-accent">{data.shortlist} new ideas in the Growth Lab</p>}
          {data && (
            <p className="mt-6 text-sm text-muted">
              AI spend: ${data.spend.totalUsd.toFixed(2)} today · ${data.spend.monthUsd.toFixed(2)} of ${data.spend.monthCapUsd} this month
            </p>
          )}
        </Panel>
      </div>
      {!station && (
        <Link href="/" className="fixed bottom-4 right-4 text-xs text-muted/60 hover:text-ink">
          Exit HUD
        </Link>
      )}
    </div>
  );
}

function Big({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div>
      <div className={`font-mono text-4xl lg:text-5xl ${warn ? "text-warn" : ""}`}>{value}</div>
      <div className="text-xs tracking-[0.2em] text-muted">{label.toUpperCase()}</div>
    </div>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-line bg-panel p-6">
      <h2 className="mb-4 text-sm font-semibold tracking-[0.25em] text-accent">{title.toUpperCase()}</h2>
      {children}
    </section>
  );
}
