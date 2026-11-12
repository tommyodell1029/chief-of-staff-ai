"use client";
// Crew templates: upload the Crew Template Pack file once, then start a business from any template in one step.
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useIdentity } from "@/lib/client/identity";

interface Template {
  id: string;
  name: string;
  category: string;
  summary: string;
  goodFor: string;
  ownerDoes: string[];
  startupCost: string;
  needsArea: boolean;
  offerLabel?: string;
  agents: { name: string }[];
  firstSteps: string[];
}
interface Pack {
  title: string;
  templates: Template[];
}

const plain = (s: string) => s.replaceAll("{business}", "Your business").replaceAll("{area}", "your area").replaceAll("{offer}", "your offer");

export default function TemplatePack() {
  const idn = useIdentity();
  const [pack, setPack] = useState<Pack | null | undefined>(undefined);
  const [open, setOpen] = useState<string | null>(null);
  const [form, setForm] = useState({ name: "", area: "", offer: "" });
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch("/api/templates")
      .then((r) => r.json())
      .then((d) => setPack(d.pack ?? null))
      .catch(() => setPack(null));
  }, []);
  useEffect(() => load(), [load]);

  const post = async (body: object) => {
    setBusy(true);
    setMsg(null);
    const res = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await res.json().catch(() => ({}));
    setBusy(false);
    setMsg({ ok: res.ok, text: d.message ?? d.error ?? "Something went wrong." });
    load();
    return res.ok;
  };

  const categories = [...new Set(pack?.templates.map((t) => t.category) ?? [])];

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Home
        </Link>
        <h1 className="text-xl font-semibold">Crew templates</h1>
        <Link href="/ideas" className="ml-auto text-sm text-accent underline">
          Or describe your own idea →
        </Link>
      </header>

      {pack === null && (
        <div className="rounded-2xl border border-line bg-panel p-4 text-sm">
          <p className="font-semibold">Add the Crew Template Pack</p>
          <p className="mt-1 text-muted">
            Upload the pack file from your purchase (crew-template-pack.json) to start a business from a ready-made crew. No pack? Describe your idea on{" "}
            <Link href="/ideas" className="text-accent underline">
              Can you run this?
            </Link>{" "}
            and {idn.assistant} builds a crew for it.
          </p>
          <label className="mt-3 block rounded-2xl border border-dashed border-line p-4 text-center text-muted hover:border-accent">
            Choose the pack file (.json)
            <input
              type="file"
              accept="application/json,.json"
              className="hidden"
              onChange={async (e) => {
                const f = e.target.files?.[0];
                if (f) post({ action: "import", pack: await f.text() });
              }}
            />
          </label>
        </div>
      )}
      {msg && <p className={`my-3 rounded-lg px-3 py-2 text-sm ${msg.ok ? "bg-accent/10 text-accent" : "bg-warn/10 text-warn"}`}>{msg.text}</p>}

      {pack && (
        <>
          <p className="mb-3 text-sm text-muted">Pick a business type. {idn.assistant} builds its crew as drafts: nothing runs until you press Launch, and anything that sends, spends or posts waits for you.</p>
          {categories.map((c) => (
            <div key={c} className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">{c}</p>
              <ul className="space-y-2">
                {pack.templates
                  .filter((t) => t.category === c)
                  .map((t) => (
                    <li key={t.id} className="rounded-2xl border border-line bg-panel p-3 text-sm">
                      <button onClick={() => setOpen(open === t.id ? null : t.id)} className="w-full text-left">
                        <span className="font-medium">{t.name}</span>
                        <span className="block text-xs text-muted">{t.goodFor}</span>
                      </button>
                      {open === t.id && (
                        <div className="mt-3 space-y-3">
                          <p className="text-muted">{plain(t.summary)}</p>
                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                            <div className="rounded-lg bg-panel-2 p-2">
                              <p className="text-xs text-muted">The crew</p>
                              {t.agents.map((a) => a.name).join(", ")}
                            </div>
                            <div className="rounded-lg bg-panel-2 p-2">
                              <p className="text-xs text-muted">To start</p>
                              {t.startupCost}
                            </div>
                          </div>
                          <div>
                            <p className="text-xs font-semibold uppercase tracking-wide text-muted">You&apos;d do</p>
                            <ul className="mt-1 list-disc pl-5">
                              {t.ownerDoes.map((x) => (
                                <li key={x}>{x}</li>
                              ))}
                            </ul>
                          </div>
                          <div className="space-y-2 rounded-xl border border-line p-3">
                            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Business name" className="w-full rounded-lg border border-line bg-panel-2 px-2 py-1.5" />
                            {t.needsArea && <input value={form.area} onChange={(e) => setForm({ ...form, area: e.target.value })} placeholder="City or area (e.g. Tampa, FL)" className="w-full rounded-lg border border-line bg-panel-2 px-2 py-1.5" />}
                            {t.offerLabel && <input value={form.offer} onChange={(e) => setForm({ ...form, offer: e.target.value })} placeholder={t.offerLabel} className="w-full rounded-lg border border-line bg-panel-2 px-2 py-1.5" />}
                            <button
                              disabled={busy || form.name.trim().length < 2 || (t.needsArea && !form.area.trim())}
                              onClick={async () => {
                                if (await post({ action: "use", id: t.id, ...form })) setForm({ name: "", area: "", offer: "" });
                              }}
                              className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg disabled:opacity-40"
                            >
                              Use this template
                            </button>
                          </div>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
            </div>
          ))}
          {idn.kit && (
            <Link href="/launch" className="text-sm text-accent underline">
              Go to Launch →
            </Link>
          )}
        </>
      )}
    </div>
  );
}
