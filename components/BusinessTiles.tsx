"use client";
import { useIdentity } from "@/lib/client/identity";
// Left side of the Command Center: Growth Lab shortlist, approvals waiting on Tommy, wealth, and one tile per business.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

interface Tile {
  id: number;
  name: string;
  status: string;
  moneyThisWeek: number;
  mrr: number | null;
  tasksDone: number;
  tasksOpen: number;
  waiting: number;
}
interface Opp {
  id: number;
  title: string;
  kind: string;
  score: number;
  status: string;
}
interface ApprovalRow {
  approval: { id: number; what: string; why: string };
  agent: { name: string } | null;
}

const money = (n: number) => `$${n.toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

export default function BusinessTiles({ refreshKey, onChanged }: { refreshKey: number; onChanged: () => void }) {
  const idn = useIdentity();
  const [tiles, setTiles] = useState<Tile[] | null>(null);
  const [fuNumber, setFuNumber] = useState<number | null>(null);
  const [opps, setOpps] = useState<Opp[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRow[]>([]);
  const [questions, setQuestions] = useState<{ id: number; agent: string | null; question: string; options: string[] }[]>([]);

  const load = useCallback(() => {
    fetch("/api/businesses")
      .then((r) => r.json())
      .then((d) => {
        setTiles(d.businesses);
        setFuNumber(d.fuNumber);
      })
      .catch(() => {});
    fetch("/api/lab")
      .then((r) => r.json())
      .then((d) => setOpps((d.opportunities as Opp[]).filter((o) => o.status === "proposed")))
      .catch(() => {});
    fetch("/api/approvals")
      .then((r) => r.json())
      .then((d) => setApprovals(d.approvals))
      .catch(() => {});
    fetch("/api/deck")
      .then((r) => r.json())
      .then((d) => setQuestions(d.questions ?? []))
      .catch(() => {});
  }, []);

  const answer = async (questionId: number, text: string) => {
    await fetch("/api/deck", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "answer", questionId, answer: text }) });
    load();
    onChanged();
  };

  useEffect(() => {
    load();
  }, [load, refreshKey]);

  const setUp = async () => {
    await fetch("/api/businesses", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "setup" }) });
    load();
  };

  const [result, setResult] = useState<string | null>(null);
  const decide = async (id: number, approved: boolean) => {
    const res = await fetch(`/api/approvals/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ approved }),
    });
    const d = (await res.json().catch(() => ({}))) as { approval?: { actionResult?: string | null } };
    setResult(d.approval?.actionResult ?? null);
    load();
    onChanged();
  };

  const editFu = async () => {
    const v = prompt("Your F-U money number: the monthly income that means you're free (e.g. 10000)", fuNumber ? String(fuNumber) : "");
    if (v === null) return;
    const n = Number(v.replace(/[$,\s]/g, ""));
    if (!Number.isFinite(n) || n < 0) return;
    await fetch("/api/recap", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fuNumber: n }) });
    load();
  };

  const totalWeek = tiles?.reduce((s, t) => s + t.moneyThisWeek, 0) ?? 0;
  const totalMrr = tiles?.reduce((s, t) => s + (t.mrr ?? 0), 0) ?? 0;
  const fuPct = fuNumber ? Math.min(100, Math.round((totalMrr / fuNumber) * 100)) : 0;

  return (
    <div className="grid auto-rows-max content-start gap-3 sm:grid-cols-2 lg:h-full lg:overflow-y-auto lg:pr-1">
      {/* Growth Lab shortlist */}
      <Card title="Growth Lab shortlist" href="/lab" badge={opps.length ? `${opps.length} to review` : undefined}>
        {opps.length === 0 ? (
          <p className="text-sm text-muted">The weekly Top 5 lands here every Sunday. Open the Lab to run research now.</p>
        ) : (
          <ul className="space-y-1.5 text-sm">
            {opps.slice(0, 4).map((o) => (
              <li key={o.id} className="flex items-center gap-2">
                <span className="w-8 shrink-0 rounded bg-accent-dim/50 text-center font-mono text-xs text-accent">{o.score.toFixed(1)}</span>
                <span className="truncate">{o.title}</span>
                {o.kind === "addon" && <span className="shrink-0 text-[10px] text-muted">add-on</span>}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* Waiting on you */}
      <Card title="Waiting on you" badge={approvals.length + questions.length ? String(approvals.length + questions.length) : undefined} warn={approvals.length + questions.length > 0}>
        {result && <p className="mb-2 break-words rounded-lg bg-accent-dim/30 p-2 text-xs text-accent">{result}</p>}
        {questions.length > 0 && (
          <ul className="mb-2 space-y-2">
            {questions.map((q) => (
              <li key={q.id} className="rounded-lg border border-warn/40 bg-warn/5 p-2 text-sm">
                <p className="text-xs text-warn">{q.agent ?? "An agent"} asks:</p>
                <p>{q.question}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {q.options.map((o) => (
                    <button key={o} onClick={() => answer(q.id, o)} className="rounded-md border border-accent px-2 py-1 text-xs text-accent hover:bg-accent hover:text-bg">
                      {o}
                    </button>
                  ))}
                  <button
                    onClick={() => {
                      const t = prompt(q.question);
                      if (t?.trim()) answer(q.id, t);
                    }}
                    className="px-2 py-1 text-xs text-muted hover:text-ink"
                  >
                    Other…
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
        {approvals.length === 0 && questions.length > 0 ? null : approvals.length === 0 ? (
          <p className="text-sm text-muted">Nothing needs your OK. Anything that sends, spends, posts, signs or deletes shows up here first.</p>
        ) : (
          <ul className="space-y-2">
            {approvals.slice(0, 3).map(({ approval: a, agent }) => (
              <li key={a.id} className="rounded-lg bg-panel-2 p-2 text-sm">
                <p className="line-clamp-3">{a.what}</p>
                <p className="mt-0.5 line-clamp-2 text-xs text-muted">
                  {agent ? `${agent.name}: ` : ""}
                  {a.why}
                </p>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => decide(a.id, true)} className="rounded-md bg-accent px-3 py-1 text-xs font-semibold text-bg">
                    Approve
                  </button>
                  <button onClick={() => decide(a.id, false)} className="rounded-md border border-line px-3 py-1 text-xs text-muted">
                    Deny
                  </button>
                </div>
              </li>
            ))}
            {approvals.length > 3 && <li className="text-xs text-muted">+{approvals.length - 3} more after these</li>}
          </ul>
        )}
      </Card>

      {/* Wealth */}
      <Card title="Wealth">
        <dl className="grid grid-cols-2 gap-2 text-center">
          <Stat label="This week" value={money(totalWeek)} />
          <Stat label="Monthly recurring" value={money(totalMrr)} />
        </dl>
        <button onClick={editFu} className="mt-3 block w-full text-left">
          <div className="flex justify-between text-[11px] text-muted">
            <span>F-U money</span>
            <span>{fuNumber ? `${money(totalMrr)} / ${money(fuNumber)} a month` : "Tap to set your number"}</span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-panel-2">
            <div className="h-full bg-accent" style={{ width: `${Math.max(fuPct, 1)}%` }} />
          </div>
        </button>
      </Card>

      {/* Businesses */}
      {tiles && tiles.length === 0 && (
        <Card title="Your businesses">
          {idn.kit ? (
            <>
              <p className="text-sm text-muted">Import your setup file to build a crew for each of your businesses. Nothing runs until you press Launch.</p>
              <Link href="/setup" className="mt-3 inline-block rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg">
                Finish setup
              </Link>
            </>
          ) : (
            <>
              <p className="text-sm text-muted">
                Set up the three businesses from your plan: the Etsy photo-gift store, Creator, and LaunchPad Local. Each gets a draft crew for you to
                review before anything runs.
              </p>
              <button onClick={setUp} className="mt-3 rounded-lg bg-accent px-3 py-2 text-sm font-semibold text-bg">
                Set up my 3 businesses
              </button>
            </>
          )}
        </Card>
      )}
      {tiles?.map((t) => (
        <Card
          key={t.id}
          title={t.name}
          href={`/businesses/${t.id}`}
          badge={t.status === "draft" ? "Crew needs your OK" : t.status === "paused" ? "Paused" : undefined}
          warn={t.status === "draft"}
        >
          <dl className="grid grid-cols-3 gap-2 text-center">
            <Stat label="This week" value={money(t.moneyThisWeek)} />
            <Stat label="Tasks done" value={String(t.tasksDone)} sub={t.tasksOpen ? `${t.tasksOpen} running` : undefined} />
            <Stat label="Waiting" value={String(t.waiting)} highlight={t.waiting > 0} />
          </dl>
        </Card>
      ))}
    </div>
  );
}

function Card({
  title,
  href,
  badge,
  warn,
  children,
}: {
  title: string;
  href?: string;
  badge?: string;
  warn?: boolean;
  children: React.ReactNode;
}) {
  const head = (
    <div className="mb-2 flex items-start justify-between gap-2">
      <h2 className="font-medium">{title}</h2>
      {badge && (
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${warn ? "bg-warn/15 text-warn" : "bg-accent-dim/50 text-accent"}`}>
          {badge}
        </span>
      )}
    </div>
  );
  return (
    <article className="flex min-h-36 flex-col rounded-2xl border border-line bg-panel p-4">
      {href ? (
        <Link href={href} className="hover:text-accent">
          {head}
        </Link>
      ) : (
        head
      )}
      <div className="flex-1">{children}</div>
      {href && (
        <Link href={href} className="mt-3 self-end text-xs text-accent">
          Open →
        </Link>
      )}
    </article>
  );
}

function Stat({ label, value, sub, highlight }: { label: string; value: string; sub?: string; highlight?: boolean }) {
  return (
    <div className="rounded-lg bg-panel-2/70 py-2">
      <dd className={`font-mono text-base ${highlight ? "text-warn" : "text-ink"}`}>{value}</dd>
      <dt className="text-[10px] text-muted">{label}</dt>
      {sub && <dt className="text-[10px] text-accent">{sub}</dt>}
    </div>
  );
}
