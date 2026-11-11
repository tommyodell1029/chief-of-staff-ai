// The Monday business review. For each business with goals, Jarvis (full brain) reads the scorecard, last week's
// review and the crew's finished work, writes a short review (verdict, what worked, what didn't, this week's focus),
// and assigns up to 4 tasks to the crew toward the goals. Crew output still comes to Tommy for approval as usual.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { BUSINESS_CONTEXT } from "@/config/business";
import { MODELS } from "@/config/models";
import { runJob } from "@/lib/ai";
import { createTask, listAgents, listBusinesses } from "@/lib/crews/crews";
import { getDb, schema } from "@/lib/db";
import type { Business } from "@/lib/db/schema";
import { notifyAll } from "@/lib/push";
import { collectMetrics, listGoals, markMetGoals, metricLabel, scorecard, scorecardText } from "./goals";

const db = () => getDb();

export function mondayOf(d = new Date()) {
  const tz = process.env.TZ || "America/New_York";
  const local = new Date(d.toLocaleString("en-US", { timeZone: tz }));
  local.setDate(local.getDate() - ((local.getDay() + 6) % 7));
  return local.toLocaleDateString("en-CA");
}

export function latestReview(businessId: number) {
  return db().select().from(schema.reviews).where(eq(schema.reviews.businessId, businessId)).orderBy(desc(schema.reviews.createdAt)).limit(1).get();
}

function lastWeekWork(b: Business): string {
  const agents = listAgents(b.id);
  if (!agents.length) return "(no crew)";
  const names = new Map(agents.map((a) => [a.id, a.name]));
  const done = db()
    .select()
    .from(schema.tasks)
    .where(and(inArray(schema.tasks.agentId, agents.map((a) => a.id)), gte(schema.tasks.createdAt, new Date(Date.now() - 7 * 86_400_000))))
    .orderBy(desc(schema.tasks.createdAt))
    .limit(25)
    .all();
  if (!done.length) return "(no crew tasks last week)";
  return done
    .map((t) => `- ${names.get(t.agentId!) ?? "?"} [${t.status}]: ${t.instructions.slice(0, 140).replace(/\s+/g, " ")}${t.result ? ` → ${t.result.slice(0, 200).replace(/\s+/g, " ")}` : ""}`)
    .join("\n");
}

export async function reviewBusiness(b: Business): Promise<{ summary: string; assigned: string[] } | null> {
  const goals = listGoals(b.id, ["active", "met"]);
  if (!goals.some((g) => g.status === "active")) return null;
  const met = markMetGoals(b.id);
  const agents = listAgents(b.id);
  const crewActive = b.status === "active" && agents.some((a) => a.status === "active");
  const prev = latestReview(b.id);
  let summary = "";
  const assigned: string[] = [];

  const reviewTool = betaZodTool({
    name: "write_review",
    description: "Save this week's review (Markdown).",
    inputSchema: z.object({
      summary: z
        .string()
        .describe(
          "Markdown, under 250 words: **Verdict** (one line: on track / behind and why), **Scorecard** (one bullet per goal with number vs target), **What worked**, **What didn't**, **This week's focus** (2-3 bullets). Plain, specific, honest. No hype.",
        ),
    }),
    run: async ({ summary: s }) => {
      summary = s;
      return "Saved.";
    },
  });
  const assignTool = betaZodTool({
    name: "assign_task",
    description: "Give one crew member a task for this week toward the goals. At most 4 tasks in total. Be concrete: what to make or find, how many, by when.",
    inputSchema: z.object({
      agent: z.enum(agents.map((a) => a.name) as [string, ...string[]]),
      instructions: z.string().min(30).max(1200),
    }),
    run: async ({ agent, instructions }) => {
      if (!crewActive) return "The crew isn't approved yet, so tasks can't be assigned. Mention what you'd assign in the review instead.";
      if (assigned.length >= 4) return "Already 4 tasks this week. Stop assigning.";
      const a = agents.find((x) => x.name === agent && x.status === "active");
      if (!a) return `${agent} isn't active.`;
      createTask(a.id, `[Monday review ${mondayOf()}] ${instructions}`, "schedule");
      assigned.push(`${agent}: ${instructions.slice(0, 90)}`);
      return `Assigned to ${agent}.`;
    },
  });

  await runJob({
    purpose: "monday_review",
    model: { ...MODELS.orchestrator, effort: "medium" },
    system: `You are Jarvis, running Tommy's businesses as his chief of staff. Each Monday you review one business against its goals and set the crew's week. Judge from the numbers; say plainly when something isn't working and change course. Assign work that moves the goals that are behind, using what each crew member is good at. Don't assign anything that breaks the rules below or needs Tommy's money or accounts he hasn't connected. Tommy has 10-15 hours a week, so keep anything that needs him small.

${BUSINESS_CONTEXT}`,
    prompt: `Business: ${b.name}
Notes: ${b.notes ?? ""}
Crew: ${agents.map((a) => `${a.name} (${a.status}): ${a.job.slice(0, 160)}`).join("\n") || "(none)"}${crewActive ? "" : "\nThe crew is NOT approved yet: don't assign tasks; say in the review that approving the crew is step one."}

Scorecard:
${scorecardText(b.id)}
${met.length ? `\nGoals reached this week: ${met.map((g) => g.title).join(", ")}. Celebrate briefly and suggest the next goal in "This week's focus".` : ""}

Last week's crew work:
${lastWeekWork(b)}

Last week's review:
${prev ? prev.summary : "(first review)"}

Write the review with write_review, then assign up to 4 tasks with assign_task.`,
    tools: [reviewTool, assignTool],
    maxIterations: 8,
    maxTokens: 8000,
  });
  if (!summary) return null;
  db().insert(schema.reviews).values({ businessId: b.id, weekOf: mondayOf(), summary }).run();
  return { summary, assigned };
}

// Monday morning: fresh numbers, then a review per business, then one alert with the headlines.
export async function runMondayReview() {
  await collectMetrics();
  const headlines: string[] = [];
  const spoken: string[] = [];
  for (const b of listBusinesses()) {
    try {
      const r = await reviewBusiness(b);
      if (!r) continue;
      const lines = scorecard(b.id).filter((l) => l.goal.status !== "proposed");
      const behind = lines.filter((l) => l.pace === "behind").length;
      const verdict = behind ? `${behind} goal${behind > 1 ? "s" : ""} behind` : "on track";
      headlines.push(`${b.name}: ${verdict}${r.assigned.length ? `, ${r.assigned.length} tasks set` : ""}`);
      spoken.push(`${b.name} is ${verdict}`);
    } catch (err) {
      console.error(`[review] ${b.name}:`, err);
    }
  }
  if (!headlines.length) return;
  await notifyAll({
    title: "📊 Monday review ready",
    body: headlines.join(" · ").slice(0, 220),
    url: "/",
    say: `Sir, your Monday review is ready. ${spoken.join(". ")}. The crews have their assignments for the week.`,
  }).catch(() => {});
}

export const goalLabel = metricLabel;
