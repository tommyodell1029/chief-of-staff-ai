// Jarvis's clock: runs scheduled jobs (briefings, to-do reminders, Growth Lab research, crew tasks) inside the app. Started once from instrumentation.ts.
import { schedule } from "node-cron";
import { runBriefing, type BriefingKind } from "@/lib/briefings";
import { applyDefaultRoutes } from "@/lib/crews/deck";
import { kitMode } from "@/lib/kit/kit";
import { applyAgencyRefresh, applyNinaRefresh, applyRenames, applyToolUpgrades, processQueue } from "@/lib/crews/crews";
import { refreshInstagramToken } from "@/lib/integrations/instagram";
import { checkReplies, enrichPending, sendDue } from "@/lib/outreach/outreach";
import { runDailyResearch, runWeeklyRanking } from "@/lib/growth/lab";
import { sendDueReminders } from "@/lib/reminders";

const globalForCron = globalThis as unknown as { jarvisCronStarted?: boolean };

// Standard cron format: minute hour day-of-month month day-of-week. Times are in TZ (Tommy's time zone).
const JOBS: { kind: BriefingKind; env: string; fallback: string | null }[] = [
  { kind: "lunch", env: "LUNCH_CHECKIN_CRON", fallback: "0 12 * * 1-5" }, // weekdays at noon
  { kind: "evening", env: "EVENING_REVIEW_CRON", fallback: "30 20 * * *" }, // every day at 8:30 pm
  { kind: "morning", env: "MORNING_BRIEFING_CRON", fallback: null }, // off unless set
];

export function startScheduler() {
  if (globalForCron.jarvisCronStarted) return;
  globalForCron.jarvisCronStarted = true;
  const timezone = process.env.TZ || "America/New_York";

  try {
    if (!kitMode()) {
      applyRenames();
      applyAgencyRefresh();
      applyNinaRefresh();
      applyDefaultRoutes();
      applyToolUpgrades(); // Tommy's crews only: client crews get their tools from the setup file
    }
    import("@/lib/goals/goals").then((g) => g.proposeStarterGoals()).catch((err) => console.error("[goals] starter goals:", err));
  } catch (err) {
    console.error("[scheduler] tool upgrades failed:", err);
  }

  // Outreach: find decision-maker emails (every 15 min), send scheduled emails and handle replies (every 10 min).
  const safely = (name: string, fn: () => Promise<unknown>) => async () => {
    try {
      await fn();
    } catch (err) {
      console.error(`[scheduler] ${name} failed:`, err instanceof Error ? err.message : err);
    }
  };
  // Free audit requests from the yourbusiness.com form (they arrive by email).
  schedule("*/10 * * * *", safely("audit requests", () => import("@/lib/outreach/auditRequests").then((a) => a.checkAuditRequests())), { timezone, name: "audit-requests", noOverlap: true });
  // Goals: numbers every morning; the Monday review sets each crew's week (lib/goals).
  schedule("10 6 * * *", safely("goal numbers", () => import("@/lib/goals/goals").then((g) => g.collectMetrics())), { timezone, name: "goal-metrics", noOverlap: true });
  schedule("5 7 * * 1", safely("monday review", () => import("@/lib/goals/review").then((r) => r.runMondayReview())), { timezone, name: "monday-review", noOverlap: true });
  // Presence: "focus time's over" (lib/presence.ts).
  schedule("* * * * *", safely("presence", () => import("@/lib/presence").then((p) => p.presenceTick())), { timezone, name: "presence", noOverlap: true });
  // Heads-ups the station says out loud (see lib/headsUp.ts).
  schedule("*/5 * * * *", safely("calendar heads-up", () => import("@/lib/headsUp").then((h) => h.calendarHeadsUp())), { timezone, name: "headsup-calendar", noOverlap: true });
  schedule("*/15 * * * *", safely("etsy heads-up", () => import("@/lib/headsUp").then((h) => h.etsyHeadsUp())), { timezone, name: "headsup-etsy", noOverlap: true });
  schedule("5 * * * *", safely("rain heads-up", () => import("@/lib/headsUp").then((h) => h.rainHeadsUp())), { timezone, name: "headsup-rain", noOverlap: true });
  schedule("* * * * *", safely("phone calls", () => import("@/lib/calls/calls").then((c) => c.processCalls())), { timezone, name: "phone-calls", noOverlap: true });
  schedule("*/15 * * * *", safely("lead enrichment", () => enrichPending()), { timezone, name: "outreach-enrich", noOverlap: true });
  schedule("*/10 * * * *", safely("outreach", async () => {
    await checkReplies();
    await sendDue();
  }), { timezone, name: "outreach", noOverlap: true });

  // Hourly: Printify orders that need a human (on hold, problems, unpaid) → one alert per order.
  schedule("23 * * * *", safely("printify orders", async () => {
    const { printifyConfigured, problemOrders } = await import("@/lib/integrations/printify");
    if (!printifyConfigured()) return;
    const { getSetting, setSetting } = await import("@/lib/settings");
    const { notifyAll } = await import("@/lib/push");
    for (const o of await problemOrders()) {
      const key = `order_alert:${o.id}:${o.status}`;
      if (getSetting(key)) continue;
      setSetting(key, "1");
      await notifyAll({ title: "Order needs attention", body: `Printify order ${o.metadata?.shop_order_label ?? o.id} is ${o.status.replace(/-/g, " ")}.`, url: "/connections" });
    }
  }), { timezone, name: "printify-orders", noOverlap: true });

  // LaunchPad Local clients: Maps ranks + Google post drafts every Monday; the monthly report on the 1st.
  schedule("40 6 * * 1", safely("client weekly", () => import("@/lib/clients/clients").then((c) => c.weeklyClientWork())), { timezone, name: "clients-weekly", noOverlap: true });
  schedule("15 8 1 * *", safely("client reports", () => import("@/lib/clients/clients").then((c) => c.monthlyClientReports())), { timezone, name: "clients-monthly", noOverlap: true });

  // Every 5 min: Night Shift (11 pm–6 am) runs tonight's queued work within its budget, then the morning report.
  schedule("*/5 * * * *", safely("night shift", () => import("@/lib/nightshift").then((n) => n.nightShiftTick())), { timezone, name: "night-shift", noOverlap: true });

  // Every 5 min: "time to post Nina's reel" reminders for approved posts (they're posted by hand).
  schedule("*/5 * * * *", safely("posting reminders", () => import("@/lib/nina/reminders").then((r) => r.postingReminders())), { timezone, name: "posting-reminders", noOverlap: true });

  // Sunday evening: Nina's best Etsy posts as boost suggestions (only once Instagram is connected).
  schedule("10 18 * * 0", safely("boost candidates", () => import("@/lib/nina/boost").then((b) => b.weeklyBoostCandidates())), { timezone, name: "boost-candidates", noOverlap: true });

  // Every morning: done-for-you builds (warm-ups that finished, builds sitting still).
  schedule("20 8 * * *", safely("builds", () => import("@/lib/builds/builds").then((b) => b.buildsTick())), { timezone, name: "builds", noOverlap: true });

  // Every 15 min: the Order Desk turns each new Etsy order into one card (photo check, Printify order, one-tap send).
  schedule("7,22,37,52 * * * *", safely("order desk", () => import("@/lib/orders/orderDesk").then((o) => o.runOrderDesk())), { timezone, name: "order-desk", noOverlap: true });

  // Weekly: keep the Instagram token fresh (it expires after 60 days unused).
  schedule("17 3 * * 1", () => refreshInstagramToken().catch(() => {}), { timezone, name: "ig-token" });

  // Every minute: notify about to-dos that just came due.
  schedule(
    "* * * * *",
    async () => {
      try {
        await sendDueReminders();
      } catch (err) {
        console.error("[scheduler] reminders failed:", err);
      }
    },
    { timezone, name: "todo-reminders", noOverlap: true },
  );

  // Every minute: run any queued crew tasks (one at a time; stops at the spending caps).
  schedule(
    "* * * * *",
    async () => {
      try {
        await processQueue();
      } catch (err) {
        console.error("[scheduler] crew queue failed:", err);
      }
    },
    { timezone, name: "crew-queue", noOverlap: true },
  );

  // Growth Lab: daily research (one area per day) and the weekly ranking.
  const growthJobs: { name: string; env: string; fallback: string; run: () => Promise<unknown> }[] = [
    { name: "research", env: "RESEARCH_CRON", fallback: "0 4 * * *", run: () => runDailyResearch() }, // 4 am daily
    { name: "ranking", env: "RANKING_CRON", fallback: "0 7 * * 0", run: () => runWeeklyRanking() }, // Sunday 7 am
  ];
  for (const job of growthJobs) {
    const expr = process.env[job.env]?.trim() || job.fallback;
    if (expr === "off") continue;
    try {
      schedule(
        expr,
        async () => {
          try {
            await job.run();
          } catch (err) {
            console.error(`[scheduler] growth ${job.name} failed:`, err instanceof Error ? err.message : err);
          }
        },
        { timezone, name: `growth-${job.name}`, noOverlap: true },
      );
      console.log(`[scheduler] growth ${job.name} scheduled: "${expr}" (${timezone})`);
    } catch (err) {
      console.error(`[scheduler] bad schedule for ${job.env} ("${expr}"):`, err);
    }
  }

  if (process.env.BRIEFINGS_ENABLED === "0") {
    console.log("[scheduler] briefings turned off (BRIEFINGS_ENABLED=0)");
    return;
  }
  for (const job of JOBS) {
    const expr = process.env[job.env]?.trim() || job.fallback;
    if (!expr || expr === "off") continue;
    try {
      schedule(
        expr,
        async () => {
          try {
            await runBriefing(job.kind);
          } catch (err) {
            console.error(`[scheduler] ${job.kind} briefing crashed:`, err);
          }
        },
        { timezone, name: `briefing-${job.kind}`, noOverlap: true },
      );
      console.log(`[scheduler] ${job.kind} briefing scheduled: "${expr}" (${timezone})`);
    } catch (err) {
      console.error(`[scheduler] bad schedule for ${job.env} ("${expr}"):`, err);
    }
  }
}
