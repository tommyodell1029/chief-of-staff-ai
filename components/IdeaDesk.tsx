"use client";
// "Can you run this?": the owner describes a business, the assistant researches it and gives an honest verdict.
// A yes or partly can be turned into a business with a draft crew in one press.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/lib/client/identity";

interface Verdict {
  name: string;
  verdict: "yes" | "partly" | "no";
  headline: string;
  summary: string;
  assistantDoes: string[];
  ownerDoes: string[];
  cantDo: string[];
  startupCost: string;
  timePerWeek: string;
  competition: string;
  risks: string[];
  firstSteps: string[];
}
interface Idea {
  id: number;
  idea: string;
  status: "researching" | "done" | "failed" | "adopted" | "dismissed";
  result?: Verdict;
  error?: string;
  createdAt: number;
}

const BADGE = {
  yes: { text: "Yes, I can run this", cls: "bg-accent text-bg" },
  partly: { text: "Partly", cls: "bg-warn text-bg" },
  no: { text: "No, not this way", cls: "bg-panel-2 text-muted" },
};

function List({ title, items }: { title: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div className="mt-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">{title}</p>
      <ul className="mt-1 list-disc space-y-0.5 pl-5 text-sm">
        {items.map((t, i) => (
          <li key={i}>{t}</li>
        ))}
      </ul>
    </div>
  );
}

export default function IdeaDesk() {
  const idn = useIdentity();
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/ideas")
      .then((r) => r.json())
      .then((d) => setIdeas(d.ideas ?? []))
      .catch(() => {});
  }, []);
  const researching = ideas.some((i) => i.status === "researching");
  useEffect(() => {
    load();
    const t = setInterval(load, researching ? 5_000 : 30_000);
    return () => clearInterval(t);
  }, [load, researching]);

  const post = async (body: object) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/ideas", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    if (d.message || d.error) setMsg({ ok: res.ok, text: d.message ?? d.error });
    load();
    return res.ok;
  };

  return (
    <div className="mx-auto max-w-2xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Home
        </Link>
        <h1 className="text-xl font-semibold">Can you run this?</h1>
      </header>

      <div className="mb-4 rounded-2xl border border-line bg-panel p-4">
        <p className="text-sm text-muted">
          Tell {idn.assistant} what business you want to run. {idn.assistant} researches it (demand, competition, costs, rules) and tells you honestly
          whether its crews can run it, and what you&apos;d still have to do yourself. You can also just say it out loud.
        </p>
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={3}
          placeholder="e.g. Custom pet portrait mugs on Etsy, or getting website clients from local roofers"
          className="mt-3 w-full rounded-lg border border-line bg-panel-2 p-2 text-sm"
        />
        <button
          onClick={async () => {
            if (await post({ action: "vet", idea: text })) setText("");
          }}
          disabled={busy || text.trim().length < 8}
          className="mt-2 rounded-lg bg-accent px-4 py-2 text-sm font-semibold text-bg disabled:opacity-40"
        >
          Research it
        </button>
      </div>
      {msg && <p className={`mb-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-accent/10 text-accent" : "bg-warn/10 text-warn"}`}>{msg.text}</p>}

      <div className="space-y-3">
        {ideas.map((i) => (
          <div key={i.id} className="rounded-2xl border border-line bg-panel p-4">
            <p className="text-xs text-muted">&ldquo;{i.idea}&rdquo;</p>
            {i.status === "researching" && <p className="mt-2 animate-pulse text-sm text-accent">Researching… this takes a minute or two.</p>}
            {i.status === "failed" && <p className="mt-2 text-sm text-warn">{i.error}</p>}
            {i.result && (
              <>
                <div className="mt-2 flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-bold ${BADGE[i.result.verdict].cls}`}>{BADGE[i.result.verdict].text}</span>
                  <h2 className="font-semibold">{i.result.name}</h2>
                  {i.status === "adopted" && <span className="text-xs text-accent">✓ Set up</span>}
                </div>
                <p className="mt-2 text-sm">{i.result.headline}</p>
                <p className="mt-2 text-sm text-muted">{i.result.competition}</p>
                <div className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-panel-2 p-2">
                    <p className="text-xs text-muted">To start</p>
                    {i.result.startupCost}
                  </div>
                  <div className="rounded-lg bg-panel-2 p-2">
                    <p className="text-xs text-muted">Your time</p>
                    {i.result.timePerWeek}
                  </div>
                </div>
                <List title={`${idn.assistant} would do`} items={i.result.assistantDoes} />
                <List title="You would do" items={i.result.ownerDoes} />
                <List title="Can't be done by the assistant" items={i.result.cantDo} />
                <List title="Risks" items={i.result.risks} />
                <List title="First steps" items={i.result.firstSteps} />
                <p className="mt-3 text-xs text-muted">No income estimates: results depend on you, the market and time.</p>
                {i.status === "done" && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {i.result.verdict !== "no" && (
                      <button onClick={() => post({ action: "adopt", id: i.id })} disabled={busy} className="rounded-lg bg-accent px-3 py-1.5 text-sm font-semibold text-bg">
                        Run it: build the crew
                      </button>
                    )}
                    <button onClick={() => post({ action: "dismiss", id: i.id })} disabled={busy} className="rounded-lg border border-line px-3 py-1.5 text-sm text-muted hover:text-ink">
                      Not this one
                    </button>
                  </div>
                )}
                {i.status === "adopted" && (
                  <Link href={idn.kit ? "/launch" : "/businesses"} className="mt-3 inline-block text-sm text-accent underline">
                    {idn.kit ? "Go to Launch →" : "See the crew →"}
                  </Link>
                )}
              </>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
