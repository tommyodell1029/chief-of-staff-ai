// The Crew Template Pack: ready-made crews for common business types, sold as an add-on file (Stan Store order bump).
// The owner uploads the pack file once; then "Use this template" asks for the business name (and area/offer where it
// matters) and builds the business with its crew as drafts. Nothing runs until Launch / approval, like every crew.
import { eq } from "drizzle-orm";
import { z } from "zod";
import { AGENT_MODELS, CREW_TOOLS, type CrewTool } from "@/config/business";
import { getDb, schema } from "@/lib/db";
import { getSetting, setSetting } from "@/lib/settings";
import { kitMode, kitProfile, saveKitProfile } from "./kit";
import { MODULES, type KitProfile } from "./profile";

const agentSchema = z.object({
  name: z.string().min(1),
  job: z.string().min(20),
  model: z.enum(["writer", "worker"]),
  tools: z.array(z.enum(CREW_TOOLS as [CrewTool, ...CrewTool[]])),
});

export const templateSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  name: z.string(),
  category: z.string(),
  summary: z.string(),
  goodFor: z.string(),
  ownerDoes: z.array(z.string()),
  startupCost: z.string(),
  needsArea: z.boolean().default(false),
  offerLabel: z.string().optional(), // shown as the question for {offer}, e.g. "What do you sell, and for how much?"
  modules: z.array(z.enum(MODULES)).min(1),
  agents: z.array(agentSchema).min(1),
  handoffs: z.array(z.tuple([z.string(), z.string()])).default([]),
  outreach: z.object({ target: z.string(), offer: z.string() }).optional(),
  firstSteps: z.array(z.string()),
});
export type CrewPackTemplate = z.infer<typeof templateSchema>;

export const packSchema = z.object({
  pack: z.literal("crew-template-pack"),
  version: z.number().int(),
  title: z.string(),
  templates: z.array(templateSchema).min(1),
});
export type CrewPack = z.infer<typeof packSchema>;

const KEY = "template_pack";

export function importPack(raw: unknown): CrewPack {
  const r = packSchema.safeParse(typeof raw === "string" ? JSON.parse(raw) : raw);
  if (!r.success) throw new Error("That isn't a Crew Template Pack file. Upload the .json file from your purchase.");
  const ids = new Set<string>();
  for (const t of r.data.templates) {
    if (ids.has(t.id)) throw new Error(`The pack has two templates with the id "${t.id}".`);
    ids.add(t.id);
    const names = new Set(t.agents.map((a) => a.name));
    for (const [a, b] of t.handoffs) if (!names.has(a) || !names.has(b)) throw new Error(`Template "${t.name}" hands off between agents it doesn't have.`);
  }
  setSetting(KEY, JSON.stringify(r.data));
  return r.data;
}

export function templatePack(): CrewPack | null {
  try {
    const raw = getSetting(KEY);
    return raw ? packSchema.parse(JSON.parse(raw)) : null;
  } catch {
    return null;
  }
}

const fillIn = (text: string, v: { business: string; area: string; offer: string }) =>
  text.replaceAll("{business}", v.business).replaceAll("{area}", v.area).replaceAll("{offer}", v.offer);

// Builds the business and its crew from a template (all drafts). Returns a short confirmation.
export function applyTemplate(id: string, input: { name: string; area?: string; offer?: string }): string {
  const pack = templatePack();
  const t = pack?.templates.find((x) => x.id === id);
  if (!t) throw new Error("Upload the Crew Template Pack first, then pick a template.");
  const name = input.name.trim().slice(0, 80);
  if (name.length < 2) throw new Error("Give the business a name.");
  if (t.needsArea && !input.area?.trim()) throw new Error("This template works locally: add the city or area your customers are in.");
  const db = getDb();
  if (db.select().from(schema.businesses).where(eq(schema.businesses.name, name)).get()) throw new Error(`You already have a business called "${name}".`);
  const v = { business: name, area: input.area?.trim() || "your area", offer: input.offer?.trim() || "the offer in the campaign brief" };

  const notes = [fillIn(t.summary, v), input.offer?.trim() && `Offer: ${input.offer.trim()}`, input.area?.trim() && `Area: ${input.area.trim()}`, `First steps: ${t.firstSteps.join("; ")}`]
    .filter(Boolean)
    .join(" ");
  const biz = db.insert(schema.businesses).values({ name, status: "draft", notes }).returning().get();
  const ids = new Map<string, number>();
  for (const a of t.agents) {
    const row = db
      .insert(schema.agents)
      .values({ businessId: biz.id, name: a.name, job: fillIn(a.job, v), systemPrompt: "", model: AGENT_MODELS[a.model].id, allowedTools: JSON.stringify(a.tools), autonomyLevel: "approval_required", status: "draft" })
      .returning()
      .get();
    ids.set(a.name, row.id);
  }
  const routes = new Map<number, number[]>();
  for (const [from, to] of t.handoffs) routes.set(ids.get(from)!, [...(routes.get(ids.get(from)!) ?? []), ids.get(to)!]);
  for (const [from, to] of routes) db.update(schema.agents).set({ handoffTo: JSON.stringify(to) }).where(eq(schema.agents.id, from)).run();
  setSetting(`routes_default:${biz.id}`, "1");

  // Outreach templates get a draft campaign (approved at Launch), like a setup file's outreach.
  const outreach = t.outreach ? { business: name, target: fillIn(t.outreach.target, v), offer: input.offer?.trim() || fillIn(t.outreach.offer, v) } : null;
  if (outreach && !db.select().from(schema.campaigns).all().some((c) => c.businessId === biz.id)) {
    db.insert(schema.campaigns)
      .values({
        businessId: biz.id,
        name: `${name} outreach`,
        brief: `Who: ${outreach.target}\nOffer: ${outreach.offer}\nTone: friendly, specific, short. No income claims or guarantees.`,
        status: "draft",
        dailyLimit: 5,
        sendVia: process.env.SALESHANDY_API_KEY ? "saleshandy" : "jarvis",
      })
      .run();
  }

  // On a client's assistant, the setup file learns about the new business (Autopilot lanes, Launch checks).
  const p = kitProfile();
  if (kitMode() && p) {
    const business: KitProfile["businesses"][number] = { name, summary: fillIn(t.summary, v), offer: input.offer?.trim() || undefined, area: input.area?.trim() || undefined, modules: t.modules };
    const next: KitProfile = { ...p, businesses: [...p.businesses, business] };
    if (outreach && !next.outreach) next.outreach = { ...outreach, mailboxes: 1, warmupDays: 21 };
    saveKitProfile(next);
  }
  return `${name} is set up from the ${t.name} template: ${t.agents.map((a) => a.name).join(", ")} (drafts). Nothing runs until you approve it.`;
}
