// Done-for-you builds (Chief of Staff AI). One card per client:
//   kickoff call notes → Jarvis turns them into the client's setup file (lib/kit/profile.ts) and a build checklist →
//   Tommy works the checklist (accounts, deploy, voice, outreach domain + warm-up) → the client presses Launch.
import { desc, eq } from "drizzle-orm";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { MODELS } from "@/config/models";
import { runJob } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import type { Build } from "@/lib/db/schema";
import { MODULE_LABELS, parseProfile, profileSchema, warmupReadyDate, type KitProfile } from "@/lib/kit/profile";

const db = () => getDb();
export const STATUSES = ["kickoff", "building", "warming", "ready", "launched", "paused"] as const;

export interface CheckItem {
  id: string;
  group: string;
  label: string;
  done: boolean;
}

export function listBuilds(): Build[] {
  return db().select().from(schema.builds).orderBy(desc(schema.builds.createdAt)).all();
}
export function getBuild(id: number) {
  return db().select().from(schema.builds).where(eq(schema.builds.id, id)).get();
}
export function createBuild(client: string, email?: string): Build {
  return db()
    .insert(schema.builds)
    .values({ client: client.trim(), email: email?.trim() || null, checklist: JSON.stringify(checklistFor(null)), createdAt: new Date(), updatedAt: new Date() })
    .returning()
    .get();
}

export const planOf = (b: Build): KitProfile | null => (b.plan ? parseProfile(JSON.parse(b.plan)) : null);
export const checklistOf = (b: Build): CheckItem[] => JSON.parse(b.checklist || "[]") as CheckItem[];

// Everything a build needs, from the plan. Items keep stable ids so ticks survive a re-plan.
export function checklistFor(p: KitProfile | null): CheckItem[] {
  const items: Omit<CheckItem, "done">[] = [];
  const add = (group: string, id: string, label: string) => items.push({ group, id, label });
  const mods = new Set(p?.businesses.flatMap((b) => b.modules) ?? []);
  add("Kickoff", "call", "Kickoff call done and notes added");
  add("Kickoff", "plan", "Setup file reviewed with the client");
  add("Client accounts (in their name, they invite you)", "render", "Render account created, you invited to it");
  add("Client accounts (in their name, they invite you)", "anthropic", "AI key added to Render by the client (Anthropic, or OpenRouter)");
  add("Client accounts (in their name, they invite you)", "elevenlabs", "ElevenLabs account and key added by the client");
  if (mods.has("outreach")) {
    add("Client accounts (in their name, they invite you)", "domain", `Sending domain bought${p?.outreach?.sendingDomain ? ` (${p.outreach.sendingDomain})` : ""}, never their main domain`);
    add("Client accounts (in their name, they invite you)", "workspace", `Google Workspace on the sending domain, ${p?.outreach?.mailboxes ?? 1} mailbox${(p?.outreach?.mailboxes ?? 1) === 1 ? "" : "es"}, you invited as admin`);
    add("Client accounts (in their name, they invite you)", "saleshandy", "Saleshandy account, you invited as a team member");
  }
  if (mods.has("maps")) add("Client accounts (in their name, they invite you)", "gbp", "You added as a manager on their Google Business Profile");
  if (mods.has("etsy")) add("Client accounts (in their name, they invite you)", "etsy", "Etsy and Printify connected by the client");
  add("Build the assistant", "deploy", "Assistant deployed on their Render (KIT_MODE=1)");
  add("Build the assistant", "import", "Setup file imported (assistant named, crews created)");
  add("Build the assistant", "voice", `Voice designed in ElevenLabs and ELEVENLABS_VOICE_ID set${p?.assistant.voice ? ` (${p.assistant.voice.slice(0, 60)})` : ""}`);
  add("Build the assistant", "google", "Gmail and Calendar connected");
  add("Build the assistant", "telegram", "Telegram connected (optional)");
  if (mods.has("outreach")) {
    add("Outreach", "dns", "SPF, DKIM and DMARC records green on the sending domain");
    add("Outreach", "tracking", "Custom tracking domain set, open tracking off");
    add("Outreach", "warmup", "Warm-up started (set the start date below)");
    add("Outreach", "footer", "Sender name, postal address and unsubscribe line in the footer");
    add("Outreach", "sequence", "Sequence written and approved by the client");
    add("Outreach", "prospects", "First 20+ prospects found and checked");
  }
  if (mods.has("maps")) add("Business setup", "maps-audit", "First Google Maps audit run for their business");
  if (mods.has("etsy")) add("Business setup", "etsy-shop", "Shop listings reviewed; holiday or seasonal plan set");
  if (mods.has("social")) add("Business setup", "social", "Content style agreed (look, voice, platforms)");
  add("Launch", "walkthrough", "Walkthrough call booked");
  add("Launch", "launched", "Client pressed Launch");
  return items.map((i) => ({ ...i, done: false }));
}

function save(id: number, changes: Partial<Build>) {
  return db().update(schema.builds).set({ ...changes, updatedAt: new Date() }).where(eq(schema.builds.id, id)).returning().get();
}

export function setPlan(id: number, plan: KitProfile): Build {
  const b = getBuild(id);
  if (!b) throw new Error("Build not found.");
  const old = new Map(checklistOf(b).map((i) => [i.id, i.done]));
  const items = checklistFor(plan).map((i) => ({ ...i, done: !!old.get(i.id) || i.id === "call" }));
  // Keep the warm-up start date when the setup file is re-made from the notes.
  const prev = b.plan ? (JSON.parse(b.plan) as KitProfile) : null;
  if (plan.outreach && !plan.outreach.warmupStart && prev?.outreach?.warmupStart) plan.outreach.warmupStart = prev.outreach.warmupStart;
  return save(id, { plan: JSON.stringify(plan), checklist: JSON.stringify(items), status: b.status === "kickoff" ? "building" : b.status });
}

// Kickoff call notes → the setup file, written by the AI (Tommy reviews it with the client).
export async function planFromNotes(id: number, notes: string): Promise<Build> {
  const b = getBuild(id);
  if (!b) throw new Error("Build not found.");
  save(id, { notes });
  let plan: KitProfile | null = null;
  const tool = betaZodTool({
    name: "save_setup",
    description: "Save the client's setup file.",
    inputSchema: profileSchema,
    run: async (p) => {
      plan = parseProfile(p);
      return "Saved.";
    },
  });
  await runJob({
    purpose: "build_plan",
    model: MODELS.writer,
    system: `You turn the notes from a kickoff call into a client's setup file for their AI assistant (a done-for-you build). Use only what the notes say; where something wasn't decided, leave optional fields out rather than inventing them. Pick modules per business from: ${Object.entries(MODULE_LABELS)
      .map(([k, v]) => `${k} (${v})`)
      .join(", ")}. Keep sentences short and plain. Call save_setup exactly once.`,
    prompt: `Client: ${b.client}${b.email ? ` <${b.email}>` : ""}\n\nCall notes:\n${notes.slice(0, 12_000)}`,
    tools: [tool],
    maxIterations: 3,
    maxTokens: 4000,
  });
  if (!plan) throw new Error("Couldn't turn those notes into a setup file. Add a bit more detail and try again.");
  return setPlan(id, plan);
}

export function toggleItem(id: number, itemId: string, done: boolean): Build {
  const b = getBuild(id);
  if (!b) throw new Error("Build not found.");
  const items = checklistOf(b).map((i) => (i.id === itemId ? { ...i, done } : i));
  const changes: Partial<Build> = { checklist: JSON.stringify(items) };
  if (itemId === "launched" && done) Object.assign(changes, { status: "launched", launchedAt: new Date() });
  return save(id, changes);
}

export function setWarmupStart(id: number, date: string): Build {
  const b = getBuild(id);
  const plan = b && planOf(b);
  if (!plan?.outreach) throw new Error("This build has no outreach in its plan.");
  plan.outreach.warmupStart = date;
  const items = checklistOf(b!).map((i) => (i.id === "warmup" ? { ...i, done: true } : i));
  return save(id, { plan: JSON.stringify(plan), checklist: JSON.stringify(items), status: b!.status === "launched" ? "launched" : "warming" });
}

export function setStatus(id: number, status: (typeof STATUSES)[number]) {
  return save(id, { status });
}

export function nextStep(b: Build): CheckItem | null {
  return checklistOf(b).find((i) => !i.done) ?? null;
}

export function buildView(b: Build) {
  const plan = planOf(b);
  const items = checklistOf(b);
  const ready = plan ? warmupReadyDate(plan) : null;
  return {
    ...b,
    plan,
    checklist: items,
    progress: items.length ? Math.round((items.filter((i) => i.done).length / items.length) * 100) : 0,
    next: nextStep(b),
    warmupReady: ready ? ready.toISOString() : null,
    warmupDaysLeft: ready ? Math.max(0, Math.ceil((ready.getTime() - Date.now()) / 86_400_000)) : null,
  };
}

// Every morning: warm-ups that just finished, and builds that have sat still for 4+ days.
export async function buildsTick(now = Date.now()) {
  const { notifyAll } = await import("@/lib/push");
  const { getSetting, setSetting } = await import("@/lib/settings");
  for (const b of listBuilds()) {
    if (b.status === "launched" || b.status === "paused") continue;
    const plan = planOf(b);
    const ready = plan ? warmupReadyDate(plan) : null;
    if (ready && ready.getTime() <= now && !getSetting(`build_warm:${b.id}`)) {
      setSetting(`build_warm:${b.id}`, "1");
      if (b.status === "warming") save(b.id, { status: "ready" });
      await notifyAll({ title: `${b.client}: warm-up done`, body: "Their mailboxes are warmed up. Finish the checklist and book the launch call.", url: "/builds", tag: `build-${b.id}` }).catch(() => {});
      continue;
    }
    const idle = now - (b.updatedAt ?? b.createdAt).getTime();
    const key = `build_nudge:${b.id}:${new Date(now).toISOString().slice(0, 10)}`;
    if (idle > 4 * 86_400_000 && !getSetting(key)) {
      setSetting(key, "1");
      const step = nextStep(b);
      if (step) await notifyAll({ title: `${b.client}'s build is waiting`, body: `Next: ${step.label}`, url: "/builds", tag: `build-${b.id}`, station: false }).catch(() => {});
    }
  }
}
