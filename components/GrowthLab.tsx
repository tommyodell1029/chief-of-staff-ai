"use client";
// Growth Lab: this week's ranked shortlist (Approve / Pass), approved "business in a box" packages, and research notes.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import Markdown from "./Markdown";

interface Opp {
  id: number;
  kind: "new" | "addon";
  businessId: number | null;
  title: string;
  summary: string;
  scores: string;
  score: number;
  evidence: string;
  sources: string | null;
  confidence: string;
  bestCase: string | null;
  worstCase: string | null;
  status: string;
  weekOf: string;
  packageMd: string | null;
}
interface Note {
  id: number;
  area: string;
  title: string;
  body: string;
  sources: string | null;
  createdAt: string;
}

const parse = <T,>(s: string | null, fallback: T): T => {
  try {
    return s ? (JSON.parse(s) as T) : fallback;
  } catch {
    return fallback;
  }
};

export default function GrowthLab() {
  const [opps, setOpps] = useState<Opp[] | null>(null);
  const [notes, setNotes] = useState<Note[]>([]);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [areas, setAreas] = useState<string[]>([]);
  const [area, setArea] = useState("");
  const [flash, setFlash] = useState<string | null>(null);
  const [tab, setTab] = useState<"shortlist" | "approved" | "notes">("shortlist");

  const load = useCallback(() => {
    fetch("/api/lab")
      .then((r) => r.json())
      .then((d) => {
        setOpps(d.opportunities);
        setNotes(d.notes);
        setLabels(d.scoreLabels);
        setAreas(d.areas);
      });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 20_000); // pick up results of background runs
    return () => clearInterval(t);
  }, [load]);

  const run = async (action: "research" | "rank") => {
    const res = await fetch("/api/lab", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action, area: area || undefined }),
    });
    const d = await res.json();
    setFlash(
      res.ok
        ? action === "rank"
          ? "Ranking started. It takes a few minutes; you'll get a notification when the shortlist is ready."
          : "Research started. New notes appear here in a few minutes."
        : d.error,
    );
  };

  const decide = async (id: number, decision: "approve" | "pass") => {
    await fetch(`/api/opportunities/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ decision }),
    });
    if (decision === "approve") setFlash("Approved. Jarvis is building the business-in-a-box package (a few minutes).");
    load();
  };

  const proposed = opps?.filter((o) => o.status === "proposed") ?? [];
  const approved = opps?.filter((o) => o.status === "approved" || o.status === "building") ?? [];

  return (
    <div className="mx-auto max-w-4xl p-4">
      <header className="mb-4 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">Growth Lab</h1>
      </header>

      <p className="mb-3 text-sm text-muted">
        Jarvis researches one area every morning (trends, agency, POD, creators, wealth, new models) and ranks a Top 5 plus the best add-on for
        each business every Sunday. Approve an idea to get a full launch package (and a draft crew for new businesses).
      </p>

      <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-panel p-3 text-sm">
        <select
          value={area}
          onChange={(e) => setArea(e.target.value)}
          className="rounded-lg border border-line bg-panel-2 px-2 py-2"
          aria-label="Research area"
        >
          <option value="">Today&apos;s area</option>
          {areas.map((a) => (
            <option key={a} value={a}>
              {a}
            </option>
          ))}
        </select>
        <button onClick={() => run("research")} className="rounded-lg border border-accent/50 px-3 py-2 text-accent">
          Research now (~$0.15)
        </button>
        <button onClick={() => run("rank")} className="rounded-lg border border-accent/50 px-3 py-2 text-accent">
          Rank shortlist now (~$0.30)
        </button>
        {flash && <p className="w-full text-xs text-accent">{flash}</p>}
      </div>

      <div className="mb-4 flex gap-2 text-sm">
        {(
          [
            ["shortlist", `Shortlist (${proposed.length})`],
            ["approved", `Approved (${approved.length})`],
            ["notes", `Research notes (${notes.length})`],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`rounded-full border px-3 py-1 ${tab === k ? "border-accent text-accent" : "border-line text-muted"}`}
          >
            {label}
          </button>
        ))}
      </div>

      {opps === null ? (
        <p className="text-muted">Loading…</p>
      ) : tab === "shortlist" ? (
        proposed.length === 0 ? (
          <Empty text="No ideas waiting. The weekly ranking runs Sunday morning, or tap “Rank shortlist now”." />
        ) : (
          <div className="space-y-3">
            {proposed.map((o) => (
              <OppCard key={o.id} o={o} labels={labels} onDecide={decide} />
            ))}
          </div>
        )
      ) : tab === "approved" ? (
        approved.length === 0 ? (
          <Empty text="Nothing approved yet." />
        ) : (
          <div className="space-y-3">
            {approved.map((o) => (
              <details key={o.id} className="rounded-2xl border border-line bg-panel p-4">
                <summary className="cursor-pointer font-medium">
                  {o.title}{" "}
                  <span className="text-xs text-muted">
                    {o.status === "building" ? "· building package…" : o.kind === "new" ? "· new business" : "· add-on"}
                  </span>
                </summary>
                {o.packageMd ? (
                  <div className="mt-3">
                    <Markdown text={o.packageMd} />
                    {o.kind === "new" && o.businessId && (
                      <Link href={`/businesses/${o.businessId}`} className="mt-3 inline-block text-sm text-accent">
                        Review its draft crew →
                      </Link>
                    )}
                  </div>
                ) : (
                  <p className="mt-2 text-sm text-muted">Jarvis is writing the package. Check back in a few minutes.</p>
                )}
              </details>
            ))}
          </div>
        )
      ) : notes.length === 0 ? (
        <Empty text="No research yet. The first run happens at 4 am, or tap “Research now”." />
      ) : (
        <div className="space-y-2">
          {notes.map((n) => (
            <details key={n.id} className="rounded-2xl border border-line bg-panel p-3">
              <summary className="cursor-pointer">
                <span className="mr-2 rounded bg-panel-2 px-1.5 py-0.5 text-[10px] uppercase text-muted">{n.area}</span>
                {n.title}
                <span className="ml-2 text-xs text-muted">{new Date(n.createdAt).toLocaleDateString()}</span>
              </summary>
              <p className="mt-2 whitespace-pre-wrap text-sm">{n.body}</p>
              <Sources list={parse<string[]>(n.sources, [])} />
            </details>
          ))}
        </div>
      )}
    </div>
  );
}

function OppCard({ o, labels, onDecide }: { o: Opp; labels: Record<string, string>; onDecide: (id: number, d: "approve" | "pass") => void }) {
  const scores = parse<Record<string, number>>(o.scores, {});
  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <div className="flex items-start gap-3">
        <div className="flex h-12 w-12 shrink-0 flex-col items-center justify-center rounded-xl bg-accent-dim/50">
          <span className="font-mono text-lg text-accent">{o.score.toFixed(1)}</span>
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{o.title}</h2>
          <p className="text-xs text-muted">
            {o.kind === "new" ? "New opportunity" : "Add-on"} · confidence {o.confidence} · week of {o.weekOf}
          </p>
        </div>
      </div>
      <p className="mt-3 text-sm">{o.summary}</p>
      <div className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1 sm:grid-cols-4">
        {Object.entries(scores).map(([k, v]) => (
          <div key={k} className="text-[11px]">
            <div className="flex justify-between text-muted">
              <span>{labels[k] ?? k}</span>
              <span>{v}</span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-panel-2">
              <div className="h-full bg-accent" style={{ width: `${v * 10}%` }} />
            </div>
          </div>
        ))}
      </div>
      <details className="mt-3 text-sm">
        <summary className="cursor-pointer text-accent">Evidence, best and worst case</summary>
        <p className="mt-2">{o.evidence}</p>
        {o.bestCase && (
          <p className="mt-2">
            <span className="text-muted">Best case: </span>
            {o.bestCase}
          </p>
        )}
        {o.worstCase && (
          <p className="mt-1">
            <span className="text-muted">Worst case: </span>
            {o.worstCase}
          </p>
        )}
        <Sources list={parse<string[]>(o.sources, [])} />
      </details>
      <div className="mt-3 flex gap-2">
        <button onClick={() => onDecide(o.id, "approve")} className="rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg">
          Approve
        </button>
        <button onClick={() => onDecide(o.id, "pass")} className="rounded-lg border border-line px-4 py-2 text-sm text-muted">
          Pass
        </button>
      </div>
    </article>
  );
}

function Sources({ list }: { list: string[] }) {
  if (!list.length) return null;
  return (
    <ul className="mt-2 space-y-0.5 text-xs">
      {list.map((u) => (
        <li key={u} className="truncate">
          <a href={u} target="_blank" rel="noreferrer" className="text-accent/80 hover:text-accent">
            {u}
          </a>
        </li>
      ))}
    </ul>
  );
}

function Empty({ text }: { text: string }) {
  return <p className="rounded-2xl border border-dashed border-line p-6 text-center text-muted">{text}</p>;
}
