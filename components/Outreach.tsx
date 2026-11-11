"use client";
// Outreach: set up once, approve each campaign's prompt + sample emails, then watch it run.
import Link from "next/link";
import { adsTransparencyUrl } from "@/lib/adsLink";
import { useIdentity } from "@/lib/client/identity";
import { useCallback, useEffect, useState } from "react";
import Markdown from "./Markdown";

interface Stats {
  byStatus: Record<string, number>;
  sent: number;
  leads: number;
}
interface Campaign {
  id: number;
  name: string;
  brief: string;
  previewMd: string | null;
  status: string;
  dailyLimit: number;
  followUps: number;
  stopReason: string | null;
  sendVia: string; // jarvis | saleshandy
  saleshandySequenceId: string | null;
  saleshandySequenceName: string | null;
  saleshandyStepId: string | null;
  blockers?: string[];
  stats?: Stats;
}
interface Sequence {
  id: string;
  title: string;
  active: boolean;
  steps: { id: string; name: string }[];
}
interface SH {
  configured: boolean;
  sequences: Sequence[];
  credits?: { totalCredits: number; creditConsumedThisMonth: number } | null;
  error?: string;
}
// The value of a "send with" choice: "" = Jarvis from Gmail, otherwise a Saleshandy sequence.
const target = (seqs: Sequence[], sequenceId: string) => {
  const q = seqs.find((x) => x.id === sequenceId);
  return q && q.steps[0] ? { sequenceId: q.id, sequenceName: q.title, stepId: q.steps[0].id } : null;
};
interface Lead {
  id: number;
  company: string;
  domain: string;
  contactName: string | null;
  contactTitle: string | null;
  email: string | null;
  emailSource: string | null;
  emailStatus: string | null;
  status: string;
  step: number;
  notes: string | null;
}

const STATUS_LABEL: Record<string, string> = {
  new: "finding email…",
  no_email: "no decision-maker email",
  ready: "ready to email",
  in_saleshandy: "in Saleshandy",
  contacted: "emailed",
  replied: "you replied",
  interested: "🔥 interested",
  not_interested: "not interested",
  unsubscribed: "unsubscribed",
  bounced: "bounced",
  needs_review: "question: waiting on you",
  done: "no reply",
};

const DEFAULT_BRIEF = `Target: owners of independent local businesses people find with a "near me" search (any category: [CATEGORY, e.g. dentists, restaurants, gyms, salons, plumbers]) in [CITY], ideally ones sitting at #4 or lower on the Google map for their main search, or with few, old or unanswered reviews.
Offer: a free 5-point audit of their Google profile, by email: where they show up on the map, profile completeness, reviews, name/address/phone consistency, and whether AI search can find them. No call, no obligation.
Angle: most calls go to the three businesses Google shows on the map. Mention one specific, true thing from their listing (e.g. reviews not answered, missing hours, not in the top 3 for "[trade] near me").
What we sell after the audit (only mention if asked): Local Visibility $249/mo or Map Pack Pro $449/mo, month to month, no contracts, no passwords. Founding rate: first five clients lock prices for six months for an honest testimonial.
Tone: plain, friendly, local, from the owner. Short. No hype, never guarantee a ranking or promise results.
Call to action: "Want me to send you the free audit?" (they just reply yes). Website: yourbusiness.com.`;

export default function Outreach() {
  const idn = useIdentity();
  const [data, setData] = useState<{ campaigns: Campaign[]; settings: { senderName: string; businessAddress: string; bookingLink: string }; blockers: string[] } | null>(null);
  const [settings, setSettings] = useState({ senderName: "", businessAddress: "", bookingLink: "" });
  const [openId, setOpenId] = useState<number | null>(null);
  const [newOne, setNewOne] = useState({ name: "", brief: DEFAULT_BRIEF, dailyLimit: 15, sequenceId: "" });
  const [flash, setFlash] = useState<string | null>(null);
  const [sh, setSh] = useState<SH | null>(null);

  useEffect(() => {
    fetch("/api/saleshandy")
      .then((r) => r.json())
      .then((d: SH) => {
        setSh(d);
        // With Saleshandy connected, new campaigns default to filling its first sequence.
        if (d.sequences?.[0]) setNewOne((n) => (n.sequenceId ? n : { ...n, sequenceId: d.sequences[0].id }));
      })
      .catch(() => setSh({ configured: false, sequences: [] }));
  }, []);

  const load = useCallback(() => {
    fetch("/api/outreach")
      .then((r) => r.json())
      .then((d) => {
        setData(d);
        setSettings((s) => (s.senderName || s.businessAddress ? s : d.settings));
      });
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [load]);

  const call = async (url: string, method: string, body?: unknown) => {
    const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: body ? JSON.stringify(body) : undefined });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) setFlash(d.error ?? "Something went wrong.");
    return { ok: res.ok, d };
  };

  const saveSettings = async () => {
    const { ok } = await call("/api/outreach", "PUT", settings);
    if (ok) setFlash("Saved.");
    load();
  };

  const create = async () => {
    const via = target(sh?.sequences ?? [], newOne.sequenceId);
    const { ok, d } = await call("/api/outreach", "POST", { name: newOne.name, brief: newOne.brief, dailyLimit: newOne.dailyLimit, saleshandy: via });
    if (ok) {
      setFlash(
        via
          ? `Campaign drafted. Once you approve it, leads with a verified owner email go into “${via.sequenceName}” in Saleshandy.`
          : "Campaign drafted. Sample emails are being written (about a minute).",
      );
      setOpenId(d.campaign.id);
      setNewOne({ name: "", brief: DEFAULT_BRIEF, dailyLimit: 15, sequenceId: newOne.sequenceId });
      load();
    }
  };
  const gmailCampaigns = data?.campaigns.some((c) => c.sendVia === "jarvis" && c.status !== "stopped") ?? false;

  return (
    <div className="mx-auto max-w-4xl p-4">
      <header className="mb-3 flex flex-wrap items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">Outreach</h1>
        {!idn.kit && (
          <Link href="/builds" className="ml-auto rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
            Builds →
          </Link>
        )}
        <Link href="/audits" className={`${idn.kit ? "ml-auto " : ""}rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink`}>
          Walk-in audits →
        </Link>
        <Link href="/clients" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          Clients →
        </Link>
      </header>
      <p className="mb-3 text-sm text-muted">
        The Prospector finds businesses on Google Maps; Jarvis finds each owner&apos;s verified email (Saleshandy → Apollo → Hunter). You approve
        each campaign once. A <b>Saleshandy</b> campaign then drops those leads into your Saleshandy sequence, and Saleshandy sends, follows up and
        tracks replies. A <b>Gmail</b> campaign has Jarvis write and send the emails himself (weekdays 8–5, two follow-ups, plain “yes” replies
        answered, real questions sent to you as drafts). Use one or the other for the same leads, never both.
      </p>
      {sh?.error && <p className="mb-3 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">Saleshandy: {sh.error}</p>}
      {flash && <p className="mb-3 rounded-lg bg-accent-dim/30 px-3 py-2 text-sm text-accent">{flash}</p>}
      {data && gmailCampaigns && data.blockers.length > 0 && (
        <div className="mb-4 rounded-lg bg-warn/10 p-3 text-sm text-warn">
          Before Jarvis can send from Gmail:
          <ul className="ml-5 mt-1 list-disc">
            {data.blockers.map((b) => (
              <li key={b}>{b}</li>
            ))}
          </ul>
        </div>
      )}

      <details className="mb-4 rounded-2xl border border-line bg-panel p-4" open={!!data && gmailCampaigns && !data.settings.businessAddress}>
        <summary className="cursor-pointer font-semibold">Gmail sending settings (signature for emails Jarvis sends himself)</summary>
        <div className="mt-3 space-y-2 text-sm">
          <input value={settings.senderName} onChange={(e) => setSettings({ ...settings, senderName: e.target.value })} placeholder="Your name and business, e.g. Tommy, LaunchPad Local" className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2" />
          <input value={settings.businessAddress} onChange={(e) => setSettings({ ...settings, businessAddress: e.target.value })} placeholder="Business postal address (required by law; a PO box works)" className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2" />
          <input value={settings.bookingLink} onChange={(e) => setSettings({ ...settings, bookingLink: e.target.value })} placeholder="Booking link for “yes” replies (optional, e.g. a Google Calendar booking page)" className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2" />
          <button onClick={saveSettings} className="rounded-lg bg-accent px-3 py-1.5 font-semibold text-bg">
            Save
          </button>
        </div>
      </details>

      <h2 className="mb-2 text-sm font-semibold tracking-wide text-muted">CAMPAIGNS</h2>
      <div className="mb-5 space-y-3">
        {data?.campaigns.map((c) => (
          <CampaignCard key={c.id} c={c} sequences={sh?.sequences ?? []} open={openId === c.id} onToggle={() => setOpenId(openId === c.id ? null : c.id)} onChanged={load} call={call} setFlash={setFlash} />
        ))}
        {data && data.campaigns.length === 0 && (
          <p className="rounded-2xl border border-dashed border-line p-5 text-center text-sm text-muted">No campaigns yet. Start one below, or ask Jarvis.</p>
        )}
      </div>

      <details className="rounded-2xl border border-line bg-panel p-4" open={data?.campaigns.length === 0}>
        <summary className="cursor-pointer font-semibold">New campaign</summary>
        <div className="mt-3 space-y-2 text-sm">
          <input value={newOne.name} onChange={(e) => setNewOne({ ...newOne, name: e.target.value })} placeholder="Name, e.g. Free audit: Jacksonville plumbers" className="w-full rounded-lg border border-line bg-panel-2 px-3 py-2" />
          <textarea value={newOne.brief} onChange={(e) => setNewOne({ ...newOne, brief: e.target.value })} rows={10} className="w-full rounded-lg border border-line bg-panel-2 p-3 text-sm" />
          <SendWith sequences={sh?.sequences ?? []} value={newOne.sequenceId} onChange={(sequenceId) => setNewOne({ ...newOne, sequenceId })} />
          {!newOne.sequenceId && (
            <label className="flex items-center gap-2 text-xs text-muted">
              Emails per day (start low: 10–20)
              <input type="number" min={1} max={40} value={newOne.dailyLimit} onChange={(e) => setNewOne({ ...newOne, dailyLimit: Number(e.target.value) })} className="w-20 rounded-lg border border-line bg-panel-2 px-2 py-1" />
            </label>
          )}
          <button onClick={create} disabled={!newOne.name.trim()} className="rounded-lg bg-accent px-4 py-2 font-semibold text-bg disabled:opacity-40">
            {newOne.sequenceId ? "Draft campaign" : "Draft campaign + sample emails"}
          </button>
        </div>
      </details>
    </div>
  );
}

function SendWith({ sequences, value, onChange }: { sequences: Sequence[]; value: string; onChange: (sequenceId: string) => void }) {
  return (
    <label className="flex flex-wrap items-center gap-2 text-xs text-muted">
      Send with
      <select value={value} onChange={(e) => onChange(e.target.value)} className="min-w-0 max-w-full rounded-lg border border-line bg-panel-2 px-2 py-1 text-sm text-ink">
        {sequences.map((q) => (
          <option key={q.id} value={q.id} disabled={!q.steps.length}>
            Saleshandy: {q.title}
            {q.active ? "" : " (paused)"}
            {q.steps.length ? "" : " (no steps yet)"}
          </option>
        ))}
        <option value="">Jarvis, from Gmail</option>
      </select>
      {sequences.length === 0 && <span>(connect Saleshandy to fill a sequence instead)</span>}
    </label>
  );
}

function CampaignCard({
  c,
  sequences,
  open,
  onToggle,
  onChanged,
  call,
  setFlash,
}: {
  c: Campaign;
  sequences: Sequence[];
  open: boolean;
  onToggle: () => void;
  onChanged: () => void;
  call: (url: string, method: string, body?: unknown) => Promise<{ ok: boolean; d: { leads?: Lead[]; campaign?: Campaign } }>;
  setFlash: (s: string) => void;
}) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [brief, setBrief] = useState(c.brief);
  const [city, setCity] = useState("");
  const [thread, setThread] = useState<{ leadId: number; messages: { id: number; direction: string; kind: string; subject: string | null; body: string; createdAt: string }[] } | null>(null);
  const s = c.stats;

  useEffect(() => {
    if (!open) return;
    const get = () => call(`/api/outreach/${c.id}`, "GET").then(({ d }) => setLeads(d.leads ?? []));
    get();
    const t = setInterval(get, 20_000);
    return () => clearInterval(t);
  }, [open, c.id, call]);

  const act = async (action: string, extra?: object) => {
    const { ok } = await call(`/api/outreach/${c.id}`, "POST", { action, ...extra });
    if (ok && action === "approve")
      setFlash(
        c.sendVia === "saleshandy"
          ? `“${c.name}” approved. Leads with a verified owner email now go into “${c.saleshandySequenceName}” in Saleshandy.`
          : `“${c.name}” approved. It sends on weekdays 8–5, up to ${c.dailyLimit} a day.`,
      );
    if (ok && action === "find") setFlash("The Prospector is finding companies. Emails are looked up automatically as they're added.");
    if (ok && action === "preview") setFlash("New sample emails written.");
    onChanged();
  };

  const saveBrief = async () => {
    await call(`/api/outreach/${c.id}`, "PATCH", { brief });
    setFlash("Saved. A changed prompt needs your approval again; new samples are being written.");
    onChanged();
  };

  const changeVia = async (sequenceId: string) => {
    const via = target(sequences, sequenceId);
    await call(`/api/outreach/${c.id}`, "PATCH", { saleshandy: via });
    setFlash(via ? `Now fills “${via.sequenceName}”. Approve it again to start.` : "Now sends from Gmail. Approve it again to start.");
    onChanged();
  };
  const viaSaleshandy = c.sendVia === "saleshandy";

  const tone = c.status === "active" ? "bg-accent-dim/50 text-accent" : c.status === "draft" ? "bg-warn/15 text-warn" : "bg-panel-2 text-muted";
  const n = (k: string) => s?.byStatus[k] ?? 0;

  return (
    <article className="rounded-2xl border border-line bg-panel p-4">
      <button onClick={onToggle} className="flex w-full flex-wrap items-center gap-2 text-left">
        <span className="font-semibold">{c.name}</span>
        <span className={`rounded-full px-2 py-0.5 text-[10px] ${tone}`}>{c.status === "draft" ? "needs your approval" : c.status}</span>
        <span className="rounded-full bg-panel-2 px-2 py-0.5 text-[10px] text-muted">{viaSaleshandy ? `Saleshandy: ${c.saleshandySequenceName ?? "?"}` : "Gmail"}</span>
        <span className="ml-auto text-xs text-muted">
          {s
            ? viaSaleshandy
              ? `${s.leads} leads · ${n("in_saleshandy")} in Saleshandy · ${n("new")} finding email`
              : `${s.leads} leads · ${s.sent} sent · ${n("interested")} interested · ${n("needs_review")} waiting`
            : ""}
        </span>
      </button>
      {c.status !== "stopped" && (c.blockers?.length ?? 0) > 0 && <p className="mt-2 text-xs text-warn">Before it can run: {c.blockers!.join(" ")}</p>}
      {c.stopReason && <p className="mt-2 text-xs text-warn">{c.stopReason}</p>}

      {open && (
        <div className="mt-4 space-y-4 text-sm">
          <section>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-muted">{viaSaleshandy ? "WHO TO FIND (the Prospector follows this)" : "CAMPAIGN PROMPT"}</h3>
            <textarea value={brief} onChange={(e) => setBrief(e.target.value)} rows={8} className="w-full rounded-lg border border-line bg-panel-2 p-3" />
            {brief !== c.brief && (
              <button onClick={saveBrief} className="mt-1 rounded-lg border border-accent/50 px-3 py-1.5 text-accent">
                Save prompt
              </button>
            )}
          </section>

          {c.status !== "stopped" && <SendWith sequences={sequences} value={c.saleshandySequenceId ?? ""} onChange={changeVia} />}

          {viaSaleshandy ? (
            <p className="rounded-lg border border-line bg-panel-2 p-3 text-muted">
              The emails, follow-ups, sending limits and replies for this campaign live in your Saleshandy sequence “{c.saleshandySequenceName}”. Jarvis
              uses the prompt above to pick the right businesses, finds each owner&apos;s verified email, and adds them to that sequence (tagged
              “Jarvis”). Saleshandy re-checks every email and skips anyone who unsubscribed.
            </p>
          ) : (
            <section>
              <div className="mb-1 flex items-center gap-2">
                <h3 className="text-xs font-semibold tracking-wide text-muted">SAMPLE EMAILS (exactly what will be sent)</h3>
                <button onClick={() => act("preview")} className="text-xs text-accent">
                  Rewrite samples
                </button>
              </div>
              <div className="rounded-lg border border-line bg-panel-2 p-3">
                {c.previewMd ? <Markdown text={c.previewMd} /> : <p className="text-muted">Writing samples…</p>}
              </div>
            </section>
          )}

          <div className="flex flex-wrap gap-2">
            {c.status !== "active" && c.status !== "stopped" && (
              <button onClick={() => act("approve")} className="rounded-lg bg-accent px-4 py-2 font-semibold text-bg">
                {c.status === "draft" ? (viaSaleshandy ? "Approve & fill the sequence" : "Approve & start sending") : "Resume"}
              </button>
            )}
            {c.status === "active" && (
              <button onClick={() => act("pause")} className="rounded-lg border border-line px-4 py-2 text-muted">
                Pause
              </button>
            )}
            {c.status !== "stopped" && (
              <button onClick={() => confirm("Stop this campaign for good?") && act("stop")} className="rounded-lg px-3 py-2 text-muted hover:text-danger">
                Stop
              </button>
            )}
          </div>

          <section>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <h3 className="text-xs font-semibold tracking-wide text-muted">LEADS ({leads.length})</h3>
              <input value={city} onChange={(e) => setCity(e.target.value)} placeholder="City (optional)" className="w-40 rounded-lg border border-line bg-panel-2 px-2 py-1 text-xs" />
              <button onClick={() => act("find", { city, count: 15 })} className="rounded-lg border border-accent/50 px-3 py-1 text-xs text-accent">
                Find 15 more companies
              </button>
            </div>
            {leads.length === 0 ? (
              <p className="text-muted">No leads yet.</p>
            ) : (
              <ul className="divide-y divide-line rounded-lg border border-line">
                {leads.map((l) => (
                  <li key={l.id} className="p-2">
                    <button
                      onClick={async () => {
                        const r = await fetch(`/api/outreach/leads/${l.id}`).then((x) => x.json());
                        setThread(thread?.leadId === l.id ? null : { leadId: l.id, messages: r.messages });
                      }}
                      className="flex w-full flex-wrap items-baseline gap-x-3 text-left"
                    >
                      <span className="font-medium">{l.company}</span>
                      <span className="text-xs text-muted">
                        {l.contactName ? `${l.contactName}${l.contactTitle ? `, ${l.contactTitle}` : ""}` : l.domain}
                      </span>
                      {l.email && <span className="text-xs text-muted">{l.email}</span>}
                      <span className={`ml-auto text-xs ${l.status === "interested" || l.status === "needs_review" ? "text-warn" : "text-muted"}`}>
                        {STATUS_LABEL[l.status] ?? l.status}
                        {l.step > 1 ? ` (${l.step} emails)` : ""}
                      </span>
                    </button>
                    <a href={adsTransparencyUrl(l.domain)} target="_blank" rel="noreferrer" className="text-[11px] text-accent hover:underline">
                      Check their Google ads ↗
                    </a>
                    {thread?.leadId === l.id && (
                      <div className="mt-2 space-y-2">
                        {thread.messages.length === 0 && <p className="text-xs text-muted">{l.notes ?? "No emails yet."}</p>}
                        {thread.messages.map((m) => (
                          <div key={m.id} className={`rounded-lg p-2 text-xs ${m.direction === "in" ? "bg-accent-dim/30" : "bg-panel-2"}`}>
                            <p className="mb-1 text-muted">
                              {m.direction === "in" ? "They wrote" : `You (${m.kind.replace("_", " ")})`} · {new Date(m.createdAt).toLocaleString()}
                            </p>
                            <p className="whitespace-pre-wrap">{m.body}</p>
                          </div>
                        ))}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </article>
  );
}
