"use client";
// The Command Deck: Jarvis's crews as a live holographic map. Each business is a wing, each agent a station.
// Colors and beams come straight from the database (working, waiting on you, handing off), so what you see is
// what's really happening. Tap an agent for its details, its handoff routes and to give it a task.
import Link from "next/link";
import { useIdentity } from "@/lib/client/identity";
import { useCallback, useEffect, useMemo, useState } from "react";

type State = "working" | "queued" | "question" | "approval" | "idle" | "paused" | "draft";
interface AgentView {
  id: number;
  name: string;
  job: string;
  status: string;
  state: State;
  doing: string | null;
  queued: number;
  approvals: number;
  question: { id: number; question: string; options: string[] } | null;
  handoffTo: number[];
  tools: string[];
  costWeek: number;
  doneWeek: number;
  last: { summary: string; at: string | null } | null;
}
interface Deck {
  businesses: { id: number; name: string; status: string; agents: AgentView[] }[];
  handoffs: { from: number; to: number; at: string; taskId: number; status: string }[];
  questions: { id: number; agent: string | null; question: string; options: string[] }[];
}

const STATE: Record<State, { label: string; fill: string; ring: string }> = {
  working: { label: "Working", fill: "var(--color-accent)", ring: "var(--color-accent)" },
  queued: { label: "Up next", fill: "var(--color-accent-dim)", ring: "var(--color-accent)" },
  question: { label: "Has a question", fill: "var(--color-warn)", ring: "var(--color-warn)" },
  approval: { label: "Waiting on your OK", fill: "var(--color-warn)", ring: "var(--color-warn)" },
  idle: { label: "Standing by", fill: "var(--color-panel-2)", ring: "var(--color-line)" },
  paused: { label: "Paused", fill: "var(--color-panel)", ring: "var(--color-line)" },
  draft: { label: "Not approved yet", fill: "var(--color-panel)", ring: "var(--color-line)" },
};
const short = (s: string) => s.replace(/\s*\(.*\)\s*/, "").replace(/^Custom Photo Gifts$/, "Custom Photo Gifts");

const W = 1200;
const H = 780;
const CX = W / 2;
const CY = H / 2;

export default function CommandDeck() {
  const idn = useIdentity();
  const [deck, setDeck] = useState<Deck | null>(null);
  const [sel, setSel] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [taskText, setTaskText] = useState("");
  const [tonight, setTonight] = useState(false);
  const [night, setNight] = useState<{ on: boolean; budget: number; active: boolean; budgetLeft: number; queued: { id: number; agent: string; instructions: string }[]; last: { at: number; text: string } | null } | null>(null);
  const loadNight = useCallback(() => {
    fetch("/api/nightshift")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setNight(d))
      .catch(() => {});
  }, []);
  const nightPost = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/nightshift", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    if (r.ok) setNight(await r.json());
  };

  const load = useCallback(() => {
    fetch("/api/deck")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Deck | null) => d && setDeck(d))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    loadNight();
    const t = setInterval(load, 4000);
    const n = setInterval(loadNight, 30000);
    return () => {
      clearInterval(t);
      clearInterval(n);
    };
  }, [load, loadNight]);

  // Opened from a question alert (/deck?q=12): select that agent.
  useEffect(() => {
    const q = Number(new URLSearchParams(window.location.search).get("q"));
    if (!q || !deck || sel) return;
    const a = deck.businesses.flatMap((b) => b.agents).find((x) => x.question?.id === q);
    if (a) setSel(a.id);
  }, [deck, sel]);

  // Positions: wings around the core, agents fanned out from their wing's hub.
  const layout = useMemo(() => {
    const pos = new Map<number, { x: number; y: number }>();
    const hubs: { id: number; name: string; x: number; y: number; ax: number; ay: number }[] = [];
    const bs = deck?.businesses ?? [];
    bs.forEach((b, i) => {
      const ang = -Math.PI / 2 + (i * 2 * Math.PI) / Math.max(bs.length, 1);
      const hx = CX + Math.cos(ang) * 330;
      const hy = CY + Math.sin(ang) * 190;
      hubs.push({ id: b.id, name: short(b.name), x: hx, y: hy, ax: Math.cos(ang), ay: Math.sin(ang) });
      const k = b.agents.length;
      const spread = k > 1 ? Math.min(0.7, 2.7 / (k - 1)) : 0;
      b.agents.forEach((a, j) => {
        const t = ang + (j - (k - 1) / 2) * spread;
        pos.set(a.id, { x: Math.min(W - 70, Math.max(70, hx + Math.cos(t) * 165)), y: Math.min(H - 55, Math.max(45, hy + Math.sin(t) * 150)) });
      });
    });
    return { pos, hubs };
  }, [deck]);

  const agents = deck?.businesses.flatMap((b) => b.agents.map((a) => ({ ...a, businessId: b.id, business: b.name }))) ?? [];
  const selected = agents.find((a) => a.id === sel) ?? null;
  const anyWorking = agents.some((a) => a.state === "working");
  const live = new Set(deck?.handoffs.filter((h) => h.status === "queued" || h.status === "running").map((h) => `${h.from}-${h.to}`) ?? []);
  const recent = new Set(deck?.handoffs.map((h) => `${h.from}-${h.to}`) ?? []);

  const post = async (body: Record<string, unknown>) => {
    const res = await fetch("/api/deck", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setMsg(d.error ?? "Something went wrong.");
    load();
    return res.ok;
  };

  const toggleRoute = (from: AgentView, to: number) => {
    const next = from.handoffTo.includes(to) ? from.handoffTo.filter((x) => x !== to) : [...from.handoffTo, to];
    post({ action: "routes", agentId: from.id, to: next });
  };

  return (
    <div className="mx-auto max-w-[1400px] p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold tracking-wide">Command Deck</h1>
        <div className="ml-auto flex flex-wrap gap-3 text-xs text-muted">
          {(["working", "queued", "question", "idle"] as State[]).map((s) => (
            <span key={s} className="flex items-center gap-1">
              <span className="inline-block h-2.5 w-2.5 rounded-full border" style={{ background: STATE[s].fill, borderColor: STATE[s].ring }} />
              {STATE[s].label}
            </span>
          ))}
          <span className="flex items-center gap-1">
            <span className="inline-block h-0.5 w-5 bg-accent" /> handoff
          </span>
        </div>
      </header>

      {night && (
        <div className="mb-3 rounded-2xl border border-line bg-panel p-3 text-sm">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <span className="font-semibold">🌙 Night Shift</span>
            <span className="text-xs text-muted">
              11 pm–6 am{night.active ? ` · running, $${night.budgetLeft.toFixed(2)} left` : ""} · {night.queued.length} queued for tonight
            </span>
            <label className="ml-auto flex items-center gap-1 text-xs text-muted">
              Budget $
              <input
                defaultValue={night.budget}
                key={night.budget}
                inputMode="decimal"
                onBlur={(e) => {
                  const v = Number(e.target.value);
                  if (v > 0 && v !== night.budget) nightPost({ budget: v });
                }}
                className="w-14 rounded-md border border-line bg-panel-2 px-1 py-0.5 text-ink"
              />
              a night
            </label>
            <button onClick={() => nightPost({ on: !night.on })} className={`rounded-md px-2 py-1 text-xs font-semibold ${night.on ? "bg-accent text-bg" : "border border-line text-muted"}`}>
              {night.on ? "On" : "Off"}
            </button>
          </div>
          {night.queued.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs">
              {night.queued.map((q) => (
                <li key={q.id} className="flex gap-2">
                  <span className="text-accent">{q.agent}</span>
                  <span className="min-w-0 flex-1 truncate text-muted">{q.instructions}</span>
                  <button onClick={() => nightPost({ action: "remove", taskId: q.id })} className="text-muted hover:text-danger">
                    remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          {night.last && (
            <details className="mt-2 text-xs">
              <summary className="cursor-pointer text-accent">Last morning report · {new Date(night.last.at).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })}</summary>
              <p className="mt-1 whitespace-pre-wrap text-muted">{night.last.text}</p>
            </details>
          )}
        </div>
      )}

      {deck && deck.questions.length > 0 && (
        <div className="mb-3 rounded-2xl border border-warn/40 bg-warn/5 p-3 text-sm">
          {deck.questions.map((q) => (
            <div key={q.id} className="flex flex-wrap items-center gap-2 py-1">
              <span className="text-warn">{q.agent} asks:</span>
              <span className="min-w-0 flex-1">{q.question}</span>
              {q.options.map((o) => (
                <button key={o} onClick={() => post({ action: "answer", questionId: q.id, answer: o })} className="rounded-md border border-accent px-2 py-1 text-xs text-accent hover:bg-accent hover:text-bg">
                  {o}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="relative overflow-hidden rounded-2xl border border-line bg-[radial-gradient(ellipse_at_center,rgba(76,201,240,0.10),transparent_65%)]">
          <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label="Map of Jarvis's crews">
            <defs>
              <marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
                <path d="M0,0 L10,5 L0,10 z" fill="var(--color-accent)" opacity="0.7" />
              </marker>
              <radialGradient id="coreGlow">
                <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.55" />
                <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
              </radialGradient>
            </defs>

            {/* grid */}
            {Array.from({ length: 11 }, (_, i) => (
              <circle key={i} cx={CX} cy={CY} r={60 + i * 50} fill="none" stroke="var(--color-accent)" strokeOpacity={0.04} />
            ))}

            {/* core */}
            <circle cx={CX} cy={CY} r={70} fill="url(#coreGlow)" />
            <g className={anyWorking ? "deck-spin-fast" : "deck-spin"} style={{ transformOrigin: `${CX}px ${CY}px` }}>
              <circle cx={CX} cy={CY} r={34} fill="none" stroke="var(--color-accent)" strokeWidth={3} strokeDasharray="22 14" opacity={0.8} />
            </g>
            <g className="deck-spin-rev" style={{ transformOrigin: `${CX}px ${CY}px` }}>
              <circle cx={CX} cy={CY} r={48} fill="none" stroke="var(--color-accent)" strokeWidth={1.5} strokeDasharray="40 30" opacity={0.5} />
            </g>
            <circle cx={CX} cy={CY} r={12} fill="var(--color-accent)" opacity={0.9} />
            <text x={CX} y={CY + 72} textAnchor="middle" className="fill-accent text-[13px] tracking-[0.3em]">
              {idn.assistant.toUpperCase()}
            </text>

            {/* spokes: core → wings */}
            {layout.hubs.map((h) => (
              <line key={`s${h.id}`} x1={CX + h.ax * 75} y1={CY + h.ay * 60} x2={h.x - h.ax * 24} y2={h.y - h.ay * 20} stroke="var(--color-accent)" strokeOpacity={0.18} strokeDasharray="3 6" />
            ))}

            {/* routes + handoff beams */}
            {agents.flatMap((a) =>
              a.handoffTo.map((to) => {
                const p = layout.pos.get(a.id);
                const q = layout.pos.get(to);
                if (!p || !q) return null;
                const dx = q.x - p.x;
                const dy = q.y - p.y;
                const len = Math.hypot(dx, dy) || 1;
                const x1 = p.x + (dx / len) * 26;
                const y1 = p.y + (dy / len) * 26;
                const x2 = q.x - (dx / len) * 30;
                const y2 = q.y - (dy / len) * 30;
                const key = `${a.id}-${to}`;
                const path = `M${x1},${y1} L${x2},${y2}`;
                return (
                  <g key={key}>
                    <path d={path} stroke="var(--color-accent)" strokeOpacity={live.has(key) ? 0.9 : recent.has(key) ? 0.5 : 0.22} strokeWidth={live.has(key) ? 2.5 : 1.5} strokeDasharray={live.has(key) ? undefined : "5 5"} fill="none" markerEnd="url(#arrow)" />
                    {(live.has(key) || recent.has(key)) && (
                      <circle r={5} fill="var(--color-accent)">
                        <animateMotion dur="1.6s" repeatCount="indefinite" path={path} />
                      </circle>
                    )}
                  </g>
                );
              }),
            )}

            {/* wing hubs */}
            {layout.hubs.map((h) => (
              <g key={`h${h.id}`}>
                <circle cx={h.x} cy={h.y} r={20} fill="var(--color-bg)" stroke="var(--color-accent)" strokeOpacity={0.5} />
                <circle cx={h.x} cy={h.y} r={5} fill="var(--color-accent)" opacity={0.6} />
                <text x={h.x - h.ax * 50} y={h.y - h.ay * 42 + 5} textAnchor="middle" className="fill-muted text-[13px] font-semibold uppercase tracking-[0.15em]">
                  {h.name}
                </text>
              </g>
            ))}

            {/* agents */}
            {agents.map((a) => {
              const p = layout.pos.get(a.id);
              if (!p) return null;
              const s = STATE[a.state];
              const isSel = a.id === sel;
              const badge = a.queued + a.approvals + (a.question ? 1 : 0);
              return (
                <g key={a.id} onClick={() => setSel(a.id)} className="cursor-pointer" role="button" aria-label={`${a.name}: ${s.label}`}>
                  {a.state === "working" && <circle cx={p.x} cy={p.y} r={22} fill="none" stroke="var(--color-accent)" className="deck-pulse" style={{ transformOrigin: `${p.x}px ${p.y}px` }} />}
                  {(a.state === "question" || a.state === "approval") && (
                    <circle cx={p.x} cy={p.y} r={22} fill="none" stroke="var(--color-warn)" className="deck-pulse" style={{ transformOrigin: `${p.x}px ${p.y}px` }} />
                  )}
                  <circle cx={p.x} cy={p.y} r={isSel ? 24 : 21} fill={s.fill} fillOpacity={a.state === "idle" ? 1 : 0.85} stroke={isSel ? "var(--color-ink)" : s.ring} strokeWidth={isSel ? 2.5 : 1.5} strokeDasharray={a.state === "paused" || a.state === "draft" ? "4 3" : undefined} />
                  <text x={p.x} y={p.y + 5} textAnchor="middle" className={`text-[13px] font-bold ${a.state === "idle" || a.state === "paused" || a.state === "draft" ? "fill-muted" : "fill-[var(--color-bg)]"}`}>
                    {a.name
                      .split(" ")
                      .map((w) => w[0])
                      .join("")
                      .slice(0, 2)}
                  </text>
                  {badge > 0 && (
                    <g>
                      <circle cx={p.x + 17} cy={p.y - 17} r={9} fill="var(--color-warn)" />
                      <text x={p.x + 17} y={p.y - 13} textAnchor="middle" className="fill-[var(--color-bg)] text-[11px] font-bold">
                        {badge}
                      </text>
                    </g>
                  )}
                  <text x={p.x} y={p.y + 40} textAnchor="middle" className={`text-[12px] ${isSel ? "fill-ink" : "fill-muted"}`}>
                    {a.name}
                  </text>
                </g>
              );
            })}
          </svg>
          {!deck && <p className="absolute inset-0 flex items-center justify-center text-sm text-muted">Bringing the deck online…</p>}
          {deck && agents.length === 0 && (
            <p className="absolute inset-x-0 bottom-4 text-center text-sm text-muted">No crews yet. Set up your businesses on the Command Center first.</p>
          )}
        </div>

        {/* Phones: the map is small, so the crews are also listed for easy tapping. */}
        <div className="space-y-3 sm:hidden">
          {deck?.businesses.map((b) => (
            <div key={b.id}>
              <p className="mb-1 text-xs font-semibold uppercase tracking-wider text-muted">{short(b.name)}</p>
              <ul className="divide-y divide-line rounded-xl border border-line bg-panel">
                {b.agents.map((a) => (
                  <li key={a.id}>
                    <button onClick={() => setSel(a.id)} className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm ${a.id === sel ? "bg-panel-2" : ""}`}>
                      <span className="h-2.5 w-2.5 shrink-0 rounded-full border" style={{ background: STATE[a.state].fill, borderColor: STATE[a.state].ring }} />
                      <span className="font-medium">{a.name}</span>
                      <span className="min-w-0 flex-1 truncate text-xs text-muted">{a.question ? "has a question" : (a.doing ?? STATE[a.state].label)}</span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        <aside className="rounded-2xl border border-line bg-panel p-4 text-sm">
          {!selected ? (
            <div className="space-y-2 text-muted">
              <p className="text-ink">Tap an agent to see what it&apos;s doing.</p>
              <p>
                Lines show who can hand work to whom. A light moving along a line is a handoff happening now. Amber means something is waiting on you: a
                question (answer it with one tap) or an approval.
              </p>
              <p>Anything that sends, spends or posts still comes to you first.</p>
            </div>
          ) : (
            <div className="space-y-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-lg font-semibold">{selected.name}</h2>
                  <span className="rounded-full px-2 py-0.5 text-xs" style={{ background: STATE[selected.state].fill, color: selected.state === "idle" || selected.state === "paused" || selected.state === "draft" ? "var(--color-muted)" : "var(--color-bg)" }}>
                    {STATE[selected.state].label}
                  </span>
                </div>
                <p className="text-xs text-muted">{selected.business}</p>
              </div>

              {selected.question && (
                <div className="rounded-lg border border-warn/40 bg-warn/5 p-2">
                  <p className="text-xs text-warn">Asks you:</p>
                  <p>{selected.question.question}</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {selected.question.options.map((o) => (
                      <button key={o} onClick={() => post({ action: "answer", questionId: selected.question!.id, answer: o })} className="rounded-md border border-accent px-2 py-1 text-xs text-accent hover:bg-accent hover:text-bg">
                        {o}
                      </button>
                    ))}
                    <button
                      onClick={() => {
                        const t = prompt(selected.question!.question);
                        if (t?.trim()) post({ action: "answer", questionId: selected.question!.id, answer: t });
                      }}
                      className="px-2 py-1 text-xs text-muted hover:text-ink"
                    >
                      Other…
                    </button>
                  </div>
                </div>
              )}

              {selected.doing && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted">{selected.state === "working" ? "Working on" : "Next up"}</p>
                  <p>{selected.doing}</p>
                  {selected.queued > 1 && <p className="text-xs text-muted">+{selected.queued - 1} more queued</p>}
                </div>
              )}
              {selected.approvals > 0 && (
                <p className="text-warn">
                  {selected.approvals} approval{selected.approvals === 1 ? "" : "s"} waiting on the{" "}
                  <Link href="/" className="underline">
                    Command Center
                  </Link>
                </p>
              )}

              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-lg bg-panel-2 p-2">
                  <div className="font-mono text-lg">{selected.doneWeek}</div>
                  <div className="text-[11px] text-muted">done this week</div>
                </div>
                <div className="rounded-lg bg-panel-2 p-2">
                  <div className="font-mono text-lg">${selected.costWeek.toFixed(2)}</div>
                  <div className="text-[11px] text-muted">AI cost this week</div>
                </div>
              </div>

              {selected.last && (
                <div>
                  <p className="text-xs uppercase tracking-wider text-muted">Last result</p>
                  <p className="line-clamp-4">{selected.last.summary}</p>
                </div>
              )}

              <div>
                <p className="text-xs uppercase tracking-wider text-muted">Job</p>
                <p className="line-clamp-4 text-muted">{selected.job}</p>
              </div>

              <div>
                <p className="mb-1 text-xs uppercase tracking-wider text-muted">Can hand work to</p>
                {agents.filter((x) => x.businessId === selected.businessId && x.id !== selected.id).length === 0 ? (
                  <p className="text-muted">No teammates in this crew.</p>
                ) : (
                  <div className="flex flex-wrap gap-2">
                    {agents
                      .filter((x) => x.businessId === selected.businessId && x.id !== selected.id)
                      .map((x) => {
                        const on = selected.handoffTo.includes(x.id);
                        return (
                          <button
                            key={x.id}
                            onClick={() => toggleRoute(selected, x.id)}
                            className={`rounded-full border px-2 py-1 text-xs ${on ? "border-accent bg-accent/15 text-accent" : "border-line text-muted hover:text-ink"}`}
                          >
                            {on ? "→ " : "+ "}
                            {x.name}
                          </button>
                        );
                      })}
                  </div>
                )}
              </div>

              <div>
                <p className="mb-1 text-xs uppercase tracking-wider text-muted">Give {selected.name} a task</p>
                <textarea value={taskText} onChange={(e) => setTaskText(e.target.value)} rows={2} placeholder="e.g. Find 10 roofers in Orange Park with weak Maps profiles" className="w-full rounded-lg border border-line bg-panel-2 p-2" />
                <div className="mt-1 flex flex-wrap items-center gap-3">
                  <button
                    disabled={!taskText.trim() || selected.status !== "active"}
                    onClick={async () => {
                      if (tonight) {
                        await nightPost({ action: "add", agentId: selected.id, instructions: taskText });
                        setTaskText("");
                        setMsg(`Queued for ${selected.name} tonight. You'll get the morning report.`);
                      } else if (await post({ action: "task", agentId: selected.id, instructions: taskText })) {
                        setTaskText("");
                        setMsg(`${selected.name} has it.`);
                      }
                    }}
                    className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg disabled:opacity-40"
                  >
                    {selected.status !== "active" ? "Approve this crew first" : tonight ? "Queue for tonight" : "Send now"}
                  </button>
                  <label className="flex items-center gap-1 text-xs text-muted">
                    <input type="checkbox" checked={tonight} onChange={(e) => setTonight(e.target.checked)} />
                    🌙 Do it tonight (Night Shift)
                  </label>
                </div>
              </div>
              {msg && <p className="text-xs text-accent">{msg}</p>}
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}
