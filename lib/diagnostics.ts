// "Jarvis, run diagnostics": every system he depends on, checked and summed up in one line he can say.
// quick = configuration only (no outside calls), used for the station's boot readout.
import fs from "node:fs";
import path from "node:path";
import { and, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { calendarConfigured } from "@/lib/calendar";
import { geminiConfigured } from "@/lib/integrations/gemini";
import { gmailConnected } from "@/lib/integrations/gmail";
import { instagramAccount, instagramConfigured } from "@/lib/integrations/instagram";
import { etsyConnected, etsySummary } from "@/lib/integrations/etsy";
import { mapsConfigured, mapsUsage } from "@/lib/integrations/places";
import { callsConfigured, listPhoneNumbers } from "@/lib/integrations/elevenAgents";
import { listSequences, saleshandyConfigured } from "@/lib/integrations/saleshandy";
import { printifyConfigured, printifyStatus } from "@/lib/integrations/printify";
import { stripeConfigured, stripeSummary } from "@/lib/integrations/stripe";
import { weatherConfigured } from "@/lib/integrations/weather";
import { providerLabel, providerProblem } from "@/lib/llm/compat";
import { spendToday } from "@/lib/spend";

export interface SystemCheck {
  name: string;
  status: "online" | "offline" | "warning";
  detail: string;
}

const STARTED = Date.now();

async function live(name: string, on: boolean, offDetail: string, fn: () => Promise<string>, quick: boolean): Promise<SystemCheck> {
  if (!on) return { name, status: "offline", detail: offDetail };
  if (quick) return { name, status: "online", detail: "configured" };
  try {
    const detail = await Promise.race([fn(), new Promise<string>((_, rej) => setTimeout(() => rej(new Error("no answer in 8 seconds")), 8000))]);
    return { name, status: "online", detail };
  } catch (err) {
    return { name, status: "warning", detail: (err instanceof Error ? err.message : String(err)).slice(0, 140) };
  }
}

function dataDir() {
  return process.env.DATA_DIR || path.join(process.cwd(), "data");
}

function core(): SystemCheck[] {
  const out: SystemCheck[] = [];
  const s = spendToday();
  out.push({
    name: "Brain",
    status: providerProblem() ? "offline" : s.overCap || s.overMonthCap ? "warning" : "online",
    detail: providerProblem()
      ? `${providerLabel()}: ${providerProblem()}`
      : `${providerLabel()} · ` + `$${s.totalUsd.toFixed(2)} of $${s.capUsd.toFixed(2)} today, $${s.monthUsd.toFixed(2)} of $${s.monthCapUsd.toFixed(2)} this month${s.overCap || s.overMonthCap ? " (cap reached)" : ""}`,
  });
  out.push({ name: "Voice", status: process.env.ELEVENLABS_API_KEY ? "online" : "offline", detail: process.env.ELEVENLABS_API_KEY ? "ElevenLabs" : "no ElevenLabs key" });
  out.push({ name: "Nina's voice", status: process.env.NINA_VOICE_ID ? "online" : "offline", detail: process.env.NINA_VOICE_ID ? "set" : "no voice ID" });

  try {
    const file = path.join(dataDir(), "jarvis.db");
    const mb = fs.existsSync(file) ? fs.statSync(file).size / 1e6 : 0;
    const st = fs.statfsSync(dataDir());
    const freeGb = (st.bavail * st.bsize) / 1e9;
    out.push({
      name: "Memory core",
      status: freeGb < 0.2 ? "warning" : "online",
      detail: `database ${mb.toFixed(1)} MB, ${freeGb.toFixed(1)} GB free on disk`,
    });
  } catch (err) {
    out.push({ name: "Memory core", status: "warning", detail: err instanceof Error ? err.message : String(err) });
  }

  const db = getDb();
  const dayAgo = new Date(Date.now() - 86_400_000);
  const failed = db.select().from(schema.tasks).where(and(eq(schema.tasks.status, "failed"), gte(schema.tasks.createdAt, dayAgo))).all().length;
  const pending = db.select().from(schema.approvals).where(eq(schema.approvals.status, "pending")).all().length;
  out.push({
    name: "Crews",
    status: failed ? "warning" : "online",
    detail: `${failed ? `${failed} task${failed === 1 ? "" : "s"} failed today` : "no failures today"}, ${pending} approval${pending === 1 ? "" : "s"} waiting`,
  });
  const lastTick = Number(db.select().from(schema.settings).where(eq(schema.settings.key, "presence_tick")).get()?.value ?? 0);
  const hours = Math.round((Date.now() - STARTED) / 3_600_000);
  out.push({
    name: "Scheduler",
    status: lastTick && Date.now() - lastTick > 5 * 60_000 ? "warning" : "online",
    detail: `${lastTick && Date.now() - lastTick > 5 * 60_000 ? "the minute clock looks stalled; " : ""}up ${hours < 1 ? "under an hour" : `${hours} hour${hours === 1 ? "" : "s"}`}`,
  });
  return out;
}

export async function runDiagnostics(quick = false): Promise<SystemCheck[]> {
  const outside = await Promise.all([
    live("Gmail & Calendar", gmailConnected(), "Google not connected", async () => (calendarConfigured() ? "mail and calendar" : "mail (calendar not allowed)"), quick),
    live("Etsy", etsyConnected(), "not connected", async () => {
      const e = await etsySummary();
      return `${e.shop}: ${e.ordersThisWeek} order${e.ordersThisWeek === 1 ? "" : "s"} this week`;
    }, quick),
    live("Printify", printifyConfigured(), "no token", printifyStatus, quick),
    live("Stripe", stripeConfigured(), "no key", async () => `MRR $${(await stripeSummary()).mrrUsd.toFixed(0)}`, quick),
    live("Saleshandy", saleshandyConfigured(), "no key", async () => `${(await listSequences()).length} sequences`, quick),
    live("Phone line", callsConfigured(), "no ElevenLabs key", async () => {
      const n = (await listPhoneNumbers())[0];
      if (!n) throw new Error("no phone number imported");
      return `${n.phone_number}${process.env.CALLS_ONLY_TO ? " (test mode: calls only you)" : ""}`;
    }, quick),
    live("Maps", mapsConfigured(), "no Google key", async () => {
      const u = mapsUsage();
      return `${u.today} of ${u.dailyLimit} searches today`;
    }, quick),
    live("Weather", weatherConfigured(), "no Google key", async () => "ready", quick),
    live("Image studio", geminiConfigured(), "no Gemini key", async () => "ready", quick),
    // Instagram is posted by hand unless a token is added; it's only checked when connected.
    instagramConfigured() ? live("Instagram", true, "", async () => `@${(await instagramAccount()).username}`, quick) : null,
  ]);
  return [...core(), ...outside.filter((c): c is SystemCheck => c !== null)];
}

// One or two sentences Jarvis can say.
export function diagnosticsSummary(checks: SystemCheck[]): string {
  const online = checks.filter((c) => c.status === "online").length;
  const issues = checks.filter((c) => c.status === "warning");
  const offline = checks.filter((c) => c.status === "offline");
  const head =
    !issues.length && !offline.length
      ? `All ${checks.length} systems online.`
      : `${online} of ${checks.length} systems online.`;
  const parts = [
    head,
    issues.length ? `Needs attention: ${issues.map((c) => `${c.name} (${c.detail})`).join("; ")}.` : "",
    offline.length ? `Offline: ${offline.map((c) => `${c.name} (${c.detail})`).join("; ")}.` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

export function diagnosticsText(checks: SystemCheck[]): string {
  return checks.map((c) => `${c.status === "online" ? "✓" : c.status === "warning" ? "!" : "✗"} ${c.name}: ${c.detail}`).join("\n");
}
