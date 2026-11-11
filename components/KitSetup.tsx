"use client";
// First-run setup on a client's assistant: import the setup file from the kickoff call. That names the assistant,
// sets how it addresses the owner, and builds a crew for each business (all waiting for Launch).
import Link from "next/link";
import { useEffect, useState } from "react";

interface Profile {
  owner: { name: string; address: string };
  assistant: { name: string; personality: string };
  businesses: { name: string; summary: string; modules: string[] }[];
  outreach?: { business: string; target: string; offer: string };
}

export default function KitSetup() {
  const [state, setState] = useState<{ kit: boolean; profile: Profile | null } | null>(null);
  const [text, setText] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [me, setMe] = useState({ name: "", address: "", assistant: "Jarvis", city: "", about: "" });

  const start = async () => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/kit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "start",
        owner: { name: me.name.trim(), address: me.address.trim() || me.name.trim(), city: me.city.trim() || undefined, about: me.about.trim() || undefined },
        assistant: { name: me.assistant.trim() || "Jarvis" },
      }),
    });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg({ ok: res.ok, text: d.message ?? d.error ?? "Something went wrong." });
    if (res.ok) load();
  };

  const load = () =>
    fetch("/api/kit")
      .then((r) => r.json())
      .then((d) => setState({ kit: !!d.kit, profile: d.profile ?? null }))
      .catch(() => setState({ kit: false, profile: null }));
  useEffect(() => {
    load();
  }, []);

  const importIt = async (raw: string) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/kit", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "import", profile: raw }) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg({ ok: res.ok, text: d.message ?? d.error ?? "Something went wrong." });
    if (res.ok) load();
  };

  if (state && !state.kit) {
    return (
      <div className="mx-auto max-w-xl p-6 text-sm text-muted">
        Setup is for client assistants (Chief of Staff AI, <code>KIT_MODE=1</code>).{" "}
        <Link href="/" className="text-accent underline">
          Back
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Home
        </Link>
        <h1 className="text-xl font-semibold">Setup</h1>
      </header>

      {state?.profile && (
        <div className="mb-4 rounded-2xl border border-accent/40 bg-accent/5 p-3 text-sm">
          <p>
            <b>{state.profile.assistant.name}</b> is set up for {state.profile.owner.name}.
          </p>
          <ul className="mt-2 space-y-1">
            {state.profile.businesses.map((b) => (
              <li key={b.name}>
                {b.name} <span className="text-xs text-muted">· {b.modules.join(", ")}</span>
              </li>
            ))}
          </ul>
          {state.profile.businesses.length === 0 && <p className="mt-2 text-muted">No businesses yet. Tell {state.profile.assistant.name} what you want to run.</p>}
          <div className="mt-3 flex flex-wrap gap-2">
            <Link href="/ideas" className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg">
              {state.profile.businesses.length ? "Add a business" : "What do you want to run? →"}
            </Link>
            {state.profile.businesses.length > 0 && (
              <Link href="/launch" className="rounded-lg border border-line px-3 py-1.5 text-muted hover:text-ink">
                Go to Launch →
              </Link>
            )}
          </div>
        </div>
      )}

      {!state?.profile && (
        <div className="mb-4 rounded-2xl border border-line bg-panel p-4 text-sm">
          <p className="font-semibold">Start here</p>
          <p className="mb-3 text-muted">Name your assistant, then tell it what business you want to run. It researches it and tells you honestly if it can run it.</p>
          {(
            [
              ["name", "Your first name", "Mike"],
              ["address", "What it should call you", "sir, ma'am, or your name"],
              ["assistant", "Your assistant's name", "Jarvis, Friday, Max…"],
              ["city", "Your city (optional)", "Tampa, FL"],
              ["about", "Your schedule (optional)", "I work 9–5 and have about 10 hours a week"],
            ] as const
          ).map(([k, label, ph]) => (
            <label key={k} className="mb-2 block">
              <span className="text-xs text-muted">{label}</span>
              <input value={me[k]} placeholder={ph} onChange={(e) => setMe({ ...me, [k]: e.target.value })} className="mt-0.5 w-full rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
            </label>
          ))}
          <button onClick={start} disabled={busy || !me.name.trim()} className="mt-1 rounded-lg bg-accent px-4 py-2 font-semibold text-bg disabled:opacity-40">
            Start
          </button>
        </div>
      )}

      <p className="mb-2 text-sm text-muted">
        {state?.profile ? "Import an updated setup file (existing businesses are kept; new ones are added)." : "Had a kickoff call? Import the setup file instead. It names your assistant and builds a crew for each of your businesses. Nothing runs until you press Launch."}
      </p>
      <label className="mb-2 block rounded-2xl border border-dashed border-line p-4 text-center text-sm text-muted hover:border-accent">
        Choose the setup file (.json)
        <input
          type="file"
          accept="application/json,.json"
          className="hidden"
          onChange={async (e) => {
            const f = e.target.files?.[0];
            if (f) importIt(await f.text());
          }}
        />
      </label>
      <details className="text-sm">
        <summary className="cursor-pointer text-accent">Or paste it</summary>
        <textarea value={text} onChange={(e) => setText(e.target.value)} rows={8} className="mt-2 w-full rounded-lg border border-line bg-panel-2 p-2 font-mono text-xs" />
        <button onClick={() => importIt(text)} disabled={busy || !text.trim()} className="mt-1 rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg disabled:opacity-40">
          Import
        </button>
      </details>
      {busy && <p className="mt-2 text-sm text-muted">Setting things up…</p>}
      {msg && <p className={`mt-2 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-accent/10 text-accent" : "bg-warn/10 text-warn"}`}>{msg.text}</p>}
    </div>
  );
}
