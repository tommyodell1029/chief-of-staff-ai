// GET /api/connections — what's connected (never returns keys).
import { calendarConfigured } from "@/lib/calendar";
import { geminiConfigured, imageModel } from "@/lib/integrations/gemini";
import { gmailAccount, gmailConnected, googleAppConfigured, googleRedirectUri, googleScopes } from "@/lib/integrations/gmail";
import { youtubeConfigured } from "@/lib/integrations/youtube";
import { instagramAccount, instagramConfigured } from "@/lib/integrations/instagram";
import { apolloConfigured } from "@/lib/integrations/apollo";
import { etsyAppConfigured, etsyConnected, etsyRedirectUri, etsySummary } from "@/lib/integrations/etsy";
import { hunterConfigured } from "@/lib/integrations/hunter";
import { mapsConfigured, mapsUsage } from "@/lib/integrations/places";
import { callsConfigured, listPhoneNumbers } from "@/lib/integrations/elevenAgents";
import { listSequences, saleshandyConfigured, saleshandyCredits } from "@/lib/integrations/saleshandy";
import { printifyConfigured, printifyStatus } from "@/lib/integrations/printify";
import { stripeConfigured, stripeSummary } from "@/lib/integrations/stripe";
import { getSetting, setSetting } from "@/lib/settings";
import { telegramConfigured, telegramPaired } from "@/lib/integrations/telegram";
import { providerLabel, providerProblem } from "@/lib/llm/compat";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const check = async <T,>(on: boolean, fn: () => Promise<T>) => {
    if (!on) return { on: false as const };
    try {
      return { on: true as const, ok: true, info: await fn() };
    } catch (err) {
      return { on: true as const, ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  };
  return Response.json({
    stripe: await check(stripeConfigured(), async () => {
      const s = await stripeSummary();
      return `This month $${s.monthUsd.toFixed(2)} · MRR $${s.mrrUsd.toFixed(2)}`;
    }),
    googleRedirectUri: googleRedirectUri(req),
    etsyRedirectUri: etsyRedirectUri(req),
    gmail: {
      app: googleAppConfigured(),
      on: gmailConnected(),
      account: gmailAccount() ?? null,
      calendar: googleScopes().includes("calendar"),
      drive: googleScopes().includes("drive.file"),
    },
    gemini: { on: geminiConfigured(), youtube: youtubeConfigured() },
    geminiImages: await check(geminiConfigured(), async () => `Nina's images use ${await imageModel(true)}`),
    instagram: await check(instagramConfigured(), async () => `@${(await instagramAccount()).username}`),
    ninaVoice: { on: !!process.env.NINA_VOICE_ID },
    telegram: { app: telegramConfigured(), on: telegramPaired() },
    brain: { label: providerLabel(), problem: providerProblem() },
    calendar: { on: calendarConfigured() },
    etsy: { app: etsyAppConfigured(), ...(await check(etsyConnected(), async () => {
      const e = await etsySummary();
      return `${e.shop}: $${e.weekUsd.toFixed(2)} this week, ${e.ordersThisWeek} orders`;
    })) },
    printify: await check(printifyConfigured(), printifyStatus),
    etsyAutopublish: getSetting("etsy_autopublish") === "1",
    apollo: { on: apolloConfigured() },
    hunter: { on: hunterConfigured() },
    saleshandy: await check(saleshandyConfigured(), async () => {
      const [seqs, credits] = await Promise.all([listSequences(), saleshandyCredits().catch(() => null)]);
      return `${seqs.length} sequence${seqs.length === 1 ? "" : "s"}${credits ? ` · ${credits.totalCredits} Lead Finder credits` : ""}`;
    }),
    maps: { on: mapsConfigured(), ...mapsUsage() },
    saleshandyReplies: !!getSetting("saleshandy_webhook_secret"),
    calls: await check(callsConfigured(), async () => {
      const n = (await listPhoneNumbers())[0];
      if (!n) throw new Error("No phone number imported into ElevenLabs yet.");
      const only = process.env.CALLS_ONLY_TO?.trim();
      return `Calls from ${n.phone_number}${only ? ` · TEST MODE: only calls ${only}` : ""}${process.env.TOMMY_PHONE ? "" : " · add TOMMY_PHONE for callbacks"}`;
    }),
  });
}

// POST /api/connections {etsyAutopublish: boolean} — let the Shop Marketer publish listings without asking each time.
export async function POST(req: Request) {
  const { etsyAutopublish } = (await req.json().catch(() => ({}))) as { etsyAutopublish?: boolean };
  if (typeof etsyAutopublish === "boolean") setSetting("etsy_autopublish", etsyAutopublish ? "1" : "0");
  return Response.json({ ok: true });
}
