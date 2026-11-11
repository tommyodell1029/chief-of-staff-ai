// The Growth Lab: daily research, the weekly Top 5 + add-ons, and "business in a box" packages.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { desc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { BUSINESS_CONTEXT, CREW_TOOLS, AGENT_MODELS } from "@/config/business";
import { MODELS } from "@/config/models";
import { runJob, webSearch } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import type { Opportunity } from "@/lib/db/schema";
import { driveConnected, saveDoc } from "@/lib/integrations/drive";
import { trendingVideos, youtubeConfigured } from "@/lib/integrations/youtube";
import { notifyAll } from "@/lib/push";

// ---------- Notebook ----------

export function addNote(area: string, title: string, body: string, sources: string[] = []) {
  return getDb()
    .insert(schema.notebookEntries)
    .values({ area, title, body, sources: JSON.stringify(sources) })
    .returning()
    .get();
}

export function listNotes(limit = 50, area?: string) {
  const n = schema.notebookEntries;
  const q = getDb().select().from(n);
  return (area ? q.where(eq(n.area, area)) : q).orderBy(desc(n.createdAt)).limit(limit).all();
}

const saveNoteTool = (area: string, saved: { id: number; title: string }[]) =>
  betaZodTool({
    name: "save_note",
    description: "Save a research finding to the notebook. Include the URLs you relied on.",
    inputSchema: z.object({
      title: z.string().min(3),
      body: z.string().min(20).describe("The finding in plain words: what, why it works, numbers, and what it means for Tommy"),
      sources: z.array(z.string()).describe("URLs backing this up"),
    }),
    run: async ({ title, body, sources }) => {
      const n = addNote(area, title, body, sources);
      saved.push({ id: n.id, title });
      return `Saved note #${n.id}.`;
    },
  });

// ---------- Daily research ----------

// Rotates through these, one per day.
export const RESEARCH_AREAS = [
  {
    area: "trends",
    brief:
      "What's pulling people in on TikTok and Instagram Reels right now: hooks, formats, sounds, niches and offers, why they work, and how creators make money from them. Focus on what Tommy's businesses could use this week.",
  },
  {
    area: "agency",
    brief:
      "Google Maps / local SEO and AI-search visibility for any local business found by 'near me' searches (LaunchPad Local sells this: map-pack ranking, Google Business Profile management, review systems, listing cleanup, schema and AI-search setup, government bid finding, bill audits). Google and AI-search algorithm changes, what competitors charge, objections, what's converting, and add-ons existing clients would buy.",
  },
  {
    area: "pod",
    brief:
      "Etsy and print-on-demand: what custom photo gifts are selling, seasonal opportunities in the next 6–8 weeks, Etsy/Printify policy changes, listing and pricing tactics.",
  },
  {
    area: "creator",
    brief:
      "AI influencers and the creator economy: Instagram/TikTok/Reddit/Fanvue rule changes for AI personas, growth tactics that work, monetization trends.",
  },
  {
    area: "wealth",
    brief:
      "Turning small online businesses into lasting assets: owned audiences (email/SMS), recurring revenue models, what makes small online businesses sellable, and add-ons that compound.",
  },
  {
    area: "new",
    brief:
      "Emerging online business models that fit 10–15 hours a week and Tommy's skills (AI, sign building, electrical): faceless content, digital products, coaching/courses, apps, agencies, and service businesses run through 1099 contractors.",
  },
];

const RESEARCHER_SYSTEM = `You are the Growth Lab researcher on Jarvis's team, working for Tommy. You never talk to Tommy directly; your notes go to Jarvis.
${BUSINESS_CONTEXT}

How to research:
- If you have youtube_trends, use it to check real view counts behind any content trend you report.
- Search the web for current, specific evidence (2026 data, real examples, prices, platform announcements). Prefer primary sources; say when a source is a vendor with a stake.
- Save 2–4 notebook notes with save_note, each one a distinct, useful finding with its URLs. No fluff, no hype.
- Finish with a 2–3 sentence summary of the most useful thing you found.`;

// Real numbers from YouTube (Shorts included) to back up trend findings.
const youtubeTool = () =>
  betaZodTool({
    name: "youtube_trends",
    description:
      "Most-viewed YouTube videos (including Shorts) on a topic from the last N days, with views per day. Use it to check what's actually pulling views right now.",
    inputSchema: z.object({ query: z.string(), days: z.number().int().min(1).max(60).optional() }),
    run: async ({ query, days }) => {
      try {
        const v = await trendingVideos(query, days ?? 14, 10);
        return v.length
          ? v.map((x) => `${x.short ? "[Short] " : ""}${x.title} | ${x.channel} | ${x.views.toLocaleString()} views (${x.viewsPerDay.toLocaleString()}/day) | ${x.published} | ${x.url}`).join("\n")
          : "No videos found.";
      } catch (err) {
        return `YouTube error: ${err instanceof Error ? err.message : String(err)}`;
      }
    },
  });

export async function runDailyResearch(areaName?: string) {
  const day = Math.floor(Date.now() / 86_400_000);
  const area = RESEARCH_AREAS.find((a) => a.area === areaName) ?? RESEARCH_AREAS[day % RESEARCH_AREAS.length];
  const saved: { id: number; title: string }[] = [];
  const result = await runJob({
    purpose: `research_${area.area}`,
    model: { ...MODELS.writer, effort: "medium" },
    system: RESEARCHER_SYSTEM,
    prompt: `Today's research area: ${area.area}.\n${area.brief}\n\nToday is ${new Date().toDateString()}.`,
    tools: [webSearch(MODELS.writer.id, 6), saveNoteTool(area.area, saved), ...(youtubeConfigured() ? [youtubeTool()] : [])],
    maxIterations: 12,
  });
  console.log(`[growth] research ${area.area}: ${saved.length} notes, $${result.costUsd.toFixed(3)}`);
  return { area: area.area, notes: saved, summary: result.text, costUsd: result.costUsd };
}

// ---------- Weekly ranking ----------

const SCORE_KEYS = [
  "demand",
  "startup_cost",
  "hours_fit",
  "automation",
  "recurring_revenue",
  "asset_value",
  "durability",
  "skill_fit",
] as const;

export const SCORE_LABELS: Record<(typeof SCORE_KEYS)[number], string> = {
  demand: "Demand",
  startup_cost: "Low startup cost",
  hours_fit: "Fits 10–15 hrs/wk",
  automation: "Automatable",
  recurring_revenue: "Recurring revenue",
  asset_value: "Builds an asset",
  durability: "Lasts 3–5 yrs",
  skill_fit: "Fits your skills",
};

const scoreShape = Object.fromEntries(SCORE_KEYS.map((k) => [k, z.number().min(1).max(10)])) as Record<
  (typeof SCORE_KEYS)[number],
  z.ZodNumber
>;

function weekOf(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

export async function runWeeklyRanking() {
  const notes = getDb()
    .select()
    .from(schema.notebookEntries)
    .where(gte(schema.notebookEntries.createdAt, new Date(Date.now() - 14 * 86_400_000)))
    .orderBy(desc(schema.notebookEntries.createdAt))
    .limit(60)
    .all()
    .filter((n) => !n.area.startsWith("agent:"));
  const businesses = getDb().select().from(schema.businesses).all();
  const week = weekOf();
  const created: Opportunity[] = [];

  const saveOpportunity = betaZodTool({
    name: "save_opportunity",
    description: "Save one ranked opportunity for Tommy's shortlist.",
    inputSchema: z.object({
      kind: z.enum(["new", "addon"]),
      business: z.string().optional().describe("For add-ons: the exact name of the existing business it grows"),
      title: z.string(),
      summary: z.string().describe("2–3 sentences: what it is and how it makes money"),
      scores: z.object(scoreShape).describe("1–10 each; higher is better for Tommy (e.g. startup_cost 10 = very cheap)"),
      evidence: z.string().describe("The specific evidence behind it"),
      sources: z.array(z.string()),
      confidence: z.enum(["low", "medium", "high"]),
      best_case: z.string(),
      worst_case: z.string(),
    }),
    run: async (o) => {
      const values = Object.values(o.scores);
      const business = o.business ? businesses.find((b) => b.name.toLowerCase() === o.business!.toLowerCase()) : undefined;
      const row = getDb()
        .insert(schema.opportunities)
        .values({
          kind: o.kind,
          businessId: business?.id ?? null,
          title: o.title,
          summary: o.summary,
          scores: JSON.stringify(o.scores),
          score: Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10,
          evidence: o.evidence,
          sources: JSON.stringify(o.sources),
          confidence: o.confidence,
          bestCase: o.best_case,
          worstCase: o.worst_case,
          weekOf: week,
        })
        .returning()
        .get();
      created.push(row);
      return `Saved opportunity #${row.id}.`;
    },
  });

  const businessList = businesses.length
    ? businesses.map((b) => `- ${b.name} (${b.status})`).join("\n")
    : "- (none set up yet; use the three planned businesses by these names: Custom Photo Gifts (Etsy POD), Creator (AI influencer), LaunchPad Local)";
  const result = await runJob({
    purpose: "growth_weekly_ranking",
    model: MODELS.orchestrator,
    system: `You are Jarvis, ranking this week's opportunities for Tommy.\n${BUSINESS_CONTEXT}`,
    prompt: `Here are the Growth Lab's recent notebook notes:\n\n${
      notes.map((n) => `## [${n.area}] ${n.title}\n${n.body}\nSources: ${n.sources ?? "[]"}`).join("\n\n") || "(no notes yet)"
    }\n\nExisting businesses:\n${businessList}\n\nCall save_opportunity for:\n1. The TOP 5 new opportunities (kind "new"): new businesses or big expansions.\n2. The single best add-on for EACH existing business (kind "addon", with the business name).\nScore honestly on all eight criteria. You may run a few web searches to fill gaps. Then reply with a two-sentence summary.`,
    tools: [webSearch(MODELS.orchestrator.id, 4), saveOpportunity],
    maxIterations: 20,
  });
  console.log(`[growth] weekly ranking: ${created.length} opportunities, $${result.costUsd.toFixed(3)}`);
  if (created.length) {
    await notifyAll({
      title: "Growth Lab: this week's shortlist",
      body: `${created.length} ranked opportunities are ready for your Approve / Pass.`,
      url: "/lab",
      tag: "growth",
    }).catch(() => {});
  }
  return { created: created.length, summary: result.text, costUsd: result.costUsd };
}

// ---------- Shortlist decisions ----------

export function listOpportunities(statuses: string[] = ["proposed", "building", "approved"]) {
  return getDb()
    .select()
    .from(schema.opportunities)
    .orderBy(desc(schema.opportunities.createdAt), desc(schema.opportunities.score))
    .limit(100)
    .all()
    .filter((o) => statuses.includes(o.status));
}

export function passOpportunity(id: number) {
  getDb()
    .update(schema.opportunities)
    .set({ status: "passed", decidedAt: new Date() })
    .where(eq(schema.opportunities.id, id))
    .run();
}

// Approving starts building the "business in a box" in the background.
export function approveOpportunity(id: number) {
  const opp = getDb().select().from(schema.opportunities).where(eq(schema.opportunities.id, id)).get();
  if (!opp || opp.status !== "proposed") return false;
  getDb()
    .update(schema.opportunities)
    .set({ status: "building", decidedAt: new Date() })
    .where(eq(schema.opportunities.id, id))
    .run();
  buildBusinessInABox(opp).catch((err) => {
    console.error("[growth] business-in-a-box failed:", err);
    getDb().update(schema.opportunities).set({ status: "proposed" }).where(eq(schema.opportunities.id, id)).run();
  });
  return true;
}

async function buildBusinessInABox(opp: Opportunity) {
  let crew: { name: string; job: string; model: "writer" | "worker"; tools: string[] }[] = [];
  const proposeCrew = betaZodTool({
    name: "propose_crew",
    description: "Propose the 2–4 specialist agents that should run this (new businesses only).",
    inputSchema: z.object({
      agents: z
        .array(
          z.object({
            name: z.string(),
            job: z.string().describe("One job, described in 1–3 sentences"),
            model: z.enum(["writer", "worker"]).describe("writer = strategy/writing; worker = repetitive, high-volume"),
            tools: z.array(z.enum(CREW_TOOLS as [string, ...string[]])),
          }),
        )
        .min(2)
        .max(4),
    }),
    run: async ({ agents }) => {
      crew = agents;
      return "Crew saved.";
    },
  });

  const business = opp.businessId
    ? getDb().select().from(schema.businesses).where(eq(schema.businesses.id, opp.businessId)).get()
    : undefined;
  const result = await runJob({
    purpose: "growth_business_in_a_box",
    model: MODELS.orchestrator,
    system: `You are Jarvis, turning an approved idea into a ready-to-run package for Tommy.\n${BUSINESS_CONTEXT}`,
    prompt: `Approved ${opp.kind === "addon" ? `add-on for "${business?.name ?? "an existing business"}"` : "new business"}: ${opp.title}
Summary: ${opp.summary}
Evidence: ${opp.evidence}

Write the package in Markdown with these sections:
## The offer and pricing
## Target customer
## 30-day launch plan (week by week)
## 10 hooks / scripts in the style that's working now
## Tools needed and startup cost (free first; stay inside the ~$50/month budget)
## First 5 tasks
## Risks and how to check early whether it's working
${opp.kind === "new" ? "Also call propose_crew with 2–4 agents to run it." : ""}
You may run a few web searches for current prices or examples. Reply with only the Markdown package.`,
    tools: [webSearch(MODELS.orchestrator.id, 3), ...(opp.kind === "new" ? [proposeCrew] : [])],
    maxIterations: 8,
  });

  const db = getDb();
  if (opp.kind === "new") {
    const biz = db
      .insert(schema.businesses)
      .values({ name: opp.title, status: "draft", notes: opp.summary })
      .returning()
      .get();
    for (const a of crew) {
      db.insert(schema.agents)
        .values({
          businessId: biz.id,
          name: a.name,
          job: a.job,
          systemPrompt: "",
          model: AGENT_MODELS[a.model].id,
          allowedTools: JSON.stringify(a.tools),
          status: "draft",
        })
        .run();
    }
    db.update(schema.opportunities).set({ businessId: biz.id }).where(eq(schema.opportunities.id, opp.id)).run();
  }
  // Keep a copy in Tommy's Google Drive when it's connected.
  let packageMd = result.text;
  if (driveConnected()) {
    const link = await saveDoc(`Business in a box: ${opp.title}`, result.text).catch(() => null);
    if (link) packageMd = `**Google Doc:** ${link}\n\n${packageMd}`;
  }
  db.update(schema.opportunities)
    .set({ status: "approved", packageMd })
    .where(eq(schema.opportunities.id, opp.id))
    .run();
  await notifyAll({
    title: "Business in a box ready",
    body: `${opp.title}: your launch package${opp.kind === "new" ? " and draft crew are" : " is"} ready to review.`,
    url: "/lab",
    tag: `box-${opp.id}`,
  }).catch(() => {});
}
