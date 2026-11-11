// The Command Deck: Jarvis's crews as a live map, agents handing work to each other along routes Tommy draws,
// and quick multiple-choice questions when an agent is unsure. Everything shown comes from the database: the deck
// never claims an agent is doing something it isn't.
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { getDb, schema } from "@/lib/db";
import type { Agent, Question, Task } from "@/lib/db/schema";
import { getSetting, setSetting } from "@/lib/settings";

const db = () => getDb();
const MAX_CHAIN = 3; // a piece of work can be handed on at most 3 times
const MAX_PER_TASK = 2; // and one task can hand off to at most 2 agents

// ---------- Routes (who may hand work to whom) ----------

// Sensible starting routes for the starter crews, by agent name. Tommy changes them on the deck.
export const DEFAULT_ROUTES: Record<string, string[]> = {
  Prospector: ["Outreach Writer"],
  "Outreach Writer": ["Audit Desk"],
  "Audit Desk": ["Client Success"],
  "Shop Marketer": ["Customer Care"],
  "Order Desk": ["Customer Care"],
  "Content Planner": ["Community Manager"],
  "UGC Ad Maker": ["Community Manager"],
  "Growth Analyst": ["Content Planner", "UGC Ad Maker"],
};

export function routesOf(agent: Pick<Agent, "handoffTo">): number[] {
  try {
    return (JSON.parse(agent.handoffTo || "[]") as number[]).filter((n) => Number.isInteger(n));
  } catch {
    return [];
  }
}

// Only agents of the same business; never to itself.
export function setRoutes(agentId: number, to: number[]): number[] {
  const agent = db().select().from(schema.agents).where(eq(schema.agents.id, agentId)).get();
  if (!agent) throw new Error("Agent not found.");
  const same = db().select().from(schema.agents).where(eq(schema.agents.businessId, agent.businessId!)).all();
  const allowed = [...new Set(to)].filter((id) => id !== agentId && same.some((a) => a.id === id));
  db().update(schema.agents).set({ handoffTo: JSON.stringify(allowed) }).where(eq(schema.agents.id, agentId)).run();
  return allowed;
}

// Once per crew: give agents that have no routes yet the default ones.
export function applyDefaultRoutes() {
  for (const biz of db().select().from(schema.businesses).all()) {
    const key = `routes_default:${biz.id}`;
    if (getSetting(key)) continue;
    const agents = db().select().from(schema.agents).where(eq(schema.agents.businessId, biz.id)).all();
    for (const a of agents) {
      if (routesOf(a).length) continue;
      const ids = (DEFAULT_ROUTES[a.name] ?? []).map((n) => agents.find((x) => x.name === n)?.id).filter((x): x is number => !!x);
      if (ids.length) db().update(schema.agents).set({ handoffTo: JSON.stringify(ids) }).where(eq(schema.agents.id, a.id)).run();
    }
    if (agents.length) setSetting(key, "1");
  }
}

// How many times this work has already been handed on.
export function chainDepth(task: Pick<Task, "parentTaskId">): number {
  let depth = 0;
  let parent = task.parentTaskId;
  while (parent && depth < 10) {
    depth++;
    parent = db().select({ p: schema.tasks.parentTaskId }).from(schema.tasks).where(eq(schema.tasks.id, parent)).get()?.p ?? null;
  }
  return depth;
}

// The hand_off tool an agent gets when it has routes.
export function handOffTool(agent: Agent, task: Task) {
  const targets = db()
    .select()
    .from(schema.agents)
    .where(inArray(schema.agents.id, routesOf(agent).length ? routesOf(agent) : [-1]))
    .all();
  if (!targets.length) return null;
  const names = targets.map((t) => t.name) as [string, ...string[]];
  return betaZodTool({
    name: "hand_off",
    description: `Pass finished work to the next teammate so they can take it from there. You may hand off to: ${targets.map((t) => `${t.name} (${t.job.slice(0, 90)}…)`).join("; ")}. Include everything they need; they can't see your conversation. Anything that sends, spends or posts still waits for Tommy.`,
    inputSchema: z.object({
      to: z.enum(names),
      instructions: z.string().min(20).describe("What they should do next, specifically"),
      handover: z.string().describe("The work you're passing on: lists, drafts, facts, links. Paste it in full."),
    }),
    run: async ({ to, instructions, handover }) => {
      const target = targets.find((t) => t.name === to)!;
      if (chainDepth(task) >= MAX_CHAIN) return "This work has already been handed on 3 times. Finish it yourself and put the rest in your result for Jarvis.";
      const kids = db().select().from(schema.tasks).where(eq(schema.tasks.parentTaskId, task.id)).all();
      if (kids.some((k) => k.agentId === target.id)) return `Already handed to ${to}. Don't repeat it.`;
      if (kids.length >= MAX_PER_TASK) return "You've already handed this off twice. Put anything else in your result.";
      const { createTask } = await import("@/lib/crews/crews");
      createTask(target.id, `Handed over by ${agent.name}:\n${instructions}\n\n--- What ${agent.name} passed on ---\n${handover}`, "handoff", { parentTaskId: task.id, fromAgentId: agent.id });
      return `Handed to ${to}. They'll pick it up next.`;
    },
  });
}

// ---------- Quick questions ----------

const asked = new Set<number>(); // task ids that asked a question during their current run

export function askedDuringRun(taskId: number): boolean {
  const yes = asked.has(taskId);
  asked.delete(taskId);
  return yes;
}

export function askTool(agent: Agent, task: Task) {
  return betaZodTool({
    name: "ask_tommy",
    description:
      "When the task is unclear and guessing would waste work, ask Tommy ONE short question with 2-4 answer choices. Your task pauses until he taps an answer, then you continue with it. Use it rarely; if a sensible default exists, use the default instead.",
    inputSchema: z.object({
      question: z.string().max(200),
      options: z.array(z.string().max(60)).min(2).max(4),
    }),
    run: async ({ question, options }) => {
      const open = db()
        .select()
        .from(schema.questions)
        .where(and(eq(schema.questions.taskId, task.id), eq(schema.questions.status, "open")))
        .get();
      if (open) return "You already asked Tommy a question for this task. Stop here and wait for his answer.";
      const q = db().insert(schema.questions).values({ agentId: agent.id, taskId: task.id, question, options: JSON.stringify(options), createdAt: new Date() }).returning().get();
      asked.add(task.id);
      const { notifyAll } = await import("@/lib/push");
      notifyAll({
        title: `${agent.name} has a quick question`,
        body: `${question} (${options.join(" / ")})`,
        url: `/deck?q=${q.id}`,
        tag: `question-${q.id}`,
        kind: "approval",
        say: `Sir, ${agent.name} has a quick question: ${question}`,
      }).catch(() => {});
      return "Question sent. Stop now: summarize what you've done so far in your result; you'll continue once Tommy answers.";
    },
  });
}

export function openQuestions(): (Question & { agentName: string | null; opts: string[] })[] {
  return db()
    .select({ q: schema.questions, agent: schema.agents })
    .from(schema.questions)
    .leftJoin(schema.agents, eq(schema.questions.agentId, schema.agents.id))
    .where(eq(schema.questions.status, "open"))
    .orderBy(desc(schema.questions.createdAt))
    .all()
    .map((r) => ({ ...r.q, agentName: r.agent?.name ?? null, opts: JSON.parse(r.q.options) as string[] }));
}

// Tommy tapped an answer (or typed his own): the waiting task picks up where it left off.
export function answerQuestion(id: number, answer: string): Question | undefined {
  const q = db()
    .update(schema.questions)
    .set({ answer: answer.trim().slice(0, 500), status: "answered", answeredAt: new Date() })
    .where(and(eq(schema.questions.id, id), eq(schema.questions.status, "open")))
    .returning()
    .get();
  if (!q || !q.taskId) return q;
  const task = db().select().from(schema.tasks).where(eq(schema.tasks.id, q.taskId)).get();
  if (task && task.status === "waiting") {
    db()
      .update(schema.tasks)
      .set({
        status: "queued",
        attempts: 0,
        instructions: `${task.instructions}\n\nYou asked Tommy: "${q.question}"\nHe answered: "${q.answer}"\nYour progress so far:\n${(task.result ?? "").slice(0, 3000)}\n\nContinue the task with his answer.`,
      })
      .where(eq(schema.tasks.id, task.id))
      .run();
    import("@/lib/crews/crews").then((c) => c.processQueue()).catch(() => {});
  }
  return q;
}

// ---------- The live state ----------

export type AgentState = "working" | "queued" | "question" | "approval" | "idle" | "paused" | "draft";

export function deckState(now = Date.now()) {
  const weekAgo = new Date(now - 7 * 86_400_000);
  const businesses = db().select().from(schema.businesses).all();
  const agents = db().select().from(schema.agents).all();
  const recent = db().select().from(schema.tasks).where(gte(schema.tasks.createdAt, weekAgo)).orderBy(desc(schema.tasks.createdAt)).all();
  const active = db().select().from(schema.tasks).where(inArray(schema.tasks.status, ["running", "queued", "waiting"])).all();
  const pendingApprovals = db().select().from(schema.approvals).where(eq(schema.approvals.status, "pending")).all();
  const questions = openQuestions();

  const agentView = (a: Agent) => {
    const mine = active.filter((t) => t.agentId === a.id);
    const running = mine.find((t) => t.status === "running");
    const question = questions.find((q) => q.agentId === a.id);
    const approvals = pendingApprovals.filter((p) => p.agentId === a.id).length;
    const state: AgentState =
      a.status === "draft" ? "draft" : a.status === "paused" ? "paused" : running ? "working" : question ? "question" : approvals ? "approval" : mine.some((t) => t.status === "queued") ? "queued" : "idle";
    const week = recent.filter((t) => t.agentId === a.id);
    const last = week.find((t) => t.status === "done");
    return {
      id: a.id,
      name: a.name,
      job: a.job,
      status: a.status,
      state,
      doing: (running ?? mine[0])?.instructions.split("\n")[0].slice(0, 160) ?? null,
      queued: mine.filter((t) => t.status === "queued").length,
      approvals,
      question: question ? { id: question.id, question: question.question, options: question.opts } : null,
      handoffTo: routesOf(a),
      tools: JSON.parse(a.allowedTools || "[]") as string[],
      costWeek: Math.round(week.reduce((s, t) => s + t.cost, 0) * 100) / 100,
      doneWeek: week.filter((t) => t.status === "done").length,
      last: last ? { summary: (last.review ?? last.result ?? "").slice(0, 300), at: last.finishedAt } : null,
    };
  };

  return {
    businesses: businesses.map((b) => ({ id: b.id, name: b.name, status: b.status, agents: agents.filter((a) => a.businessId === b.id).map(agentView) })),
    // Handoffs in the last 30 minutes, for the light beams on the map.
    handoffs: recent
      .filter((t) => t.fromAgentId && now - t.createdAt.getTime() < 30 * 60_000)
      .map((t) => ({ from: t.fromAgentId!, to: t.agentId!, at: t.createdAt, taskId: t.id, status: t.status })),
    questions: questions.map((q) => ({ id: q.id, agent: q.agentName, question: q.question, options: q.opts, at: q.createdAt })),
  };
}
