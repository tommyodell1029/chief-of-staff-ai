"use client";
import { useIdentity } from "@/lib/client/identity";
// Connections: what Jarvis is plugged into, and how to plug in the rest.
import Link from "next/link";
import { useEffect, useState } from "react";

type Check = { on: false } | { on: true; ok: boolean; info?: string; error?: string };
interface Status {
  googleRedirectUri: string;
  etsyRedirectUri: string;
  stripe: Check;
  gmail: { app: boolean; on: boolean; account: string | null; calendar: boolean; drive: boolean };
  gemini: { on: boolean; youtube: boolean };
  geminiImages: Check;
  instagram: Check;
  ninaVoice: { on: boolean };
  calendar: { on: boolean };
  etsy: Check & { app: boolean };
  printify: Check;
  etsyAutopublish: boolean;
  apollo: { on: boolean };
  hunter: { on: boolean };
  saleshandy: Check;
  saleshandyReplies: boolean;
  calls: Check;
  telegram: { app: boolean; on: boolean };
  brain: { label: string; problem: string | null };
  maps: { on: boolean; today: number; month: number; dailyLimit: number; monthlyLimit: number };
}

export default function Connections() {
  const idn = useIdentity();
  const [s, setS] = useState<Status | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = () =>
    fetch("/api/connections")
      .then((r) => r.json())
      .then(setS);

  useEffect(() => {
    load();
    const q = new URLSearchParams(window.location.search);
    const g = q.get("google");
    if (g) setMsg(g.startsWith("connected:") ? `Google connected: ${g.slice(10)}` : g);
    const e = q.get("etsy");
    if (e) setMsg(e.startsWith("connected:") ? `Etsy connected: ${e.slice(10)}` : e);
  }, []);

  const disconnect = async () => {
    if (!confirm("Disconnect Gmail from Jarvis?")) return;
    await fetch("/api/google/disconnect", { method: "POST" });
    load();
  };

  const status = (c: Check) => (!c.on ? "Not set up" : c.ok ? (c.info ?? "Connected") : `Problem: ${c.error}`);

  return (
    <div className="mx-auto max-w-3xl p-4">
      <header className="mb-4 flex items-center gap-3">
        <Link href="/" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          ← Command Center
        </Link>
        <h1 className="text-xl font-semibold">Connections</h1>
      </header>
      <p className="mb-4 text-sm text-muted">
        How to set each one up: <b>docs/connections-setup.md</b> in your Jarvis repo. Keys go in Render → Environment, never in chat.
      </p>
      {msg && <p className="mb-4 rounded-lg bg-accent-dim/30 px-3 py-2 text-sm text-accent">{msg}</p>}
      {!s ? (
        <p className="text-muted">Checking…</p>
      ) : (
        <ul className="space-y-3">
          <Row name="Stripe" ok={s.stripe.on && s.stripe.ok} detail={status(s.stripe)} what="Sales and recurring revenue in your tiles; payment links after your approval." />
          <Row
            name="Google sign-in"
            ok={s.gmail.on}
            detail={
              s.gmail.on
                ? `${s.gmail.account}: Gmail${s.gmail.calendar ? " · Calendar" : ""}${s.gmail.drive ? " · Drive" : ""}${
                    !s.gmail.calendar || !s.gmail.drive ? " (reconnect to add the rest)" : ""
                  }`
                : s.gmail.app
                  ? "Ready to connect"
                  : "Needs GOOGLE_CLIENT_ID / SECRET first"
            }
            what="Gmail (read, drafts; sending only after approval), Calendar (read-only) and Drive (only files Jarvis creates)."
          >
            {!s.gmail.on && <CopyUri label="Redirect URI for Google Cloud" uri={s.googleRedirectUri} />}
            {s.gmail.app &&
              (s.gmail.on ? (
                <button onClick={disconnect} className="rounded-lg border border-line px-3 py-1.5 text-xs text-muted">
                  Disconnect
                </button>
              ) : (
                <a href="/api/google/connect" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg">
                  Connect Google
                </a>
              ))}
          </Row>
          <Row
            name="Etsy"
            ok={s.etsy.on && s.etsy.ok}
            detail={s.etsy.on ? status(s.etsy) : s.etsy.app ? "Ready to connect" : "Needs ETSY_API_KEY first"}
            what="Sales, orders and reviews for the POD store."
          >
            {!s.etsy.on && <CopyUri label="Callback URL for Etsy" uri={s.etsyRedirectUri} />}
            {s.etsy.app && !s.etsy.on && (
              <a href="/api/etsy/connect" className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg">
                Connect Etsy
              </a>
            )}
          </Row>
          <Row
            name="Printify"
            ok={s.printify.on && s.printify.ok}
            detail={status(s.printify)}
            what="Shop Marketer creates Etsy listings from your TEMPLATE products; problem orders alert you."
          >
            {s.printify.on && (
              <label className="flex items-center gap-2 text-xs text-muted">
                <input
                  type="checkbox"
                  checked={s.etsyAutopublish}
                  onChange={async (e) => {
                    await fetch("/api/connections", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ etsyAutopublish: e.target.checked }),
                    });
                    load();
                  }}
                />
                Publish listings without asking
              </label>
            )}
          </Row>
          <Row
            name="Saleshandy"
            ok={s.saleshandy.on && s.saleshandy.ok}
            detail={status(s.saleshandy)}
            what="Finds each company's owner and their verified email (Lead Finder), and takes approved leads into your Saleshandy sequence, which does the sending. Replies come back to Jarvis: yeses start the free audit, questions get a researched draft for you to approve."
          >
            {s.saleshandy.on && (
              <button
                onClick={async () => {
                  const r = await fetch("/api/saleshandy", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "connect_webhook" }) });
                  const d = (await r.json().catch(() => ({}))) as { result?: string; error?: string };
                  setMsg(r.ok ? `Saleshandy replies ${d.result}.` : `Saleshandy: ${d.error}`);
                  load();
                }}
                className="rounded-lg border border-accent/50 px-3 py-1 text-xs text-accent"
              >
                {s.saleshandyReplies ? "Replies connected ✓ (tap to re-check)" : "Connect replies"}
              </button>
            )}
          </Row>
          <Row
            name="Phone calls"
            ok={s.calls.on && s.calls.ok}
            detail={status(s.calls)}
            what="Jarvis calls places for you (reservations, appointments, quick questions) in his voice, after you approve each call. ElevenLabs + a Twilio number."
          />
          <Row
            name="Google Maps search"
            ok={s.maps.on}
            detail={s.maps.on ? `${s.maps.today}/${s.maps.dailyLimit} today · ${s.maps.month}/${s.maps.monthlyLimit} this month` : "Needs the Google key"}
            what="The Prospector and Audit Desk see real map rankings, ratings and reviews. Capped to stay inside Google's free monthly amount. Needs “Places API (New)” turned on for your Google key."
          />
          <Row name="Apollo" ok={s.apollo.on} detail={s.apollo.on ? "Key set" : "Not set up"} what="Second choice for finding the owner and their work email, if Saleshandy finds no one." />
          <Row name="Hunter" ok={s.hunter.on} detail={s.hunter.on ? "Key set" : "Not set up"} what="Backup email finder, and verifies every email before it's used." />
          <Row
            name="Google key"
            ok={s.gemini.on}
            detail={s.gemini.on ? `Gemini images${s.gemini.youtube ? " · YouTube trends" : ""}` : "Not set up"}
            what="Gemini: post images and listing designs (a few cents each). YouTube: real view counts for the Growth Lab (free)."
          />
          <Row name="Gemini images" ok={s.geminiImages.on && s.geminiImages.ok} detail={status(s.geminiImages)} what={`Which image model ${idn.assistant} found for your key. Google retires these often; it switches to the newest one automatically.`} />
          {!idn.kit && (
            <>
              <Row name="Instagram" ok={s.instagram.on && s.instagram.ok} detail={status(s.instagram)} what="Approved Nina posts publish automatically." />
              <Row name="Nina's voice" ok={s.ninaVoice.on} detail={s.ninaVoice.on ? "Voice ID set" : "Optional"} what="Voiceovers for Reels/TikToks (uses your ElevenLabs credits)." />
            </>
          )}
          <Row
            name="Google Calendar"
            ok={s.calendar.on}
            detail={s.gmail.calendar ? "Through your Google sign-in" : s.calendar.on ? "Through the iCal link" : "Not set up"}
            what="Your schedule in briefings."
          />
          <Row name={idn.kit ? "Instagram, TikTok" : "TikTok, Reddit, Fanvue"} ok={false} detail="Share packages for now" what={`Their posting APIs need an audit or approval first; ${idn.assistant} prepares posts and you post them.`} />
          <TelegramRow app={s.telegram.app} on={s.telegram.on} />
          <Row
            name="AI model"
            ok={!s.brain.problem}
            detail={s.brain.problem ? `Problem: ${s.brain.label}: ${s.brain.problem}` : s.brain.label}
            what={`The brain behind ${idn.assistant} and every crew. Claude by default; OpenRouter or a free local model (Ollama) also work (docs/choose-your-model.md).`}
          />
          <Row name="Backup" ok detail={`Everything ${idn.assistant} knows, in one file`} what={`Memories, to-dos, crews, leads, clients, settings, images and reels. Keep a copy, or use it to move ${idn.assistant} to another computer (docs/moving-off-render.md). Keys in Render's Environment aren't included.`}>
            <a href="/api/backup" className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
              Download backup
            </a>
          </Row>
        </ul>
      )}
    </div>
  );
}

function Row({ name, ok, detail, what, children }: { name: string; ok: boolean; detail: string; what: string; children?: React.ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-3 rounded-2xl border border-line bg-panel p-4">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${ok ? "bg-accent" : "bg-line"}`} />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{name}</p>
        <p className="text-xs text-muted">{what}</p>
        <p className={`mt-1 text-xs ${detail.startsWith("Problem") ? "text-warn" : ok ? "text-accent" : "text-muted"}`}>{detail}</p>
      </div>
      {children}
    </li>
  );
}

// The exact address to paste into Google Cloud / Etsy, with a copy button.
function CopyUri({ label, uri }: { label: string; uri: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="w-full">
      <p className="text-[11px] text-muted">{label}:</p>
      <div className="mt-1 flex items-center gap-2">
        <code className="min-w-0 flex-1 break-all rounded bg-panel-2 px-2 py-1 text-[11px]">{uri}</code>
        <button
          onClick={() => navigator.clipboard.writeText(uri).then(() => setCopied(true))}
          className="shrink-0 rounded-lg border border-line px-2 py-1 text-[11px] text-muted"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// Telegram: connect with a one-time start code, or disconnect.
function TelegramRow({ app, on }: { app: boolean; on: boolean }) {
  const [link, setLink] = useState<{ link: string; code: string; bot: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [connected, setConnected] = useState(on);
  const act = async (action: "connect" | "disconnect") => {
    setErr(null);
    const res = await fetch("/api/telegram", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok) return setErr(d.error ?? "Something went wrong.");
    if (action === "connect") setLink(d);
    else {
      setConnected(false);
      setLink(null);
    }
  };
  return (
    <Row
      name="Telegram"
      ok={connected}
      detail={connected ? "Connected: talk to Jarvis and approve things in Telegram" : app ? "Bot token added: tap Connect" : "Optional: add TELEGRAM_BOT_TOKEN (docs/telegram-setup.md)"}
      what="Chat with Jarvis from Telegram, and get alerts with Approve / Deny and answer buttons."
    >
      {app && !connected && (
        <button onClick={() => act("connect")} className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          Connect
        </button>
      )}
      {connected && (
        <button onClick={() => act("disconnect")} className="rounded-lg border border-line px-3 py-2 text-sm text-muted hover:text-ink">
          Disconnect
        </button>
      )}
      {link && !connected && (
        <p className="w-full text-xs">
          <a href={link.link} target="_blank" rel="noreferrer" className="font-semibold text-accent underline">
            Open @{link.bot} in Telegram and tap Start
          </a>{" "}
          (or send it <code>/start {link.code}</code>). The code works for 15 minutes.
        </p>
      )}
      {err && <p className="w-full text-xs text-warn">{err}</p>}
    </Row>
  );
}
