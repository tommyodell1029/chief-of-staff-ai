"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import NotifyButton from "./NotifyButton";

export interface Spend {
  totalUsd: number;
  calls: number;
  capUsd: number;
  monthUsd: number;
  monthCapUsd: number;
  fraction: number;
  warning: boolean;
  overCap: boolean;
  overMonthCap: boolean;
}

export interface TodoInfo {
  id: number;
  title: string;
  dueAt: string | null;
  done: boolean;
}

export interface BriefingInfo {
  id: number;
  kind: string;
  title: string;
  content: string;
}

export interface Status {
  spend: Spend;
  brain: "ready" | "fake" | "missing_key";
  voice: boolean;
  calendar: boolean;
  todos: TodoInfo[];
  briefing: BriefingInfo | null;
  kit?: { profile: boolean; launched: boolean } | null; // set on client assistants (Chief of Staff AI)
}

export function dueLabel(dueAt: string | null): { text: string; overdue: boolean } | null {
  if (!dueAt) return null;
  const d = new Date(dueAt);
  const now = new Date();
  const sameDay = d.toDateString() === now.toDateString();
  const time = d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  const text = sameDay ? time : `${d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })} ${time}`;
  return { text, overdue: d < now };
}

function greeting(h: number) {
  if (h < 5) return "Burning the midnight oil, sir";
  if (h < 12) return "Good morning, sir";
  if (h < 17) return "Good afternoon, sir";
  return "Good evening, sir";
}

export default function TodayBar({ status, onChanged }: { status: Status | null; onChanged: () => void }) {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    setNow(new Date());
    const t = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(t);
  }, []);

  return (
    <header className="flex flex-wrap items-center gap-x-6 gap-y-2 rounded-2xl border border-line bg-panel px-4 py-3">
      <div className="min-w-0">
        <div className="text-[11px] font-semibold tracking-[0.2em] text-accent">TODAY</div>
        <div className="text-lg font-medium">
          {now ? greeting(now.getHours()) : " "}
          <span className="ml-2 text-sm font-normal text-muted">
            {now?.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })}
            {" · "}
            {now?.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
          </span>
        </div>
      </div>

      <NextUp todos={status?.todos} onChanged={onChanged} />

      <div className="ml-auto flex flex-wrap items-center justify-end gap-2 sm:gap-3">
        <StatusPills status={status} />
        <CostMeter spend={status?.spend} />
        <NotifyButton />
        <Link
          href="/outreach"
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
        >
          Outreach
        </Link>
        {!status ? null : status.kit ? (
          <Link
            href={status.kit.profile ? "/launch" : "/setup"}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition sm:px-3 sm:py-2 sm:text-sm ${status.kit.launched ? "border-line text-muted hover:border-accent hover:text-ink" : "border-accent text-accent"}`}
          >
            {status.kit.profile ? (status.kit.launched ? "Launch" : "🚀 Launch") : "Finish setup"}
          </Link>
        ) : (
          <>
            <Link
              href="/calls"
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
            >
              Calls
            </Link>
            <Link
              href="/studio"
              className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
            >
              Studio
            </Link>
          </>
        )}
        <Link
          href="/deck"
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
        >
          Deck
        </Link>
        <Link
          href="/outbox"
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
        >
          Outbox
        </Link>
        <Link
          href="/trust"
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
        >
          Autopilot
        </Link>
        <Link
          href="/connections"
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
        >
          Connections
        </Link>
        <Link
          href="/hud"
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
        >
          HUD
        </Link>
        <Link
          href="/todos"
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
        >
          To-dos
        </Link>
        <Link
          href="/about"
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
        >
          About me
        </Link>
        <Link
          href="/memories"
          className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted transition hover:border-accent hover:text-ink sm:px-3 sm:py-2 sm:text-sm"
        >
          Memories
        </Link>
      </div>
    </header>
  );
}

// The next three open to-dos, tickable right from the top bar.
function NextUp({ todos, onChanged }: { todos?: TodoInfo[]; onChanged: () => void }) {
  if (!todos) return <div className="hidden min-w-0 flex-1 md:block" />;
  const complete = async (id: number) => {
    await fetch(`/api/todos/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ done: true }),
    });
    onChanged();
  };
  return (
    <div className="order-last w-full min-w-0 text-sm md:order-none md:w-auto md:min-w-56 md:flex-1">
      <div className="text-[11px] font-semibold tracking-[0.2em] text-muted">NEXT UP</div>
      {todos.length === 0 ? (
        <p className="text-muted">Nothing on your list. Say “remind me to…” to add something.</p>
      ) : (
        <ul className="space-y-0.5">
          {todos.map((t) => {
            const due = dueLabel(t.dueAt);
            return (
              <li key={t.id} className="flex min-w-0 items-center gap-2">
                <button
                  onClick={() => complete(t.id)}
                  aria-label={`Mark "${t.title}" done`}
                  className="h-4 w-4 shrink-0 rounded border border-accent/60 hover:bg-accent/30"
                />
                <span className="truncate text-ink/90">{t.title}</span>
                {due && (
                  <span className={`shrink-0 text-xs ${due.overdue ? "text-warn" : "text-muted"}`}>{due.text}</span>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function StatusPills({ status }: { status: Status | null }) {
  if (!status) return null;
  return (
    <div className="flex gap-1.5 text-[11px]">
      {status.brain === "missing_key" && <Pill tone="danger">No Anthropic key</Pill>}
      {status.brain === "fake" && <Pill tone="warn">Test brain</Pill>}
      {!status.voice && <Pill tone="warn">Voice off</Pill>}
    </div>
  );
}

function Pill({ tone, children }: { tone: "warn" | "danger"; children: React.ReactNode }) {
  const cls = tone === "danger" ? "border-danger/40 text-danger" : "border-warn/40 text-warn";
  return <span className={`rounded-full border px-2 py-0.5 ${cls}`}>{children}</span>;
}

export function CostMeter({ spend }: { spend?: Spend }) {
  if (!spend) return <div className="w-32" />;
  const pct = Math.min(100, Math.round(spend.fraction * 100));
  const over = spend.overCap || spend.overMonthCap;
  const tone = over ? "bg-danger" : spend.warning ? "bg-warn" : "bg-accent";
  const text = over ? "text-danger" : spend.warning ? "text-warn" : "text-ink";
  return (
    <div
      className="w-36"
      title={`${spend.calls} AI calls today. Daily cap $${spend.capUsd.toFixed(2)}, monthly cap $${spend.monthCapUsd.toFixed(2)}.`}
    >
      <div className="flex items-baseline justify-between text-[11px] text-muted">
        <span>AI spend today</span>
        <span className={`font-mono text-xs ${text}`}>${spend.totalUsd.toFixed(2)}</span>
      </div>
      <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
        <div className={`h-full ${tone} transition-all`} style={{ width: `${Math.max(pct, 2)}%` }} />
      </div>
      <div className={`mt-0.5 text-[10px] ${spend.warning ? text : "text-muted"}`}>
        {spend.overMonthCap
          ? "Monthly budget used up"
          : spend.overCap
            ? "Daily cap reached"
            : `Month: $${spend.monthUsd.toFixed(2)} of $${spend.monthCapUsd.toFixed(0)}`}
      </div>
    </div>
  );
}
