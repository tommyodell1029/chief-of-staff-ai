// The whole database, in one file. In use: conversations, messages, memories, ai_calls, todos, briefings.
// The other tables are created now so later phases can fill them in without a migration scramble.
import { sql } from "drizzle-orm";
import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

const createdAt = () =>
  integer("created_at", { mode: "timestamp_ms" })
    .notNull()
    .default(sql`(unixepoch() * 1000)`);

export const conversations = sqliteTable("conversations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title"),
  createdAt: createdAt(),
});

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  conversationId: integer("conversation_id")
    .notNull()
    .references(() => conversations.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  // "voice" or "text" — how Tommy said it (or how Jarvis was asked to reply).
  mode: text("mode", { enum: ["voice", "text"] }).notNull().default("text"),
  model: text("model"),
  createdAt: createdAt(),
});

export const memories = sqliteTable("memories", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fact: text("fact").notNull(),
  category: text("category").notNull().default("general"),
  // Where it came from: "conversation", "manual", ...
  source: text("source").notNull().default("conversation"),
  createdAt: createdAt(),
  // Jarvis saves memories unconfirmed; Tommy confirms them on the Memories page.
  confirmed: integer("confirmed", { mode: "boolean" }).notNull().default(false),
});

// One row per AI call: which model, how many tokens, what it cost. Feeds the spend meter.
export const aiCalls = sqliteTable("ai_calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  purpose: text("purpose").notNull(),
  model: text("model").notNull(),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  costUsd: real("cost_usd").notNull().default(0),
  conversationId: integer("conversation_id"),
  createdAt: createdAt(),
});

// Scheduled briefings (lunch check-in, evening review). Also saved into the conversation.
export const briefings = sqliteTable("briefings", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // "lunch" | "evening" | "morning"
  content: text("content").notNull(),
  createdAt: createdAt(),
  readAt: integer("read_at", { mode: "timestamp_ms" }),
});

// ---- Growth Lab (Phase 3) and crews (Phase 4) ----

// Research notes. area is a topic ("trends", "agency", …) or "agent:<id>" for a crew agent's own notebook page.
export const notebookEntries = sqliteTable("notebook_entries", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  area: text("area").notNull(),
  title: text("title").notNull(),
  body: text("body").notNull(),
  sources: text("sources"), // JSON array of URLs
  createdAt: createdAt(),
});

// Ideas from the weekly ranking: new businesses ("new") or add-ons for an existing business ("addon").
export const opportunities = sqliteTable("opportunities", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind", { enum: ["new", "addon"] }).notNull(),
  businessId: integer("business_id").references(() => businesses.id),
  title: text("title").notNull(),
  summary: text("summary").notNull(),
  scores: text("scores").notNull(), // JSON: { demand: 1-10, startupCost: …, … }
  score: real("score").notNull(), // average of scores
  evidence: text("evidence").notNull(),
  sources: text("sources"), // JSON array of URLs
  confidence: text("confidence").notNull(), // low | medium | high
  bestCase: text("best_case"),
  worstCase: text("worst_case"),
  status: text("status").notNull().default("proposed"), // proposed | building | approved | passed
  weekOf: text("week_of").notNull(), // YYYY-MM-DD of the ranking run
  packageMd: text("package_md"), // the "business in a box", once approved
  createdAt: createdAt(),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
});

export const businesses = sqliteTable("businesses", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  status: text("status").notNull().default("draft"), // draft (crew awaiting Tommy's OK) | active | paused
  notes: text("notes"),
  createdAt: createdAt(),
});

export const agents = sqliteTable("agents", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").references(() => businesses.id),
  name: text("name").notNull(),
  job: text("job").notNull(),
  systemPrompt: text("system_prompt").notNull(),
  model: text("model").notNull(),
  allowedTools: text("allowed_tools").notNull().default("[]"), // JSON array
  autonomyLevel: text("autonomy_level").notNull().default("approval_required"),
  status: text("status").notNull().default("draft"), // draft | active | paused
  // Agents this one may hand work to directly (JSON array of agent ids). Drawn on the Command Deck.
  handoffTo: text("handoff_to").notNull().default("[]"),
  createdAt: createdAt(),
});

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id").references(() => agents.id),
  instructions: text("instructions").notNull(),
  status: text("status").notNull().default("queued"),
  result: text("result"),
  cost: real("cost").notNull().default(0),
  // Jarvis checks every result before it reaches Tommy.
  review: text("review"),
  reviewVerdict: text("review_verdict"), // good | needs_work
  attempts: integer("attempts").notNull().default(0),
  requestedBy: text("requested_by").notNull().default("jarvis"), // jarvis | tommy | schedule | handoff
  // Set when another agent handed this work over: which task and agent it came from.
  parentTaskId: integer("parent_task_id"),
  fromAgentId: integer("from_agent_id"),
  createdAt: createdAt(),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
});

export const approvals = sqliteTable("approvals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  what: text("what").notNull(),
  why: text("why").notNull(),
  agentId: integer("agent_id").references(() => agents.id),
  taskId: integer("task_id").references(() => tasks.id),
  status: text("status").notNull().default("pending"), // pending | approved | denied
  decisionNote: text("decision_note"),
  // Optional action Jarvis carries out when Tommy approves, e.g. {"type":"gmail_send","draftId":"…"}.
  action: text("action"),
  actionResult: text("action_result"),
  createdAt: createdAt(),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
});

// Tommy's own to-dos and reminders (Phase 2).
export const todos = sqliteTable("todos", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  dueAt: integer("due_at", { mode: "timestamp_ms" }),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: createdAt(),
  completedAt: integer("completed_at", { mode: "timestamp_ms" }),
  // When the "it's due" phone notification went out, so it's only sent once.
  notifiedAt: integer("notified_at", { mode: "timestamp_ms" }),
});

// Phones/iPads that turned on Jarvis notifications (Web Push subscriptions).
export const pushSubscriptions = sqliteTable("push_subscriptions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  endpoint: text("endpoint").notNull().unique(),
  p256dh: text("p256dh").notNull(),
  auth: text("auth").notNull(),
  device: text("device"),
  createdAt: createdAt(),
});

export const metrics = sqliteTable("metrics", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").references(() => businesses.id),
  name: text("name").notNull(), // e.g. "money_this_week", "tasks_done"
  value: real("value").notNull(),
  recordedAt: createdAt(),
});

// Nina Studio: posts Jarvis prepares (image, caption, voiceover), approved by Tommy, then published.
export const contentItems = sqliteTable("content_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").references(() => businesses.id),
  platforms: text("platforms").notNull(), // JSON array: instagram, tiktok, reddit, fanvue
  caption: text("caption").notNull(),
  hashtags: text("hashtags"),
  imagePrompt: text("image_prompt"),
  imageFile: text("image_file"), // file name in DATA_DIR/media
  voiceoverText: text("voiceover_text"),
  voiceoverFile: text("voiceover_file"),
  videoFile: text("video_file"), // the finished reel (mp4), when one was built
  postAt: integer("post_at", { mode: "timestamp_ms" }), // when Tommy gets the "time to post" reminder
  remindedAt: integer("reminded_at", { mode: "timestamp_ms" }),
  postedAt: integer("posted_at", { mode: "timestamp_ms" }), // when he marked it posted
  likes: integer("likes"), // results he typed in after posting (for boost picks without Meta's API)
  comments: integer("comments"),
  saves: integer("saves"),
  notes: text("notes"), // e.g. which subreddit, best time to post
  status: text("status").notNull().default("draft"), // draft | approved | posted | failed | rejected
  postedUrl: text("posted_url"),
  error: text("error"),
  createdAt: createdAt(),
  decidedAt: integer("decided_at", { mode: "timestamp_ms" }),
});

// Outreach: campaigns Tommy approves once, the decision-maker leads they email, and every email in or out.
export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").references(() => businesses.id),
  name: text("name").notNull(),
  brief: text("brief").notNull(), // the campaign prompt: who, offer, tone, call to action
  previewMd: text("preview_md"), // sample emails written for real leads, shown before approval
  status: text("status").notNull().default("draft"), // draft | active | paused | stopped
  dailyLimit: integer("daily_limit").notNull().default(15),
  followUps: integer("follow_ups").notNull().default(2),
  stopReason: text("stop_reason"),
  // jarvis = Jarvis writes and sends from Gmail; saleshandy = leads go into a Saleshandy sequence, which sends.
  sendVia: text("send_via").notNull().default("jarvis"),
  saleshandySequenceId: text("saleshandy_sequence_id"),
  saleshandySequenceName: text("saleshandy_sequence_name"),
  saleshandyStepId: text("saleshandy_step_id"),
  createdAt: createdAt(),
  approvedAt: integer("approved_at", { mode: "timestamp_ms" }),
});

export const leads = sqliteTable("leads", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: integer("campaign_id").references(() => campaigns.id),
  company: text("company").notNull(),
  domain: text("domain").notNull(),
  city: text("city"),
  contactName: text("contact_name"),
  contactTitle: text("contact_title"),
  email: text("email"),
  emailSource: text("email_source"), // saleshandy | apollo | hunter
  phone: text("phone"), // from Google Maps
  emailStatus: text("email_status"), // valid | accept_all | unknown
  notes: text("notes"), // what the Prospector found (map rank, reviews, missing hours…)
  // new | no_email | ready | contacted | replied | interested | not_interested | unsubscribed | bounced | needs_review | done
  // | in_saleshandy (handed to a Saleshandy sequence)
  status: text("status").notNull().default("new"),
  step: integer("step").notNull().default(0), // emails sent so far (1 = first email)
  threadId: text("thread_id"),
  lastSentAt: integer("last_sent_at", { mode: "timestamp_ms" }),
  lastReplyAt: integer("last_reply_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});

export const outreachMessages = sqliteTable("outreach_messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  leadId: integer("lead_id").references(() => leads.id),
  direction: text("direction").notNull(), // out | in
  kind: text("kind").notNull(), // first | follow_up | auto_reply | approved_reply | reply_in
  gmailId: text("gmail_id").unique(),
  subject: text("subject"),
  body: text("body").notNull(),
  createdAt: createdAt(),
});

// Small key/value settings (e.g. Tommy's F-U money number).
// Trust ladder: every decision on an action type that can earn autopilot (approved as-is, edited, denied, or done on
// autopilot). Streaks of clean approvals unlock the offer to let Jarvis handle that type on his own.
export const trustEvents = sqliteTable("trust_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  lane: text("lane").notNull(),
  outcome: text("outcome").notNull(), // approved | edited | denied | auto | failed
  summary: text("summary"),
  createdAt: createdAt(),
});

// LaunchPad Local clients: who they are, what they pay for, and the searches we track for them.
export const clients = sqliteTable("clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(), // business name as it appears on Google Maps
  plan: text("plan").notNull().default("visibility"), // visibility ($249) | mappack ($449)
  contactName: text("contact_name"),
  email: text("email"),
  city: text("city").notNull(), // e.g. "Jacksonville, FL"
  keywords: text("keywords").notNull(), // JSON array of searches, e.g. ["plumber", "water heater repair"]
  website: text("website"), // helps find them in results
  status: text("status").notNull().default("active"), // active | paused | ended
  notes: text("notes"),
  createdAt: createdAt(),
});

// One weekly Google Maps check: where the client ranks for one search, and their rating then.
export const clientChecks = sqliteTable("client_checks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: integer("client_id")
    .notNull()
    .references(() => clients.id),
  keyword: text("keyword").notNull(),
  rank: integer("rank"), // 1-20, or null when not in the top 20
  rating: real("rating"),
  reviewCount: integer("review_count"),
  leader: text("leader"), // who was #1
  createdAt: createdAt(),
});

// Walk-in audits: the free 5-point check run for a business by name, printed as a one-page leave-behind.
export const audits = sqliteTable("audits", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  business: text("business").notNull(),
  city: text("city").notNull(),
  data: text("data").notNull(), // JSON: the findings (see lib/audits/walkin.ts)
  createdAt: createdAt(),
});

// Quick questions: an agent that's unsure asks Tommy one question with a few answer buttons, and its task waits.
export const questions = sqliteTable("questions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  agentId: integer("agent_id").references(() => agents.id),
  taskId: integer("task_id").references(() => tasks.id),
  question: text("question").notNull(),
  options: text("options").notNull(), // JSON array of 2-4 answers
  answer: text("answer"),
  status: text("status").notNull().default("open"), // open | answered | dropped
  createdAt: createdAt(),
  answeredAt: integer("answered_at", { mode: "timestamp_ms" }),
});

// The Outbox: files agents save for Tommy (reports, lists, scripts as .md/.csv/.txt), stored in DATA_DIR/outbox.
export const outboxItems = sqliteTable("outbox_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  title: text("title").notNull(),
  file: text("file").notNull(), // file name in the outbox folder
  agentId: integer("agent_id").references(() => agents.id),
  taskId: integer("task_id").references(() => tasks.id),
  createdAt: createdAt(),
});

// Done-for-you builds of a client's assistant (Chief of Staff AI): call notes → setup file → checklist → launch.
export const builds = sqliteTable("builds", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  client: text("client").notNull(),
  email: text("email"),
  status: text("status").notNull().default("kickoff"), // kickoff | building | warming | ready | launched | paused
  notes: text("notes"), // the kickoff call notes
  plan: text("plan"), // the setup file (JSON), see lib/kit/profile.ts
  checklist: text("checklist").notNull().default("[]"), // JSON [{id, group, label, done}]
  createdAt: createdAt(),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }),
  launchedAt: integer("launched_at", { mode: "timestamp_ms" }),
});

export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
});

export type Memory = typeof memories.$inferSelect;
export type Message = typeof messages.$inferSelect;
export type Todo = typeof todos.$inferSelect;
export type Briefing = typeof briefings.$inferSelect;
export type Opportunity = typeof opportunities.$inferSelect;
export type Business = typeof businesses.$inferSelect;
export type Agent = typeof agents.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type Approval = typeof approvals.$inferSelect;
export type NotebookEntry = typeof notebookEntries.$inferSelect;
export type ContentItem = typeof contentItems.$inferSelect;
export type Campaign = typeof campaigns.$inferSelect;
export type Lead = typeof leads.$inferSelect;

// Phone calls Jarvis makes for Tommy (reservations, appointments, quick questions). Each one is approved first.
export const calls = sqliteTable("calls", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  business: text("business").notNull(), // who's being called
  toNumber: text("to_number").notNull(), // +1XXXXXXXXXX
  task: text("task").notNull(), // what to get done, e.g. "book a table for 2"
  details: text("details").notNull(), // the specifics and limits (times that work, name for the booking…)
  opening: text("opening").notNull(), // the first sentence after the AI introduction
  // awaiting_approval | queued (approved, waiting for calling hours) | calling | done | failed | denied
  status: text("status").notNull().default("awaiting_approval"),
  conversationId: text("conversation_id"),
  outcome: text("outcome"), // booked | done | not_available | no_answer | voicemail | needs_tommy | failed
  summary: text("summary"),
  transcript: text("transcript"),
  error: text("error"),
  createdAt: createdAt(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  endedAt: integer("ended_at", { mode: "timestamp_ms" }),
});
export type Call = typeof calls.$inferSelect;

// Things Jarvis says out loud on the station without being asked (alerts, heads-ups, briefings).
export const announcements = sqliteTable("announcements", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  kind: text("kind").notNull(), // alert | calendar | etsy | weather | approval | briefing
  text: text("text").notNull(), // shown on screen
  say: text("say").notNull(), // spoken
  createdAt: createdAt(),
});

// Goals per business, measured by a metric (collected automatically, or told to Jarvis by Tommy).
export const goals = sqliteTable("goals", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").references(() => businesses.id),
  title: text("title").notNull(), // "10 Etsy orders a week"
  metric: text("metric").notNull(), // key, e.g. etsy_orders_week (see lib/goals/goals.ts) or a custom one like ig_followers
  target: real("target").notNull(),
  deadline: text("deadline"), // YYYY-MM-DD
  status: text("status").notNull().default("proposed"), // proposed (waiting for Tommy's OK) | active | met | dropped
  startValue: real("start_value"), // the metric when the goal became active, for pace
  activatedAt: integer("activated_at", { mode: "timestamp_ms" }),
  metAt: integer("met_at", { mode: "timestamp_ms" }),
  createdAt: createdAt(),
});
export type Goal = typeof goals.$inferSelect;

// The Monday business reviews Jarvis writes (scorecard, what worked, this week's focus and crew assignments).
export const reviews = sqliteTable("reviews", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  businessId: integer("business_id").references(() => businesses.id),
  weekOf: text("week_of").notNull(), // YYYY-MM-DD (the Monday)
  summary: text("summary").notNull(), // Markdown
  createdAt: createdAt(),
});
export type Client = typeof clients.$inferSelect;
export type Audit = typeof audits.$inferSelect;
export type Question = typeof questions.$inferSelect;
export type Build = typeof builds.$inferSelect;
