// Jarvis's tools. Each one runs inside this app. Nothing here sends, spends, posts, signs, or deletes:
// to-dos can be added and completed, but deleting one is done by Tommy on the To-dos page.
import type Anthropic from "@anthropic-ai/sdk";
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import { z } from "zod";
import { AGENCY_NAME } from "@/config/business";
import { WEB_SEARCHES_PER_MESSAGE } from "@/config/models";
import { calendarConfigured, describeEvent, eventsBetween } from "@/lib/calendar";
import { createApproval, createTask, findAgent, listTasks } from "@/lib/crews/crews";
import { createDraft, gmailConnected, gmailRead, gmailSearch } from "@/lib/integrations/gmail";
import { driveConnected, saveDoc } from "@/lib/integrations/drive";
import { etsyConnected, etsySummary } from "@/lib/integrations/etsy";
import { stripeConfigured, stripeSummary } from "@/lib/integrations/stripe";
import { homePlace, weatherConfigured, weatherReport } from "@/lib/integrations/weather";
import { callsConfigured } from "@/lib/integrations/elevenAgents";
import { kitMode } from "@/lib/kit/kit";
import { addMemory, recallMemories } from "@/lib/memory";
import { addTodo, findOpenTodo, formatDue, listTodos, setTodoDone } from "@/lib/todos";

export type ToolEvent = { type: "tool"; name: string; detail: string };

const todoLine = (t: { id: number; title: string; dueAt: Date | null; done: boolean }) =>
  `#${t.id} ${t.done ? "[done] " : ""}${t.title}${t.dueAt ? ` (due ${formatDue(t.dueAt)})` : ""}`;

// Anthropic's hosted web fetch: opens a page found by web search (or a link Tommy gives) and reads the whole thing,
// so answers come from the article itself, not a snippet. No per-use fee; only the text read is billed.
function webFetchTool(): Anthropic.Beta.BetaWebFetchTool20260209 {
  return { type: "web_fetch_20260209", name: "web_fetch", max_uses: 3, max_content_tokens: 30_000, citations: { enabled: true } };
}

// Anthropic's hosted web search. Tommy's home area makes "weather" and "near me" questions local.
function webSearchTool(): Anthropic.Beta.BetaWebSearchTool20260209 {
  const city = process.env.HOME_CITY;
  const region = process.env.HOME_REGION;
  return {
    type: "web_search_20260209",
    name: "web_search",
    max_uses: WEB_SEARCHES_PER_MESSAGE,
    ...(city || region
      ? {
          user_location: {
            type: "approximate",
            city: city || null,
            region: region || null,
            country: "US",
            timezone: process.env.TZ || null,
          },
        }
      : {}),
  };
}

export function jarvisTools(emit: (e: ToolEvent) => void) {
  const tools: (BetaRunnableTool | Anthropic.Beta.BetaWebSearchTool20260209 | Anthropic.Beta.BetaWebFetchTool20260209)[] = [
    betaZodTool({
      name: "remember",
      description:
        "Save a lasting fact about Tommy (a preference, person, goal, routine, business detail). Saved as unconfirmed until Tommy confirms it on the Memories page.",
      inputSchema: z.object({
        fact: z.string().min(1).describe("The fact, written as a short third-person sentence, e.g. 'Tommy is a Yankees fan.'"),
        category: z
          .string()
          .describe("One word: personal, family, work, health, preferences, sports, business, goals, schedule, or general"),
      }),
      run: async ({ fact, category }) => {
        const m = addMemory(fact, category, "conversation");
        emit({ type: "tool", name: "remember", detail: m.fact });
        return `Saved memory #${m.id}: ${m.fact}`;
      },
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "recall",
      description:
        "Search saved memories about Tommy by keywords. Use when the memories in your context don't cover what you need.",
      inputSchema: z.object({ query: z.string().describe("Keywords to search for") }),
      run: async ({ query }) => {
        const found = recallMemories(query);
        emit({ type: "tool", name: "recall", detail: query });
        return found.length
          ? found.map((m) => `- [${m.category}] ${m.fact}${m.confirmed ? "" : " (unconfirmed)"}`).join("\n")
          : "No matching memories.";
      },
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "add_todo",
      description:
        "Add a to-do or reminder to Tommy's list. Use when he asks you to remind him, add something to his list, or says he needs to do something.",
      inputSchema: z.object({
        title: z.string().min(1).describe("Short, clear task, e.g. 'Call the bank about the car loan'"),
        due: z
          .string()
          .optional()
          .describe(
            "When it's due, as an ISO 8601 date-time with Tommy's UTC offset (e.g. '2026-11-02T17:00:00-06:00'). Work it out from the current time in his message. Omit if he gave no time.",
          ),
      }),
      run: async ({ title, due }) => {
        const dueAt = due ? new Date(due) : null;
        if (dueAt && Number.isNaN(dueAt.getTime())) return `Couldn't understand the due date "${due}". Ask Tommy when it's due.`;
        const t = addTodo(title, dueAt);
        emit({ type: "tool", name: "add_todo", detail: t.title });
        return `Added ${todoLine(t)}`;
      },
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "list_todos",
      description: "List Tommy's open to-dos (soonest due first). Set include_done to also see recently completed ones.",
      inputSchema: z.object({ include_done: z.boolean().optional() }),
      run: async ({ include_done }) => {
        const items = listTodos(include_done ?? false, 50);
        emit({ type: "tool", name: "list_todos", detail: `${items.length} items` });
        return items.length ? items.map(todoLine).join("\n") : "No open to-dos.";
      },
    }),
    betaZodTool({
      name: "complete_todo",
      description:
        "Mark one of Tommy's to-dos as done. Pass its id from list_todos, or words from its title if you don't have the id.",
      inputSchema: z.object({
        id: z.number().int().optional().describe("The to-do's id number"),
        title_words: z.string().optional().describe("Words from the to-do's title"),
      }),
      run: async ({ id, title_words }) => {
        const found = id !== undefined ? findOpenTodo(id) : title_words ? findOpenTodo(title_words) : undefined;
        if (!found) return "No matching open to-do. Use list_todos to find it.";
        setTodoDone(found.id, true);
        emit({ type: "tool", name: "complete_todo", detail: found.title });
        return `Marked done: ${todoLine(found)}`;
      },
    }),
    webSearchTool(),
    webFetchTool(),
    betaZodTool({
      name: "delegate_to_crew",
      description:
        "Hand a task to a specialist agent in one of Tommy's business crews (see the crew list in your context). The agent works in the background; check back with crew_status. Only active crews run tasks.",
      inputSchema: z.object({
        business: z.string().describe("Business name, e.g. 'LaunchPad Local'"),
        agent: z.string().describe("Agent name, e.g. 'Prospector'"),
        instructions: z.string().min(10).describe("Clear, specific instructions with everything the agent needs"),
      }),
      run: async ({ business, agent, instructions }) => {
        const found = findAgent(business, agent);
        if (!found.business) return `No business matching "${business}".`;
        if (!found.agent) return `No agent matching "${agent}" in ${found.business.name}.`;
        const task = createTask(found.agent.id, instructions, "jarvis");
        emit({ type: "tool", name: "delegate_to_crew", detail: `${found.agent.name} (${found.business.name})` });
        return found.agent.status === "active"
          ? `Task #${task.id} queued for ${found.agent.name}. It usually takes a few minutes; you'll review it before Tommy sees it.`
          : `Task #${task.id} saved, but the ${found.business.name} crew isn't approved yet, so it will wait. Tell Tommy to approve the crew on its business page.`;
      },
      eager_input_streaming: true,
    }),
    betaZodTool({
      name: "crew_status",
      description: "See recent crew tasks: status, Jarvis's review summary, and results. Use to report back to Tommy.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(20).optional() }),
      run: async ({ limit }) => {
        const rows = listTasks({ limit: limit ?? 8 });
        emit({ type: "tool", name: "crew_status", detail: `${rows.length} tasks` });
        if (!rows.length) return "No crew tasks yet.";
        return rows
          .map(
            ({ task, agent }) =>
              `#${task.id} ${agent?.name ?? "?"} [${task.status}${task.reviewVerdict ? `, review: ${task.reviewVerdict}` : ""}]: ${task.instructions.slice(0, 120)}${
                task.review ? `\n  Review: ${task.review}` : ""
              }${task.status === "done" && task.result ? `\n  Result (start): ${task.result.slice(0, 600)}` : ""}`,
          )
          .join("\n");
      },
    }),
    betaZodTool({
      name: "ask_approval",
      description:
        "Put something on Tommy's 'Waiting on you' list for a yes/no (anything that would send, spend, post, sign or delete). Use when he isn't deciding right now in the chat.",
      inputSchema: z.object({ what: z.string(), why: z.string() }),
      run: async ({ what, why }) => {
        const a = createApproval({ what, why });
        emit({ type: "tool", name: "ask_approval", detail: what });
        return `Added approval request #${a.id} to Tommy's dashboard.`;
      },
    }),
  ];

  if (callsConfigured() && (!kitMode() || process.env.CALLS_ENABLED === "1")) {
    tools.push(
      betaZodTool({
        name: "phone_call",
        description:
          "Ask to place a phone call for Tommy: reservations, appointments, quick questions (hours, availability, a quote). Jarvis's AI voice calls, says it's an AI calling for Tommy, and reports back. The call only goes out after Tommy approves it on his dashboard, 9 am–8 pm. If you don't know the number, give the business name and area and it's looked up on Google Maps. Get the important details first (day, time window, party size, name) — ask Tommy if they're missing.",
        inputSchema: z.object({
          business: z.string().describe("Who to call, e.g. 'Olive Garden Southside'. Use 'me' when Tommy says to call him."),
          phone: z.string().optional().describe("Their number, if known"),
          area: z.string().optional().describe("City/area to look them up in, if no number"),
          task: z.string().describe("What to get done, short: 'book a table for 2 on Friday Nov 14 around 7 pm'"),
          details: z
            .string()
            .describe("Specifics and limits: acceptable times (e.g. 6:30–8 pm), party size, name for the booking, seating requests, what to do if unavailable. Never include payment details."),
          opening: z.string().describe("First sentence after the AI introduction, e.g. 'I'd like to book a table for two this Friday, around 7 pm.'"),
        }),
        run: async ({ business, phone, area, task, details, opening }) => {
          const { tommyNumber } = await import("@/lib/calls/calls");
          // "Call me": Tommy's own cell (TOMMY_PHONE).
          const me = /^(me|tommy|myself|my (cell|phone))$/i.test(business.trim()) || /^me$/i.test((phone ?? "").trim());
          if (me && !tommyNumber()) return "Tommy's number isn't set (TOMMY_PHONE in Render). Ask him to add it.";
          let number = me ? tommyNumber()! : phone;
          let name = me ? "Tommy (your cell)" : business;
          if (!number) {
            const { searchMaps, mapsConfigured } = await import("@/lib/integrations/places");
            if (!mapsConfigured()) return "No phone number given and Google Maps isn't set up. Ask Tommy for the number.";
            const where = area || homePlace();
            const found = (await searchMaps(`${business} in ${where}`, 3).catch(() => [])).find((p) => p.phone && p.open);
            if (!found?.phone) return `Couldn't find a phone number for ${business} in ${where}. Ask Tommy for the number.`;
            number = found.phone;
            name = found.name;
          }
          try {
            const { requestCall } = await import("@/lib/calls/calls");
            const c = requestCall({ business: name, phone: number, task, details, opening });
            emit({ type: "tool", name: "phone_call", detail: name });
            return `Call to ${name} (${c.toNumber}) is waiting for Tommy's approval on the dashboard. Tell him to approve it; you'll report back when it's done. Don't claim it's booked.`;
          } catch (err) {
            return err instanceof Error ? err.message : String(err);
          }
        },
      }),
      betaZodTool({
        name: "call_results",
        description: "Recent phone calls Jarvis made or queued, with their results.",
        inputSchema: z.object({}),
        run: async () => {
          const { listCalls } = await import("@/lib/calls/calls");
          const rows = listCalls(8);
          if (!rows.length) return "No calls yet.";
          return rows.map((c) => `#${c.id} ${c.business}: ${c.task} — ${c.status}${c.summary ? `: ${c.summary}` : ""}${c.error ? ` (${c.error})` : ""}`).join("\n");
        },
      }),
    );
  }

  tools.push(
    betaZodTool({
      name: "scorecard",
      description: "Goals and scorecards for Tommy's businesses: each goal's current number vs target, pace (on track / behind), days left, plus the latest Monday review.",
      inputSchema: z.object({ business: z.string().optional().describe("Part of a business name; all businesses if empty") }),
      run: async ({ business }) => {
        const { scorecardText } = await import("@/lib/goals/goals");
        const { latestReview } = await import("@/lib/goals/review");
        const { listBusinesses } = await import("@/lib/crews/crews");
        const list = listBusinesses().filter((b) => !business || b.name.toLowerCase().includes(business.toLowerCase()));
        if (!list.length) return "No matching business.";
        emit({ type: "tool", name: "scorecard", detail: business || "all" });
        return list
          .map((b) => {
            const r = latestReview(b.id);
            return `## ${b.name}\n${scorecardText(b.id)}${r ? `\nLatest review (${r.weekOf}):\n${r.summary.slice(0, 900)}` : ""}`;
          })
          .join("\n\n");
      },
    }),
    betaZodTool({
      name: "autopilot",
      description:
        "The trust ladder: which kinds of actions Tommy lets you do on your own. 'status' lists each lane (Nina's lifestyle posts, Nina's Etsy posts, publishing Etsy listings, emails your crews write, replies to prospects) with its streak and mode. 'on' / 'off' switch a lane, only when Tommy clearly asks. Money, phone calls and contracts are never on autopilot.",
      inputSchema: z.object({
        action: z.enum(["status", "on", "off"]),
        lane: z.string().optional().describe("Which kind, in Tommy's words, e.g. 'Nina posts', 'Etsy listings', 'prospect replies'"),
      }),
      run: async ({ action, lane }) => {
        const { trustText, findLane, setLaneAuto, LANES } = await import("@/lib/trust");
        emit({ type: "tool", name: "autopilot", detail: `${action}${lane ? ` ${lane}` : ""}` });
        if (action === "status") return trustText();
        const id = lane ? findLane(lane) : undefined;
        if (!id) return `Which one? ${Object.values(LANES).map((l) => l.label).join(", ")}. (Money, calls and contracts can't go on autopilot.)`;
        setLaneAuto(id, action === "on");
        return action === "on"
          ? `Autopilot on for ${LANES[id].label} (up to ${LANES[id].dailyCap} a day; Tommy hears about each one, and it switches back if anything fails).`
          : `${LANES[id].label} will come to Tommy for approval again.`;
      },
    }),
    betaZodTool({
      name: "set_goal",
      description:
        "Add a goal for a business when Tommy asks. Metric is one of: etsy_orders_week, etsy_sales_week, etsy_sales_month, agency_mrr, agency_clients, audit_requests_week, leads_week, interested_week, nina_posts_week, ig_followers, tiktok_followers, fanvue_subscribers, crew_tasks_week — or a short new name for something Tommy will report himself.",
      inputSchema: z.object({
        business: z.string(),
        title: z.string().describe("Short, e.g. '10 Etsy orders a week'"),
        metric: z.string(),
        target: z.number(),
        deadline: z.string().optional().describe("YYYY-MM-DD"),
      }),
      run: async ({ business, title, metric, target, deadline }) => {
        const { findAgent } = await import("@/lib/crews/crews");
        const { createGoal } = await import("@/lib/goals/goals");
        const b = findAgent(business, "").business;
        if (!b) return `No business matching "${business}".`;
        const g = createGoal({ businessId: b.id, title, metric, target, deadline, active: true });
        emit({ type: "tool", name: "set_goal", detail: g.title });
        return `Goal set for ${b.name}: ${g.title} (${g.metric} → ${g.target}${g.deadline ? ` by ${g.deadline}` : ""}).`;
      },
    }),
    betaZodTool({
      name: "update_goal",
      description: "Approve a proposed goal, change its target or deadline, or drop it. Use goal ids from scorecard.",
      inputSchema: z.object({
        business: z.string(),
        goal_title: z.string().describe("Part of the goal's title"),
        action: z.enum(["approve", "change", "drop"]),
        target: z.number().optional(),
        deadline: z.string().optional(),
      }),
      run: async ({ business, goal_title, action, target, deadline }) => {
        const { findAgent } = await import("@/lib/crews/crews");
        const { listGoals, activateGoal, updateGoal } = await import("@/lib/goals/goals");
        const b = findAgent(business, "").business;
        if (!b) return `No business matching "${business}".`;
        const g = listGoals(b.id, ["proposed", "active", "met"]).find((x) => x.title.toLowerCase().includes(goal_title.toLowerCase()));
        if (!g) return `No goal matching "${goal_title}" for ${b.name}.`;
        const changes = { ...(target !== undefined ? { target } : {}), ...(deadline ? { deadline } : {}) };
        if (action === "approve") activateGoal(g.id, changes);
        else if (action === "drop") updateGoal(g.id, { status: "dropped" });
        else updateGoal(g.id, changes);
        emit({ type: "tool", name: "set_goal", detail: g.title });
        return `${action === "approve" ? "Approved" : action === "drop" ? "Dropped" : "Updated"}: ${g.title}.`;
      },
    }),
    betaZodTool({
      name: "record_number",
      description: "Record a number Tommy tells you for a business metric (e.g. 'we have 2 clients', 'Nina's at 340 followers'). It feeds the scorecard.",
      inputSchema: z.object({ business: z.string(), metric: z.string().describe("Metric key, e.g. agency_clients, ig_followers"), value: z.number() }),
      run: async ({ business, metric, value }) => {
        const { findAgent } = await import("@/lib/crews/crews");
        const { recordValue, metricLabel } = await import("@/lib/goals/goals");
        const b = findAgent(business, "").business;
        if (!b) return `No business matching "${business}".`;
        const key = metric.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_");
        recordValue(b.id, key, value);
        emit({ type: "tool", name: "record_number", detail: `${metricLabel(key)}: ${value}` });
        return `Recorded ${metricLabel(key)} = ${value} for ${b.name}.`;
      },
    }),
    betaZodTool({
      name: "run_review",
      description: "Run the business review now (normally automatic every Monday at 7:05 am): fresh numbers, a written review per business, and this week's crew assignments. Takes a minute or two; costs a few cents per business.",
      inputSchema: z.object({}),
      run: async () => {
        const { runMondayReview } = await import("@/lib/goals/review");
        await runMondayReview();
        emit({ type: "tool", name: "run_review", detail: "done" });
        return "Review done; results are on each business page and summarized in a notification. Use scorecard to read them.";
      },
    }),
  );

  tools.push(
    betaZodTool({
      name: "protocol",
      description:
        "Tommy's routines: heading_out (\"I'm heading out\", \"leaving for work\"), home (\"I'm home\", \"I'm back\"), goodnight (\"goodnight\", \"going to bed\"), focus (\"focus mode\", \"don't disturb me for an hour\"), end_focus, status_report (\"status report\", \"how are things running\"). It sets the station's quiet mode and returns the facts for your reply; turn them into a short, natural spoken answer.",
      inputSchema: z.object({
        name: z.enum(["heading_out", "home", "goodnight", "focus", "end_focus", "status_report"]),
        minutes: z.number().optional().describe("Focus length; default 60"),
      }),
      run: async ({ name, minutes }) => {
        const { protocol } = await import("@/lib/presence");
        emit({ type: "tool", name: "protocol", detail: name.replace("_", " ") });
        return protocol(name, minutes ?? 60);
      },
    }),
    betaZodTool({
      name: "clients",
      description:
        "LaunchPad Local clients: 'status' lists each client with their Google Maps rank for each tracked search and their rating; 'add' adds a new client when Tommy says one signed (business name as on Maps, city, up to 3 searches they want to win, plan visibility=$249 or mappack=$449, contact and email if he gave them).",
      inputSchema: z.object({
        action: z.enum(["status", "add"]),
        name: z.string().optional(),
        city: z.string().optional().describe("e.g. 'Jacksonville, FL'"),
        searches: z.array(z.string()).optional().describe("e.g. ['plumber', 'water heater repair']"),
        plan: z.enum(["visibility", "mappack"]).optional(),
        contact_name: z.string().optional(),
        email: z.string().optional(),
        website: z.string().optional(),
      }),
      run: async (i) => {
        const { addClient, clientsText } = await import("@/lib/clients/clients");
        emit({ type: "tool", name: "clients", detail: i.action === "add" ? (i.name ?? "") : "status" });
        if (i.action === "status") return clientsText();
        if (!i.name || !i.searches?.length) return "To add a client I need their business name and at least one search they want to show up for.";
        const c = addClient({ name: i.name, city: i.city || "Jacksonville, FL", keywords: i.searches, plan: i.plan, contactName: i.contact_name, email: i.email, website: i.website });
        return `Added ${c.name}. Their Maps ranks are checked every Monday (or tap "Check ranks now" on the Clients page), Client Success drafts a weekly Google post, and the monthly report is drafted on the 1st.`;
      },
    }),
    betaZodTool({
      name: "holiday_listings",
      description:
        "Etsy Christmas listings: 'refresh' drafts holiday titles, tags and openings for every live listing (each waits for Tommy's approval before anything changes on Etsy); 'undo' puts the originals back after the holidays. Only when Tommy asks.",
      inputSchema: z.object({ action: z.enum(["refresh", "undo"]), cutoff: z.string().optional().describe("Order-by date for Christmas delivery, default 'December 10'") }),
      run: async ({ action, cutoff }) => {
        const { startHolidayRefresh, undoHolidayRefresh, DEFAULT_CUTOFF } = await import("@/lib/etsy/holiday");
        emit({ type: "tool", name: "holiday_listings", detail: action });
        return action === "refresh" ? startHolidayRefresh(cutoff || DEFAULT_CUTOFF) : undoHolidayRefresh();
      },
    }),
    betaZodTool({
      name: "crew_questions",
      description:
        "Quick questions agents asked Tommy (each with 2-4 answer choices; the agent's task waits). 'list' reads them out; 'answer' answers one by its number in the list with Tommy's choice or his own words.",
      inputSchema: z.object({ action: z.enum(["list", "answer"]), number: z.number().optional(), answer: z.string().optional() }),
      run: async ({ action, number, answer }) => {
        const { openQuestions, answerQuestion } = await import("@/lib/crews/deck");
        const qs = openQuestions();
        emit({ type: "tool", name: "crew_questions", detail: action });
        if (action === "list") return qs.length ? qs.map((q, i) => `${i + 1}. ${q.agentName}: ${q.question} (${q.opts.join(" / ")})`).join("\n") : "No open questions from the crews.";
        const q = qs[(number ?? 1) - 1];
        if (!q || !answer?.trim()) return "Which question, and what's the answer?";
        answerQuestion(q.id, answer);
        return `Told ${q.agentName}: "${answer}". They'll pick the task back up now.`;
      },
    }),
    betaZodTool({
      name: "night_shift",
      description:
        "Night Shift: work queued 'for tonight' runs while Tommy sleeps (11 pm–6 am) within a dollar budget; nothing goes out, and he gets a morning report. 'status' says what's queued; 'add' queues a task for an agent (business + agent name + instructions); 'on'/'off'; 'budget' sets dollars per night.",
      inputSchema: z.object({
        action: z.enum(["status", "add", "on", "off", "budget"]),
        business: z.string().optional(),
        agent: z.string().optional(),
        instructions: z.string().optional(),
        dollars: z.number().optional(),
      }),
      run: async ({ action, business, agent, instructions, dollars }) => {
        const { nightText, queueForNight, setNightShift } = await import("@/lib/nightshift");
        emit({ type: "tool", name: "night_shift", detail: action });
        if (action === "on" || action === "off") setNightShift({ on: action === "on" });
        if (action === "budget" && dollars) setNightShift({ budget: dollars });
        if (action === "add") {
          const { findAgent } = await import("@/lib/crews/crews");
          const found = findAgent(business ?? "", agent ?? "");
          if (!found.agent || !instructions?.trim()) return "Which business and agent, and what should they do tonight?";
          queueForNight(found.agent.id, instructions.trim(), "jarvis");
          return `Queued for ${found.agent.name} tonight. ${nightText()}`;
        }
        return nightText();
      },
    }),
    betaZodTool({
      name: "boost_picks",
      description: "Pick Nina's best Etsy posts from the last 3 weeks to boost (from the likes/comments/saves Tommy entered in Nina Studio). A suggestion only; Tommy boosts in the Instagram app himself.",
      inputSchema: z.object({}),
      run: async () => {
        const { weeklyBoostCandidates } = await import("@/lib/nina/boost");
        emit({ type: "tool", name: "boost_picks", detail: "Nina" });
        return weeklyBoostCandidates(true);
      },
    }),
    betaZodTool({
      name: "walkin_audit",
      description:
        "Run the free 5-point Google Maps audit for a local business Tommy wants to visit in person (\"run an audit for Smith Roofing, roofer\"). Checks Maps live and makes a one-page printout. Needs the business name and 1-2 things customers search for.",
      inputSchema: z.object({
        business: z.string(),
        searches: z.array(z.string()).min(1).max(2).describe("e.g. ['roofer', 'roof repair']"),
        city: z.string().optional().describe("Default Jacksonville, FL"),
        website: z.string().optional(),
      }),
      run: async ({ business, searches, city, website }) => {
        const { runWalkinAudit, getAudit } = await import("@/lib/audits/walkin");
        emit({ type: "tool", name: "walkin_audit", detail: business });
        try {
          const a = await runWalkinAudit({ business, searches, city: city || "Jacksonville, FL", website });
          const d = getAudit(a.id)!.parsed;
          const { adsTransparencyUrl } = await import("@/lib/adsLink");
          return `Audit ready. Printout: /audit/${a.id} (also under Outreach → Walk-in audits). Whether they run Google ads: ${adsTransparencyUrl(d.listing.website)}\n${d.points.map((p) => `${p.title}: ${p.status} (${p.lines[0]})`).join("\n")}\nTop fixes: ${d.fixes.join(" | ")}`;
        } catch (err) {
          return `Couldn't run the audit: ${err instanceof Error ? err.message : String(err)}`;
        }
      },
    }),
    betaZodTool({
      name: "diagnostics",
      description:
        "Run a full systems check (\"run diagnostics\", \"systems check\", \"is everything working\"): brain and spending, voice, memory and disk, crews, scheduler, Gmail, Etsy, Printify, Stripe, Saleshandy, phone line, Maps, weather, image studio, Instagram. Report it like a ship's computer: lead with how many systems are online, then only what's wrong and what Tommy can do about it.",
      inputSchema: z.object({}),
      run: async () => {
        const { runDiagnostics, diagnosticsSummary, diagnosticsText } = await import("@/lib/diagnostics");
        emit({ type: "tool", name: "diagnostics", detail: "all systems" });
        const checks = await runDiagnostics();
        return `${diagnosticsSummary(checks)}\n\n${diagnosticsText(checks)}`;
      },
    }),
  );

  if (weatherConfigured()) {
    tools.push(
      betaZodTool({
        name: "uber_link",
        description:
          "Get Tommy an Uber: makes a link that opens the Uber app with pickup and destination filled in, and sends it to his phone as a notification. He checks the price and taps Confirm himself; you can't book or pay. Pickup defaults to his current location.",
        inputSchema: z.object({
          destination: z.string().describe("Place name or address, e.g. 'Jacksonville International Airport' or 'TIAA Bank Field'"),
          pickup: z.string().optional().describe("Only if not his current location"),
          area: z.string().optional().describe("City/area to help find the place, if not obvious"),
        }),
        run: async ({ destination, pickup, area }) => {
          try {
            const { planTrip, goPath } = await import("@/lib/integrations/uber");
            const { notifyAll } = await import("@/lib/push");
            const t = await planTrip(destination, pickup, area || homePlace());
            const path = goPath(t);
            const from = t.pickup ? t.pickup.addr : "your current location";
            emit({ type: "tool", name: "uber_link", detail: JSON.stringify({ label: `Open Uber to ${destination}`, url: path }) });
            const sent = await notifyAll({ title: `🚗 Uber to ${destination}`, body: `Tap to open Uber: ${from} → ${t.addr}. Check the price, then confirm.`, url: path }).catch(() => 0);
            return `Uber trip ready: ${from} → ${t.addr}. ${sent ? "Sent to his phone as a notification." : "Phone alerts aren't on, so it's only in the chat."} An "Open Uber" button shows under your reply; don't paste a link. In voice, say it's on his phone. Remind him he confirms the ride and price in Uber.`;
          } catch (err) {
            return `Couldn't make the Uber link: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
    );

    tools.push(
      betaZodTool({
        name: "weather",
        description: `Current weather, the next 12 hours, and the daily forecast from Google Weather. Defaults to Tommy's home (${homePlace()}). Use this for any weather question and for briefings, instead of web search.`,
        inputSchema: z.object({
          place: z.string().optional().describe("City or area, only if he asks about somewhere other than home"),
          days: z.number().int().min(1).max(10).optional().describe("Days of forecast; default 3"),
        }),
        run: async ({ place, days }) => {
          try {
            const r = await weatherReport(place, days ?? 3);
            emit({ type: "tool", name: "weather", detail: place || homePlace() });
            return r;
          } catch (err) {
            console.error("[weather]", err instanceof Error ? err.message : err);
            return `${err instanceof Error ? err.message : String(err)} Tell Tommy this exact error in one sentence, then use web_search for the weather.`;
          }
        },
      }),
    );
  }

  tools.push(
    betaZodTool({
      name: "create_campaign",
      description:
        "Create an outreach campaign (as a draft). Write a complete brief: who to target (trade, city), the offer, tone, the call to action, and any link. If Saleshandy is connected, campaigns fill a Saleshandy sequence by default (Saleshandy sends; the brief tells the Prospector who to find); pass send_with 'gmail' only if Tommy wants Jarvis to send himself. Tommy approves it once on the Outreach page.",
      inputSchema: z.object({
        name: z.string(),
        brief: z.string().min(80),
        daily_limit: z.number().int().min(1).max(40).optional(),
        send_with: z.enum(["saleshandy", "gmail"]).optional(),
        saleshandy_sequence: z.string().optional().describe("Part of the Saleshandy sequence's name; defaults to the first active one"),
      }),
      run: async ({ name, brief, daily_limit, send_with, saleshandy_sequence }) => {
        const { createCampaign } = await import("@/lib/outreach/outreach");
        const { findAgent } = await import("@/lib/crews/crews");
        const { listSequences, saleshandyConfigured } = await import("@/lib/integrations/saleshandy");
        let saleshandy: { sequenceId: string; sequenceName: string; stepId: string } | null = null;
        if (send_with !== "gmail" && saleshandyConfigured()) {
          const seqs = (await listSequences().catch(() => [])).filter((q) => q.steps.length);
          const pick = saleshandy_sequence
            ? seqs.find((q) => q.title.toLowerCase().includes(saleshandy_sequence.toLowerCase()))
            : (seqs.find((q) => q.active) ?? seqs[0]);
          if (!pick && send_with === "saleshandy") return `No Saleshandy sequence matched${saleshandy_sequence ? ` "${saleshandy_sequence}"` : ""}. Ask Tommy which sequence, or to create one in Saleshandy first.`;
          if (pick) saleshandy = { sequenceId: pick.id, sequenceName: pick.title, stepId: pick.steps[0].id };
        }
        const c = createCampaign({ name, brief, dailyLimit: daily_limit, businessId: findAgent(AGENCY_NAME, "Prospector").business?.id, saleshandy });
        emit({ type: "tool", name: "create_campaign", detail: c.name });
        return saleshandy
          ? `Campaign #${c.id} "${c.name}" created as a draft that fills the Saleshandy sequence "${saleshandy.sequenceName}". Tommy approves it on the Outreach page. Next: delegate to the Prospector to find companies.`
          : `Campaign #${c.id} "${c.name}" created as a draft. Sample emails are being written; Tommy approves it on the Outreach page. Next: delegate to the Prospector to find companies (they're added with add_leads).`;
      },
    }),
    betaZodTool({
      name: "outreach_status",
      description: "Outreach campaigns: status, emails sent, replies, interested leads, and anything waiting on Tommy.",
      inputSchema: z.object({}),
      run: async () => {
        const { listCampaigns, campaignStats } = await import("@/lib/outreach/outreach");
        const list = listCampaigns();
        emit({ type: "tool", name: "outreach_status", detail: `${list.length} campaigns` });
        if (!list.length) return "No campaigns yet.";
        return list
          .map((c) => {
            const s = campaignStats(c.id);
            return `#${c.id} ${c.name} [${c.status}${c.stopReason ? `: ${c.stopReason}` : ""}] leads ${s.leads}, sent ${s.sent}, by status ${JSON.stringify(s.byStatus)}`;
          })
          .join("\n");
      },
    }),
  );

  if (driveConnected()) {
    tools.push(
      betaZodTool({
        name: "save_to_drive",
        description: "Save a document (plans, packages, reports, lists) as a Google Doc in the Jarvis folder of Tommy's Drive. Returns the link.",
        inputSchema: z.object({ title: z.string(), markdown: z.string().describe("The content, in simple Markdown") }),
        run: async ({ title, markdown }) => {
          try {
            const link = await saveDoc(title, markdown);
            emit({ type: "tool", name: "save_to_drive", detail: title });
            return `Saved: ${link}`;
          } catch (err) {
            return `Couldn't save to Drive: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
    );
  }

  if (etsyConnected()) {
    tools.push(
      betaZodTool({
        name: "etsy_summary",
        description: "Tommy's Etsy shop: sales this week and month, orders this week, recent orders and latest reviews.",
        inputSchema: z.object({}),
        run: async () => {
          emit({ type: "tool", name: "etsy_summary", detail: "Etsy" });
          try {
            return JSON.stringify(await etsySummary());
          } catch (err) {
            return `Couldn't reach Etsy: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
    );
  }

  if (stripeConfigured()) {
    tools.push(
      betaZodTool({
        name: "stripe_summary",
        description: "Tommy's Stripe numbers: money in this week and this month, monthly recurring revenue, active subscriptions, recent payments.",
        inputSchema: z.object({}),
        run: async () => {
          emit({ type: "tool", name: "stripe_summary", detail: "Stripe" });
          try {
            return JSON.stringify(await stripeSummary());
          } catch (err) {
            return `Couldn't reach Stripe: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      betaZodTool({
        name: "request_payment_link",
        description:
          "Ask Tommy to approve creating a Stripe payment link (one-time or monthly). The link is created only after he taps Approve.",
        inputSchema: z.object({
          name: z.string().describe("What the customer is paying for, e.g. 'Map Pack Pro — monthly'"),
          amount_usd: z.number().positive(),
          monthly: z.boolean(),
          why: z.string(),
        }),
        run: async ({ name, amount_usd, monthly, why }) => {
          const a = createApproval({
            what: `Create a Stripe payment link: ${name}, $${amount_usd}${monthly ? "/month" : ""}`,
            why,
            action: { type: "stripe_payment_link", name, amountUsd: amount_usd, monthly },
          });
          emit({ type: "tool", name: "ask_approval", detail: a.what });
          return `Approval #${a.id} is on Tommy's dashboard. Once he approves, the link appears in the approval result and a notification.`;
        },
      }),
    );
  }

  if (gmailConnected()) {
    tools.push(
      betaZodTool({
        name: "gmail_search",
        description:
          "Search Tommy's Gmail with Gmail search syntax (e.g. 'is:unread newer_than:1d', 'from:etsy.com', 'subject:invoice'). Returns sender, subject, date and a snippet.",
        inputSchema: z.object({ query: z.string(), max: z.number().int().min(1).max(25).optional() }),
        run: async ({ query, max }) => {
          emit({ type: "tool", name: "gmail_search", detail: query });
          try {
            const found = await gmailSearch(query, max ?? 10);
            return found.length
              ? found.map((m) => `[${m.id}] ${m.unread ? "(unread) " : ""}${m.date} | ${m.from} | ${m.subject} | ${m.snippet}`).join("\n")
              : "No emails found.";
          } catch (err) {
            return `Couldn't search Gmail: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      betaZodTool({
        name: "gmail_read",
        description: "Read one email in full by its id (from gmail_search).",
        inputSchema: z.object({ id: z.string() }),
        run: async ({ id }) => {
          try {
            const m = await gmailRead(id);
            return `From: ${m.from}\nTo: ${m.to}\nDate: ${m.date}\nSubject: ${m.subject}\n\n${m.body}`;
          } catch (err) {
            return `Couldn't read it: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
      betaZodTool({
        name: "email_draft",
        description:
          "Write an email as a draft in Tommy's Gmail. Set request_send to put a send approval on his dashboard; it's sent only if he approves. Without request_send it just waits in Drafts.",
        inputSchema: z.object({
          to: z.string(),
          subject: z.string(),
          body: z.string(),
          request_send: z.boolean(),
        }),
        run: async ({ to, subject, body, request_send }) => {
          const draft = await createDraft(to, subject, body);
          emit({ type: "tool", name: "email_draft", detail: subject });
          if (!request_send) return "Saved in Gmail Drafts.";
          const a = createApproval({
            what: `Send email to ${to}: "${subject}"`,
            why: "Drafted by Jarvis at Tommy's request.",
            action: { type: "gmail_send", draftId: draft.id, to, subject },
          });
          return `Saved in Gmail Drafts; approval #${a.id} to send it is on Tommy's dashboard.`;
        },
      }),
    );
  }

  if (calendarConfigured()) {
    tools.push(
      betaZodTool({
        name: "calendar_events",
        description:
          "Read Tommy's Google Calendar (read-only). Returns events from the start of today for the given number of days.",
        inputSchema: z.object({ days: z.number().int().min(1).max(14).describe("How many days to look ahead, including today") }),
        run: async ({ days }) => {
          const from = new Date();
          from.setHours(0, 0, 0, 0);
          const to = new Date(from.getTime() + days * 86_400_000);
          try {
            const events = await eventsBetween(from, to);
            emit({ type: "tool", name: "calendar_events", detail: `${events.length} events` });
            return events.length ? events.map(describeEvent).join("\n") : "Nothing on the calendar.";
          } catch (err) {
            return `Couldn't read the calendar: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      }),
    );
  }
  return tools;
}
