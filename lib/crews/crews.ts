// Business crews: businesses, their specialist agents, the task queue, Jarvis's review, and the approval gate.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { AGENCY_NAME, AGENCY_NOTES, AGENCY_OLD_NAMES, AGENCY_OLD_TEXT, AGENT_MODELS, NINA_NOTES, NINA_OLD_TEXT, BUSINESS_CONTEXT, STARTER_CREWS, TOOL_UPGRADES, type CrewTool } from "@/config/business";
import { MODELS, type ModelChoice } from "@/config/models";
import { SpendCapError, runJob, webSearch, type AnyTool } from "@/lib/ai";
import { getDb, schema } from "@/lib/db";
import type { Agent, Business, Task } from "@/lib/db/schema";
import { addNote, listNotes } from "@/lib/growth/lab";
import { executeAction, type ApprovalAction } from "@/lib/integrations/actions";
import { createDraft, gmailConnected } from "@/lib/integrations/gmail";
import { notifyAll } from "@/lib/push";
import { instagramConfigured } from "@/lib/integrations/instagram";
import { createPost, PLATFORMS } from "@/lib/studio";
import { autopilotDone, autopilotFailed, canAutopilot, declineOffer, laneForAction, recordTrust } from "@/lib/trust";
import { applyDefaultRoutes, askedDuringRun, askTool, handOffTool } from "@/lib/crews/deck";
import { saveFileTool } from "@/lib/outbox";
import { nightBudgetLeft, nightShiftActive } from "@/lib/nightshift";
import { kitMode, kitProfile } from "@/lib/kit/kit";
import { createKitCrews } from "@/lib/kit/crews";

const db = () => getDb();

// ---------- Businesses and crews ----------

export function listBusinesses(): Business[] {
  return db().select().from(schema.businesses).orderBy(asc(schema.businesses.id)).all();
}

export function getBusiness(id: number) {
  return db().select().from(schema.businesses).where(eq(schema.businesses.id, id)).get();
}

export function listAgents(businessId: number): Agent[] {
  return db().select().from(schema.agents).where(eq(schema.agents.businessId, businessId)).orderBy(asc(schema.agents.id)).all();
}

// Creates the three planned businesses with draft crews (they don't run until Tommy approves each crew).
export function setUpStarterBusinesses() {
  if (kitMode()) {
    const p = kitProfile();
    return p ? createKitCrews(p) : 0;
  }
  const existing = new Set(listBusinesses().map((b) => b.name));
  let created = 0;
  for (const tpl of STARTER_CREWS) {
    if (existing.has(tpl.name)) continue;
    const biz = db().insert(schema.businesses).values({ name: tpl.name, status: "draft", notes: tpl.notes }).returning().get();
    for (const a of tpl.agents) {
      db()
        .insert(schema.agents)
        .values({
          businessId: biz.id,
          name: a.name,
          job: a.job,
          systemPrompt: "",
          model: AGENT_MODELS[a.model].id,
          allowedTools: JSON.stringify(a.tools),
          autonomyLevel: a.autonomy,
          status: "draft",
        })
        .run();
    }
    created++;
  }
  applyDefaultRoutes();
  return created;
}

// Renames the agency if it was created under an older name (e.g. "Local Business Agency" → "LaunchPad Local").
export function applyRenames() {
  for (const old of AGENCY_OLD_NAMES) {
    const notes = STARTER_CREWS.find((c) => c.name === AGENCY_NAME)?.notes;
    db()
      .update(schema.businesses)
      .set({ name: AGENCY_NAME, ...(notes ? { notes } : {}) })
      .where(eq(schema.businesses.name, old))
      .run();
  }
}

// Brings a saved agency crew up to date with what yourbusiness.com sells: refreshes the crew notes and any agent job
// that still has an older default word for word (Tommy's own edits are kept), and adds agents the crew didn't have yet.
export function applyAgencyRefresh() {
  const biz = listBusinesses().find((b) => b.name === AGENCY_NAME);
  if (!biz) return;
  if (!biz.notes || AGENCY_OLD_TEXT.notes.includes(biz.notes)) {
    db().update(schema.businesses).set({ notes: AGENCY_NOTES }).where(eq(schema.businesses.id, biz.id)).run();
  }
  const tpl = STARTER_CREWS.find((c) => c.name === AGENCY_NAME);
  const agents = listAgents(biz.id);
  for (const a of agents) {
    const fresh = tpl?.agents.find((t) => t.name === a.name)?.job;
    if (fresh && AGENCY_OLD_TEXT.jobs[a.name]?.includes(a.job)) {
      db().update(schema.agents).set({ job: fresh }).where(eq(schema.agents.id, a.id)).run();
    }
  }
  for (const t of tpl?.agents ?? []) {
    // Added once; if Tommy deletes it later it stays deleted.
    const key = `agency_agent_added:${t.name}`;
    if (db().select().from(schema.settings).where(eq(schema.settings.key, key)).get()) continue;
    if (agents.some((a) => a.name === t.name)) {
      db().insert(schema.settings).values({ key, value: "1" }).run();
      continue;
    }
    db()
      .insert(schema.agents)
      .values({
        businessId: biz.id,
        name: t.name,
        job: t.job,
        systemPrompt: "",
        model: AGENT_MODELS[t.model].id,
        allowedTools: JSON.stringify(t.tools),
        autonomyLevel: t.autonomy,
        status: biz.status === "active" ? "active" : biz.status === "paused" ? "paused" : "draft",
      })
      .run();
    db().insert(schema.settings).values({ key, value: "1" }).run();
  }
}

// Instagram posts go out automatically and are covered by Nina's account-level AI label; the platforms Tommy
// posts by hand get a reminder to flip their AI toggle.
function aiLabelNote(platforms: string[]): string {
  const igAuto = instagramConfigured();
  const hand = platforms.filter((x) => x !== "instagram" || !igAuto);
  const names: Record<string, string> = { instagram: "Instagram: Advanced settings → AI label", tiktok: "TikTok: AI-generated content", reddit: "Reddit: AI flair if the subreddit has one", fanvue: "Fanvue: AI content setting" };
  const parts = [
    platforms.includes("instagram") && igAuto ? "Instagram: covered by the account's AI label (keep it on)." : "",
    hand.length ? `When posting by hand, turn on the AI label (${hand.map((x) => names[x] ?? x).join("; ")}).` : "",
  ];
  return parts.filter(Boolean).join(" ");
}

// Brings a saved Nina crew up to the current template: notes and jobs still on an older default are updated
// (Tommy's own edits are kept), and new agents are added once (if Tommy deletes one later it stays deleted).
export function applyNinaRefresh() {
  const nina = listBusinesses().find((b) => /nina/i.test(b.name));
  if (!nina) return;
  if (!nina.notes || NINA_OLD_TEXT.notes.includes(nina.notes)) {
    db().update(schema.businesses).set({ notes: NINA_NOTES }).where(eq(schema.businesses.id, nina.id)).run();
  }
  const tpl = STARTER_CREWS.find((c) => /nina/i.test(c.name));
  const agents = listAgents(nina.id);
  for (const a of agents) {
    const fresh = tpl?.agents.find((t) => t.name === a.name)?.job;
    if (fresh && NINA_OLD_TEXT.jobs[a.name]?.includes(a.job)) db().update(schema.agents).set({ job: fresh }).where(eq(schema.agents.id, a.id)).run();
  }
  for (const t of tpl?.agents ?? []) {
    const key = `nina_agent_added:${t.name}`;
    if (db().select().from(schema.settings).where(eq(schema.settings.key, key)).get()) continue;
    if (!agents.some((a) => a.name === t.name)) {
      db()
        .insert(schema.agents)
        .values({
          businessId: nina.id,
          name: t.name,
          job: t.job,
          systemPrompt: "",
          model: AGENT_MODELS[t.model].id,
          allowedTools: JSON.stringify(t.tools),
          autonomyLevel: t.autonomy,
          status: nina.status === "active" ? "active" : nina.status === "paused" ? "paused" : "draft",
        })
        .run();
    }
    db().insert(schema.settings).values({ key, value: "1" }).run();
  }
}

// Ads for Tommy's own Etsy shop are always labeled up front (FTC: a material connection must be clear).
export function labelAd(caption: string): string {
  const c = caption.trim();
  return /^(#?ad\b|ad\s*[:·|-])/i.test(c) ? c : `Ad · ${c}`;
}

// Gives existing agents tools Jarvis gained after their crew was created. Runs once per upgrade at startup.
export function applyToolUpgrades() {
  for (const agent of db().select().from(schema.agents).all()) {
    const tools = JSON.parse(agent.allowedTools || "[]") as CrewTool[];
    const add = TOOL_UPGRADES.filter((u) => u.agent === agent.name && !tools.includes(u.tool)).map((u) => u.tool);
    if (!add.length) continue;
    const key = `upgraded:${agent.id}:${add.join(",")}`;
    if (db().select().from(schema.settings).where(eq(schema.settings.key, key)).get()) continue;
    db().update(schema.agents).set({ allowedTools: JSON.stringify([...tools, ...add]) }).where(eq(schema.agents.id, agent.id)).run();
    db().insert(schema.settings).values({ key, value: "1" }).run();
  }
}

export function setCrewStatus(businessId: number, status: "active" | "paused") {
  db().update(schema.businesses).set({ status }).where(eq(schema.businesses.id, businessId)).run();
  db().update(schema.agents).set({ status }).where(eq(schema.agents.businessId, businessId)).run();
}

export function updateAgent(id: number, changes: Partial<Pick<Agent, "job" | "model" | "autonomyLevel" | "allowedTools" | "name">>) {
  return db().update(schema.agents).set(changes).where(eq(schema.agents.id, id)).returning().get();
}

// Finds a business and agent by (partial, case-insensitive) name, for Jarvis's delegate_to_crew tool.
export function findAgent(businessName: string, agentName: string): { business?: Business; agent?: Agent } {
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "");
  const business = listBusinesses().find((b) => norm(b.name).includes(norm(businessName)) || norm(businessName).includes(norm(b.name)));
  if (!business) return {};
  const agent = listAgents(business.id).find((a) => norm(a.name).includes(norm(agentName)) || norm(agentName).includes(norm(a.name)));
  return { business, agent };
}

export function crewDirectory(): string {
  const lines: string[] = [];
  for (const b of listBusinesses()) {
    lines.push(`${b.name} [${b.status}]`);
    for (const a of listAgents(b.id)) lines.push(`  - ${a.name}: ${a.job}`);
  }
  return lines.join("\n") || "(no businesses set up yet)";
}

// ---------- Tasks ----------

export function createTask(
  agentId: number,
  instructions: string,
  requestedBy: "jarvis" | "tommy" | "schedule" | "handoff" = "jarvis",
  from?: { parentTaskId: number; fromAgentId: number },
): Task {
  const task = db()
    .insert(schema.tasks)
    .values({ agentId, instructions, requestedBy, parentTaskId: from?.parentTaskId ?? null, fromAgentId: from?.fromAgentId ?? null, createdAt: new Date() })
    .returning()
    .get();
  setImmediate(() => processQueue().catch((err) => console.error("[crews] queue error:", err)));
  return task;
}

export function listTasks(opts: { businessId?: number; limit?: number; since?: Date } = {}) {
  const t = schema.tasks;
  const agentIds = opts.businessId ? listAgents(opts.businessId).map((a) => a.id) : undefined;
  if (agentIds && agentIds.length === 0) return [];
  const conds = [
    ...(agentIds ? [inArray(t.agentId, agentIds)] : []),
    ...(opts.since ? [gte(t.createdAt, opts.since)] : []),
  ];
  return db()
    .select({ task: t, agent: schema.agents })
    .from(t)
    .leftJoin(schema.agents, eq(t.agentId, schema.agents.id))
    .where(conds.length ? and(...conds) : undefined)
    .orderBy(desc(t.createdAt))
    .limit(opts.limit ?? 50)
    .all();
}

let queueRunning = false;

// Runs queued tasks one at a time. Called after a task is created and every minute by the scheduler.
export async function processQueue() {
  if (queueRunning) return;
  queueRunning = true;
  try {
    for (;;) {
      const next = db()
        .select({ task: schema.tasks, agent: schema.agents })
        .from(schema.tasks)
        .innerJoin(schema.agents, eq(schema.tasks.agentId, schema.agents.id))
        .where(and(eq(schema.tasks.status, "queued"), eq(schema.agents.status, "active")))
        .orderBy(asc(schema.tasks.createdAt))
        .limit(1)
        .get();
      if (!next) break;
      if (nightShiftActive() && nightBudgetLeft() <= 0) break; // tonight's budget is used up
      try {
        await runTask(next.task, next.agent);
      } catch (err) {
        if (err instanceof SpendCapError) {
          console.log("[crews] spending cap reached; tasks wait until it resets");
          break;
        }
        console.error(`[crews] task #${next.task.id} failed:`, err);
        db()
          .update(schema.tasks)
          .set({ status: "failed", result: `Failed: ${err instanceof Error ? err.message : String(err)}`, finishedAt: new Date() })
          .where(eq(schema.tasks.id, next.task.id))
          .run();
      }
    }
  } finally {
    queueRunning = false;
  }
}

function agentTools(agent: Agent, task: Task): AnyTool[] {
  const allowed = JSON.parse(agent.allowedTools || "[]") as CrewTool[];
  const tools: AnyTool[] = [];
  if (allowed.includes("web_search")) tools.push(webSearch(agent.model, 4));
  if (allowed.includes("maps_search")) {
    tools.push(
      betaZodTool({
        name: "maps_search",
        description:
          "Search Google Maps like a customer would, e.g. 'plumber in Jacksonville, FL'. Returns up to 20 businesses in Google's own order (#1–3 ≈ the map pack) with website, phone, rating, review count, newest review age, hours and photos. Limited searches per day, so pick queries carefully and don't repeat one.",
        inputSchema: z.object({ query: z.string().min(3).describe("Trade + area, e.g. 'roofing contractor in Orange Park, FL'") }),
        run: async ({ query }) => {
          const { searchMaps, describePlaces, mapsConfigured } = await import("@/lib/integrations/places");
          if (!mapsConfigured()) return "Google Maps search isn't set up (no Google key). Use web_search instead.";
          try {
            return describePlaces(query, await searchMaps(query));
          } catch (err) {
            return `${err instanceof Error ? err.message : String(err)} Use web_search instead for now.`;
          }
        },
      }),
    );
  }
  if (allowed.includes("save_note")) {
    tools.push(
      betaZodTool({
        name: "save_note",
        description: "Save something worth remembering to your own notebook page (you'll see your recent notes next time).",
        inputSchema: z.object({ title: z.string(), body: z.string(), sources: z.array(z.string()).optional() }),
        run: async ({ title, body, sources }) => {
          addNote(`agent:${agent.id}`, title, body, sources ?? []);
          return "Saved.";
        },
      }),
    );
  }
  if (allowed.includes("request_approval")) {
    tools.push(
      betaZodTool({
        name: "request_approval",
        description:
          "Ask Tommy to approve an action that would send, spend, post, sign or delete anything. You cannot do these yourself; describe exactly what should happen.",
        inputSchema: z.object({
          what: z.string().describe("Exactly what would be done, e.g. 'Send this email to Bob's HVAC: …'"),
          why: z.string().describe("Why it's worth doing, in one or two sentences"),
        }),
        run: async ({ what, why }) => {
          const a = createApproval({ what, why, agentId: agent.id, taskId: task.id });
          return `Approval request #${a.id} sent to Tommy. Don't wait for it; finish your task and mention it in your result.`;
        },
      }),
    );
  }
  if (allowed.includes("email_draft")) {
    tools.push(
      betaZodTool({
        name: "email_draft",
        description:
          "Save an email as a draft in Tommy's Gmail and ask him to approve sending it. Nothing is sent until he taps Approve.",
        inputSchema: z.object({
          to: z.string().describe("Recipient email address"),
          subject: z.string(),
          body: z.string().describe("Plain-text email body, signed as Tommy"),
          why: z.string().describe("One sentence: why this email is worth sending"),
        }),
        run: async ({ to, subject, body, why }) => {
          if (!gmailConnected()) return "Gmail isn't connected yet. Include the full email in your result so Tommy can send it himself.";
          const draft = await createDraft(to, subject, body);
          const a = createApproval({
            what: `Send email to ${to}: "${subject}"`,
            why,
            agentId: agent.id,
            taskId: task.id,
            action: { type: "gmail_send", draftId: draft.id, to, subject },
          });
          if (a.status === "approved") return `Draft saved in Gmail and sent on autopilot (Tommy's trust ladder allows these). Approval #${a.id} logs it.`;
          return `Draft saved in Gmail and approval #${a.id} requested. It will be sent only if Tommy approves.`;
        },
      }),
    );
  }
  if (allowed.includes("create_post")) {
    tools.push(
      betaZodTool({
        name: "create_post",
        description:
          "Create a Nina Studio post for Tommy to approve: an image (described in image_prompt; her look is added automatically), a caption and hashtags. SFW only. After approval Tommy gets a reminder at a good posting time and shares it from his phone (Instagram goes out automatically only if it's connected).",
        inputSchema: z.object({
          platforms: z.array(z.enum(PLATFORMS)).min(1),
          caption: z.string().describe("The post caption, written as Nina (no hashtags here). Never mention AI, 'virtual' or 'not real': the AI label is the platform's toggle."),
          hashtags: z.string().optional().describe("Space-separated hashtags, at most 5 (Instagram and TikTok allow 5). Pick the 5 most relevant. No AI tags (#ai, #aiinfluencer, #aimodel…)."),
          image_prompt: z.string().describe("The scene: setting, outfit, pose, mood, camera angle. Safe for work."),
          voiceover_text: z.string().optional().describe("Always write one: what Nina says out loud in the reel, 1-3 short sentences (about 10-15 seconds), casual and in her voice, hooking in the first words. Every post becomes a reel with her voice; without a script, her caption is read instead."),
          notes: z.string().optional().describe("Posting notes: best time, which subreddit (only ones that allow AI content), etc. A reminder to turn on the AI label is added automatically."),
          ad: z.boolean().optional().describe("true for an ad for Tommy's Etsy shop: the caption gets an 'Ad' label and the notes get the disclosure steps"),
        }),
        run: async (p) => {
          const AI_TAG = /#(ai|aiinfluencer|aimodel|aiart|aigirl|aigenerated|virtualinfluencer|virtualmodel|aibeauty)\b/gi;
          p = {
            ...p,
            hashtags: p.hashtags?.replace(AI_TAG, "").replace(/\s+/g, " ").trim(),
            caption: p.ad ? labelAd(p.caption) : p.caption,
            notes: [
              p.notes,
              p.ad ? "Ad for the Etsy shop: keep the 'Ad' label at the start of the caption, make sure the shop link is in Nina's bio, and on TikTok turn on Content disclosure → Your brand." : "",
              aiLabelNote(p.platforms),
            ]
              .filter(Boolean)
              .join(" "),
          };
          const item = await createPost(
            {
              platforms: p.platforms,
              caption: p.caption,
              hashtags: p.hashtags,
              imagePrompt: p.image_prompt,
              voiceoverText: p.voiceover_text,
              notes: p.notes,
            },
            agent.businessId ?? undefined,
            { fromCrew: true },
          );
          if (item.status !== "draft") return `Post #${item.id} created and approved on autopilot (Tommy's trust ladder allows these)${item.error ? ` (note: ${item.error})` : ""}.`;
          return `Post #${item.id} created for Tommy's review${item.error ? ` (note: ${item.error})` : ""}.`;
        },
      }),
    );
  }
  if (allowed.includes("create_listing")) {
    tools.push(
      betaZodTool({
        name: "create_listing",
        description:
          "Create an Etsy listing from one of Tommy's Printify templates, with an example design (generated from design_prompt) so the mockups show what buyers get. Published after Tommy approves (or right away if he turned on auto-publish).",
        inputSchema: z.object({
          template: z.string().describe("Template name from the list in your instructions, e.g. 'Mug 11oz'"),
          title: z.string().max(140).describe("SEO title, most important words first"),
          description: z.string().describe("Tell buyers to upload their photo at checkout, what they'll get, sizes, turnaround"),
          tags: z.array(z.string().max(20)).max(13),
          price_usd: z.number().positive().optional(),
          design_prompt: z.string().describe("The example design to show on the mockup, e.g. 'watercolor portrait of a golden retriever, soft pastel background'"),
        }),
        run: async (l) => {
          const { listTemplates, createFromTemplate, productMockup } = await import("@/lib/integrations/printify");
          const { generateImage } = await import("@/lib/integrations/gemini");
          const templates = await listTemplates();
          const t = templates.find((x) => x.title.toLowerCase().includes(l.template.toLowerCase())) ?? templates[0];
          if (!t) return "No Printify templates found. Tommy needs to make one product per type whose title starts with TEMPLATE.";
          const image = await generateImage(
            `${l.design_prompt}. Print-ready artwork for a custom photo gift, centered, clean edges, no text unless asked, no logos or trademarked characters.`,
            [],
            "1:1",
          );
          const productId = await createFromTemplate({ templateId: t.id, image, title: l.title, description: l.description, tags: l.tags, priceUsd: l.price_usd });
          const mockup = await productMockup(productId).catch(() => null);
          const a = createApproval({
            what: `Publish Etsy listing: "${l.title}" (${t.title}${l.price_usd ? `, $${l.price_usd}` : ""})${mockup ? `\nMockup: ${mockup}` : ""}`,
            why: "Created by the Shop Marketer from your Printify template. Approve to publish it to Etsy ($0.20 listing fee).",
            agentId: agent.id,
            taskId: task.id,
            action: { type: "printify_publish", productId, title: l.title },
          });
          if (a.status === "approved") return `Listing created in Printify and being published on autopilot (Tommy turned on auto-publish). Approval #${a.id} logs it.`;
          return `Listing created in Printify (not live yet); approval #${a.id} asks Tommy to publish it.`;
        },
      }),
    );
  }
  if (allowed.includes("add_leads")) {
    tools.push(
      betaZodTool({
        name: "add_leads",
        description:
          "Add qualified companies to an outreach campaign. Jarvis then finds each decision-maker's verified email automatically. Give the company's real website domain.",
        inputSchema: z.object({
          campaign: z.string().optional().describe("Campaign name; defaults to the newest active or draft campaign"),
          companies: z
            .array(
              z.object({
                company: z.string(),
                domain: z.string(),
                city: z.string().optional(),
                phone: z.string().optional(),
                notes: z.string().optional().describe("Why they qualify: facts from Google Maps"),
              }),
            )
            .min(1)
            .max(50),
        }),
        run: async ({ campaign, companies }) => {
          const { listCampaigns, addLeads } = await import("@/lib/outreach/outreach");
          const open = listCampaigns().filter((c) => c.status !== "stopped");
          const target = campaign ? open.find((c) => c.name.toLowerCase().includes(campaign.toLowerCase())) : open[0];
          if (!target) return "There's no outreach campaign yet. Put the companies in your result; Jarvis will set up a campaign.";
          const added = addLeads(target.id, companies);
          return `Added ${added} new companies to "${target.name}" (duplicates and past opt-outs skipped). Emails are being found now.`;
        },
      }),
    );
  }
  // Every agent can ask Tommy one quick question and save files to his Outbox; agents with routes can pass
  // work on (Command Deck).
  tools.push(askTool(agent, task), saveFileTool(agent, task));
  const handOff = handOffTool(agent, task);
  if (handOff) tools.push(handOff);
  return tools;
}

function agentSystem(agent: Agent, business: Business | undefined, extra = ""): string {
  const notes = listNotes(5, `agent:${agent.id}`)
    .map((n) => `- ${n.title}: ${n.body.slice(0, 400)}`)
    .join("\n");
  return `You are "${agent.name}", a specialist on Jarvis's team for the business "${business?.name ?? "?"}". You have ONE job:
${agent.job}
${agent.systemPrompt ? `\n${agent.systemPrompt}\n` : ""}
Business notes: ${business?.notes ?? ""}

Context about the owner and the rules:
${BUSINESS_CONTEXT}

Rules for you:
- You work only on this business and this job. You never contact Tommy or anyone else directly; your result goes to Jarvis, who checks it.
- You cannot send, spend, post, sign or delete anything. If the task needs that, prepare everything and call request_approval with exactly what should happen.
- Deliver finished, usable work (copy that can be pasted, lists that can be acted on), not plans to make a plan. Be concise.
- If you're missing information only Tommy has and guessing would waste the work, use ask_tommy (one question, 2-4 choices). Otherwise say what you need at the end.
- Save deliverables Tommy will keep or reuse (lead lists, scripts, plans, reports) with save_file so they land in his Outbox.
- If you have hand_off and your finished work is the starting point for a teammate's job, hand it to them with everything they need.

Your recent notebook notes (older notes can be out of date: if one disagrees with your job or the business notes above, follow the job and the business notes):
${notes || "(none yet)"}${extra}`;
}

// Agents that make listings get the list of Tommy's Printify templates.
async function templateNote(agent: Agent): Promise<string> {
  if (!(JSON.parse(agent.allowedTools || "[]") as string[]).includes("create_listing")) return "";
  const { printifyConfigured, listTemplates } = await import("@/lib/integrations/printify");
  if (!printifyConfigured()) return "\n\nPrintify isn't connected yet, so create_listing won't work. Put finished listings in your result instead.";
  const t = await listTemplates().catch(() => []);
  return t.length
    ? `\n\nPrintify templates you can use with create_listing:\n${t.map((x) => `- ${x.title} (prices $${x.prices.join("/$")})`).join("\n")}`
    : "\n\nNo Printify templates yet. Put finished listings in your result instead.";
}

async function runTask(task: Task, agent: Agent) {
  const business = agent.businessId ? getBusiness(agent.businessId) : undefined;
  db().update(schema.tasks).set({ status: "running", attempts: task.attempts + 1 }).where(eq(schema.tasks.id, task.id)).run();

  const model: ModelChoice = agent.model.includes("haiku") ? MODELS.worker : { ...MODELS.writer, id: agent.model };
  const work = await runJob({
    purpose: `crew_${agent.name.toLowerCase().replace(/\W+/g, "_")}`,
    model,
    system: agentSystem(agent, business, await templateNote(agent)),
    prompt: `Task from Jarvis:\n${task.instructions}`,
    tools: agentTools(agent, task),
    maxIterations: 10,
  });

  // The agent asked Tommy a quick question: the task waits for his answer (then continues), no review yet.
  if (askedDuringRun(task.id)) {
    db()
      .update(schema.tasks)
      .set({ status: "waiting", result: work.text, cost: task.cost + work.costUsd })
      .where(eq(schema.tasks.id, task.id))
      .run();
    return;
  }

  // Jarvis checks the work before it reaches Tommy.
  const review = await reviewResult(task, agent, work.text);
  const cost = work.costUsd + review.costUsd;

  if (review.verdict === "needs_work" && task.attempts < 1) {
    db()
      .update(schema.tasks)
      .set({
        status: "queued",
        instructions: `${task.instructions}\n\nJarvis reviewed your first attempt and wants these fixes:\n${review.feedback}`,
        result: work.text,
        cost: task.cost + cost,
      })
      .where(eq(schema.tasks.id, task.id))
      .run();
    return;
  }

  db()
    .update(schema.tasks)
    .set({
      status: "done",
      result: work.text,
      review: review.summary,
      reviewVerdict: review.verdict,
      cost: task.cost + cost,
      finishedAt: new Date(),
    })
    .where(eq(schema.tasks.id, task.id))
    .run();
  await notifyAll({
    title: `${agent.name} finished`,
    body: review.summary.slice(0, 200),
    url: business ? `/businesses/${business.id}` : "/",
    tag: `task-${task.id}`,
  }).catch(() => {});
}

async function reviewResult(task: Task, agent: Agent, result: string) {
  let verdict = "good" as "good" | "needs_work";
  let summary = result.slice(0, 300);
  let feedback = "";
  if (process.env.JARVIS_FAKE_BRAIN === "1") return { verdict, summary: `(test brain) ${agent.name} finished.`, feedback, costUsd: 0 };
  const submit = betaZodTool({
    name: "submit_review",
    description: "Record your review of the agent's work.",
    inputSchema: z.object({
      verdict: z.enum(["good", "needs_work"]),
      summary_for_tommy: z.string().describe("1–3 sentences Tommy can read on his phone: what was done and what (if anything) he needs to do"),
      feedback_for_agent: z.string().optional().describe("If needs_work: exactly what to fix"),
    }),
    run: async (r) => {
      verdict = r.verdict;
      summary = r.summary_for_tommy;
      feedback = r.feedback_for_agent ?? "";
      return "Recorded.";
    },
  });
  const job = await runJob({
    purpose: "crew_review",
    model: { ...MODELS.writer, effort: "low" },
    system: `You are Jarvis, checking a crew agent's work before Tommy sees it. Be demanding but practical: is it accurate, on-task, usable as-is, honest (no income promises or hype), and within the rules? Call submit_review exactly once.\n${BUSINESS_CONTEXT}`,
    prompt: `Agent: ${agent.name} (${agent.job})\nTask: ${task.instructions}\n\nResult:\n${result || "(empty)"}`,
    tools: [submit],
    maxIterations: 3,
    maxTokens: 4000,
  });
  return { verdict, summary, feedback, costUsd: job.costUsd };
}

// ---------- Approvals ----------

export function createApproval(a: { what: string; why: string; agentId?: number; taskId?: number; action?: ApprovalAction }) {
  // Trust ladder: if Tommy put this kind of action on autopilot (and today's cap isn't reached), do it now.
  const lane = laneForAction(a.action, !!a.agentId);
  if (a.action && canAutopilot(lane)) {
    const row = db()
      .insert(schema.approvals)
      .values({
        what: a.what,
        why: a.why,
        agentId: a.agentId ?? null,
        taskId: a.taskId ?? null,
        action: JSON.stringify(a.action),
        status: "approved",
        decidedAt: new Date(),
        decisionNote: "Autopilot (trust ladder)",
      })
      .returning()
      .get();
    recordTrust(lane, "auto", a.what);
    const action = a.action;
    void (async () => {
      let result: string;
      try {
        result = await executeAction(action);
      } catch (err) {
        result = `Failed: ${err instanceof Error ? err.message : String(err)}`;
      }
      db().update(schema.approvals).set({ actionResult: result }).where(eq(schema.approvals.id, row.id)).run();
      if (/^(Failed|Couldn't)/.test(result)) await autopilotFailed(lane, a.what, result);
      else await autopilotDone(lane, a.what, result);
    })();
    return row;
  }
  const row = db()
    .insert(schema.approvals)
    .values({
      what: a.what,
      why: a.why,
      agentId: a.agentId ?? null,
      taskId: a.taskId ?? null,
      action: a.action ? JSON.stringify(a.action) : null,
    })
    .returning()
    .get();
  const short = a.what.split(/\n|(?<=[.!?])\s/)[0].slice(0, 140);
  notifyAll({ title: "Needs your OK", body: a.what.slice(0, 200), url: "/", tag: `approval-${row.id}`, kind: "approval", say: `Sir, something needs your OK: ${short}` }).catch(() => {});
  return row;
}

export function listApprovals(status: "pending" | "all" = "pending") {
  const q = db()
    .select({ approval: schema.approvals, agent: schema.agents })
    .from(schema.approvals)
    .leftJoin(schema.agents, eq(schema.approvals.agentId, schema.agents.id));
  return (status === "pending" ? q.where(eq(schema.approvals.status, "pending")) : q)
    .orderBy(desc(schema.approvals.createdAt))
    .limit(50)
    .all();
}

// Tommy's decision. If the approval carries an action (send this email, create this payment link), Jarvis does it now.
// Otherwise, if it came from an agent, the agent gets a follow-up task with the decision.
export async function decideApproval(id: number, approved: boolean, note?: string) {
  const a = db()
    .update(schema.approvals)
    .set({ status: approved ? "approved" : "denied", decidedAt: new Date(), decisionNote: note ?? null })
    .where(and(eq(schema.approvals.id, id), eq(schema.approvals.status, "pending")))
    .returning()
    .get();
  if (!a) return undefined;
  if (a.action) {
    const act = JSON.parse(a.action) as ApprovalAction;
    if (act.type === "trust_promote" && !approved) declineOffer(act.lane);
    const lane = laneForAction(act, !!a.agentId);
    if (lane) recordTrust(lane, approved ? "approved" : "denied", a.what);
  }
  if (!approved && a.action) {
    const act = JSON.parse(a.action) as ApprovalAction;
    if (act.type === "phone_call") {
      const { markDenied } = await import("@/lib/calls/calls");
      markDenied(act.callId);
    }
  }
  if (approved && a.action) {
    let result: string;
    try {
      result = await executeAction(JSON.parse(a.action) as ApprovalAction);
    } catch (err) {
      result = `Failed: ${err instanceof Error ? err.message : String(err)}`;
    }
    const updated = db().update(schema.approvals).set({ actionResult: result }).where(eq(schema.approvals.id, id)).returning().get();
    notifyAll({ title: result.startsWith("Failed") ? "Couldn't do it" : "Done", body: result.slice(0, 200), url: "/", tag: `approval-${id}` }).catch(() => {});
    return updated;
  }
  if (a.agentId) {
    createTask(
      a.agentId,
      approved
        ? `Tommy APPROVED this: "${a.what}".${note ? ` His note: ${note}.` : ""} If it needs an outside service Jarvis isn't connected to, prepare exactly what Tommy should do to carry it out himself (step by step, ready to paste), unless he already did it.`
        : `Tommy DENIED this: "${a.what}".${note ? ` His note: ${note}.` : ""} Adjust your plan accordingly and propose an alternative if it makes sense.`,
      "tommy",
    );
  }
  return a;
}

// ---------- Tiles and recap ----------

export function setMetric(businessId: number, name: string, value: number) {
  db().insert(schema.metrics).values({ businessId, name, value }).run();
}

function startOfWeek() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); // Monday
  return d;
}

export function businessTiles() {
  const since = startOfWeek();
  return listBusinesses().map((b) => {
    const agentIds = listAgents(b.id).map((a) => a.id);
    const tasks = agentIds.length
      ? db().select().from(schema.tasks).where(and(inArray(schema.tasks.agentId, agentIds), gte(schema.tasks.createdAt, since))).all()
      : [];
    const waiting = agentIds.length
      ? db()
          .select()
          .from(schema.approvals)
          .where(and(inArray(schema.approvals.agentId, agentIds), eq(schema.approvals.status, "pending")))
          .all().length
      : 0;
    const money = db()
      .select()
      .from(schema.metrics)
      .where(and(eq(schema.metrics.businessId, b.id), eq(schema.metrics.name, "revenue"), gte(schema.metrics.recordedAt, since)))
      .all()
      .reduce((s, m) => s + m.value, 0);
    const mrr = db()
      .select()
      .from(schema.metrics)
      .where(and(eq(schema.metrics.businessId, b.id), eq(schema.metrics.name, "mrr")))
      .orderBy(desc(schema.metrics.recordedAt))
      .limit(1)
      .get()?.value;
    return {
      id: b.id,
      name: b.name,
      status: b.status,
      moneyThisWeek: money,
      mrr: mrr ?? null,
      tasksDone: tasks.filter((t) => t.status === "done").length,
      tasksOpen: tasks.filter((t) => t.status === "queued" || t.status === "running").length,
      waiting,
    };
  });
}

export function recapSince(since: Date) {
  const tasks = listTasks({ since, limit: 30 }).filter((r) => r.task.status === "done" || r.task.status === "failed");
  const approvals = listApprovals("pending").filter((r) => r.approval.createdAt >= since);
  const opportunities = getDb()
    .select()
    .from(schema.opportunities)
    .where(and(gte(schema.opportunities.createdAt, since), eq(schema.opportunities.status, "proposed")))
    .all();
  const notes = getDb()
    .select()
    .from(schema.notebookEntries)
    .where(gte(schema.notebookEntries.createdAt, since))
    .all()
    .filter((n) => !n.area.startsWith("agent:"));
  return {
    tasks: tasks.map((r) => ({ id: r.task.id, agent: r.agent?.name ?? "Agent", status: r.task.status, summary: r.task.review ?? "" })),
    approvals: approvals.length,
    opportunities: opportunities.length,
    researchNotes: notes.length,
  };
}
