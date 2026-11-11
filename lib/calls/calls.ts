// Phone calls Jarvis makes for Tommy. Every call is approved by Tommy first (it goes to "Waiting on you" showing
// exactly who will be called and what will be asked). Calls only go out 9 am–8 pm local time, at most
// CALLS_DAILY_LIMIT a day (default 5), never to emergency, crisis or premium numbers. When a call ends,
// Jarvis reads the transcript, sends Tommy the result, and adds bookings to his to-dos.
import { betaZodTool } from "@anthropic-ai/sdk/helpers/beta/zod";
import { and, desc, eq, gte, inArray } from "drizzle-orm";
import { z } from "zod";
import { MODELS } from "@/config/models";
import { runJob } from "@/lib/ai";
import { createApproval } from "@/lib/crews/crews";
import { getDb, schema } from "@/lib/db";
import type { Call } from "@/lib/db/schema";
import { getCall, startCall } from "@/lib/integrations/elevenAgents";
import { notifyAll } from "@/lib/push";
import { addTodo } from "@/lib/todos";

const db = () => getDb();

export const callerName = () => process.env.CALLER_NAME || "Your Name";
const callbackNumber = () => process.env.TOMMY_PHONE || "";
const dailyLimit = () => Number(process.env.CALLS_DAILY_LIMIT || 5);

const CARIBBEAN = new Set(["242", "246", "264", "268", "284", "345", "441", "473", "649", "658", "664", "721", "758", "767", "784", "809", "829", "849", "868", "869", "876"]);

// US numbers only, as +1XXXXXXXXXX. Emergency, crisis, information and premium-rate numbers are refused.
export function normalizeNumber(input: string): string {
  const digits = input.replace(/[^\d]/g, "");
  const ten = digits.length === 11 && digits.startsWith("1") ? digits.slice(1) : digits;
  if (ten.length !== 10) throw new Error(`"${input}" isn't a 10-digit US phone number.`);
  const area = ten.slice(0, 3);
  if (/^[2-9]11$/.test(area) || /^(900|976)$/.test(area) || /^[01]/.test(area)) throw new Error(`Jarvis won't call ${input}.`);
  // +1 numbers outside the US and Canada (Caribbean and Bermuda) cost far more and are common in call scams.
  if (CARIBBEAN.has(area)) throw new Error(`${input} is outside the US and Canada; Jarvis only calls US and Canadian numbers.`);
  return `+1${ten}`;
}
const BLOCKED_SHORT = /^(911|988|411|611|711|811|311|211|511)$/;

// CALLS_ONLY_TO (optional): a comma-separated list of numbers. While set, Jarvis can call only those numbers
// (e.g. just Tommy's cell while testing). Remove it to let him call businesses.
export function allowedOnly(): string[] | null {
  const raw = process.env.CALLS_ONLY_TO?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((n) => {
      try {
        return normalizeNumber(n);
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}
function checkAllowed(toNumber: string) {
  const only = allowedOnly();
  if (only && !only.includes(toNumber)) {
    throw new Error(`Calls are limited to ${only.join(", ")} right now (CALLS_ONLY_TO in Render). Remove that setting to call ${toNumber}.`);
  }
}
export const tommyNumber = () => {
  try {
    return process.env.TOMMY_PHONE ? normalizeNumber(process.env.TOMMY_PHONE) : null;
  } catch {
    return null;
  }
};

function localHour() {
  const tz = process.env.TZ || "America/New_York";
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hour12: false }).format(new Date())) % 24;
}
export const inCallingHours = () => {
  const h = localHour();
  return h >= 9 && h < 20;
};

export function listCalls(limit = 50) {
  return db().select().from(schema.calls).orderBy(desc(schema.calls.createdAt)).limit(limit).all();
}

// Called by Jarvis's phone_call tool: saves the call and asks Tommy to approve it.
export function requestCall(c: { business: string; phone: string; task: string; details: string; opening: string }): Call {
  if (BLOCKED_SHORT.test(c.phone.replace(/[^\d]/g, ""))) throw new Error("Jarvis won't call emergency or service numbers.");
  const toNumber = normalizeNumber(c.phone);
  checkAllowed(toNumber);
  const row = db()
    .insert(schema.calls)
    .values({ business: c.business, toNumber, task: c.task, details: c.details, opening: c.opening })
    .returning()
    .get();
  createApproval({
    what: `Call ${c.business} (${toNumber}) to ${c.task}.\n\nDetails and limits: ${c.details}\n\nIt will open with: "Hi, this is Jarvis, an AI assistant calling for ${callerName()}. This call may be transcribed. ${c.opening}"`,
    why: `You asked Jarvis to make this call. It goes out when you approve (between 9 am and 8 pm). The caller won't pay, pre-pay or give card details; if they need that, you'll get a note to call back.`,
    action: { type: "phone_call", callId: row.id },
  });
  return row;
}

function callsStartedToday() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  return db()
    .select()
    .from(schema.calls)
    .where(and(inArray(schema.calls.status, ["calling", "done", "failed"]), gte(schema.calls.startedAt, start)))
    .all().length;
}

async function dial(call: Call): Promise<string> {
  checkAllowed(call.toNumber); // checked again in case the setting changed after approval
  if (callsStartedToday() >= dailyLimit()) {
    db().update(schema.calls).set({ status: "queued" }).where(eq(schema.calls.id, call.id)).run();
    return `Today's call limit (${dailyLimit()}) is used up, so the call to ${call.business} goes out tomorrow morning.`;
  }
  const conversationId = await startCall({
    to: call.toNumber,
    vars: {
      caller_name: callerName(),
      business_name: call.business,
      task: call.task,
      details: call.details,
      opening: call.opening,
      callback_number: callbackNumber() || "(don't give a number; say they'll call back)",
    },
  });
  db().update(schema.calls).set({ status: "calling", conversationId, startedAt: new Date(), error: null }).where(eq(schema.calls.id, call.id)).run();
  return `Calling ${call.business} now. You'll get the result when the call ends.`;
}

// Runs when Tommy taps Approve.
export async function placeApprovedCall(callId: number): Promise<string> {
  const call = db().select().from(schema.calls).where(eq(schema.calls.id, callId)).get();
  if (!call) throw new Error("That call request is gone.");
  if (call.status !== "awaiting_approval" && call.status !== "queued") return `That call was already ${call.status}.`;
  if (!inCallingHours()) {
    db().update(schema.calls).set({ status: "queued" }).where(eq(schema.calls.id, call.id)).run();
    return `Approved. It's outside calling hours, so Jarvis will call ${call.business} after 9 am.`;
  }
  try {
    return await dial(call);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[calls] call #${call.id} to ${call.business} failed: ${msg}`);
    db().update(schema.calls).set({ status: "failed", error: msg }).where(eq(schema.calls.id, call.id)).run();
    throw err;
  }
}

export function markDenied(callId: number) {
  db().update(schema.calls).set({ status: "denied" }).where(and(eq(schema.calls.id, callId), eq(schema.calls.status, "awaiting_approval"))).run();
}

interface Outcome {
  outcome: "booked" | "done" | "not_available" | "no_answer" | "voicemail" | "needs_tommy" | "failed";
  summary: string;
  booking_time?: string | null; // ISO local date-time of the reservation/appointment, if one was made
  follow_up?: string | null; // what Tommy needs to do, if anything
}

async function understand(call: Call, transcript: string): Promise<Outcome> {
  let out: Outcome | null = null;
  const tool = betaZodTool({
    name: "result",
    description: "Record the call result.",
    inputSchema: z.object({
      outcome: z.enum(["booked", "done", "not_available", "no_answer", "voicemail", "needs_tommy", "failed"]),
      summary: z.string().describe("One or two plain sentences for Tommy, with the exact day/time/name/confirmation number if any."),
      booking_time: z.string().nullable().optional().describe("If a reservation/appointment was confirmed: its local date-time as YYYY-MM-DDTHH:MM"),
      follow_up: z.string().nullable().optional().describe("Anything Tommy must do (call back to pay a deposit, pick a time…)"),
    }),
    run: async (r) => {
      out = r;
      return "ok";
    },
  });
  await runJob({
    purpose: "call_result",
    model: MODELS.worker,
    system: `You read the transcript of a phone call an AI assistant made for Tommy and record what happened. Today is ${new Date().toDateString()}. Be exact and don't invent anything that wasn't said. "booked" only if the other side clearly confirmed it.`,
    prompt: `Call to ${call.business}. Goal: ${call.task}. Limits: ${call.details}\n\nTranscript:\n${transcript || "(no one spoke)"}`,
    tools: [tool],
    maxIterations: 2,
    maxTokens: 800,
  });
  return out ?? { outcome: "failed", summary: "Couldn't read the call result." };
}

function parseLocal(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  const tz = process.env.TZ || "America/New_York";
  // Find the UTC instant whose local time in Tommy's zone matches.
  const guess = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  const asLocal = new Date(new Date(guess).toLocaleString("en-US", { timeZone: tz }));
  const asUtc = new Date(new Date(guess).toLocaleString("en-US", { timeZone: "UTC" }));
  return new Date(guess + (asUtc.getTime() - asLocal.getTime()));
}

// Scheduler, every minute: place approved calls waiting for calling hours, and collect finished calls.
export async function processCalls() {
  if (inCallingHours()) {
    for (const call of db().select().from(schema.calls).where(eq(schema.calls.status, "queued")).limit(2).all()) {
      try {
        const msg = await dial(call);
        if (msg.startsWith("Calling")) await notifyAll({ title: `📞 Calling ${call.business}`, body: call.task, url: "/calls" }).catch(() => {});
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error(`[calls] call #${call.id} to ${call.business} failed: ${msg}`);
        db().update(schema.calls).set({ status: "failed", error: msg }).where(eq(schema.calls.id, call.id)).run();
        await notifyAll({ title: `Couldn't call ${call.business}`, body: msg.slice(0, 180), url: "/calls" }).catch(() => {});
      }
    }
  }
  for (const call of db().select().from(schema.calls).where(eq(schema.calls.status, "calling")).all()) {
    if (!call.conversationId) continue;
    let r;
    try {
      r = await getCall(call.conversationId);
    } catch {
      continue; // try again next minute
    }
    if (r.status !== "done" && r.status !== "failed") {
      // Give up waiting after 30 minutes.
      if (call.startedAt && Date.now() - call.startedAt.getTime() > 30 * 60_000) {
        db().update(schema.calls).set({ status: "failed", error: "No result after 30 minutes." }).where(eq(schema.calls.id, call.id)).run();
      }
      continue;
    }
    const transcript = r.transcript
      .filter((t) => t.message)
      .map((t) => `${t.role === "agent" ? "Jarvis" : call.business}: ${t.message}`)
      .join("\n");
    const o = r.status === "failed" && !transcript ? ({ outcome: "failed", summary: `The call didn't connect${r.endReason ? ` (${r.endReason})` : ""}.` } as Outcome) : await understand(call, transcript);
    db()
      .update(schema.calls)
      .set({ status: o.outcome === "failed" ? "failed" : "done", outcome: o.outcome, summary: [o.summary, o.follow_up].filter(Boolean).join(" Next: "), transcript, endedAt: new Date() })
      .where(eq(schema.calls.id, call.id))
      .run();
    if (o.outcome === "booked" && o.booking_time) {
      const when = parseLocal(o.booking_time);
      if (when && when.getTime() > Date.now()) addTodo(`${call.business}: ${call.task.replace(/^(book|make|get)\s+/i, "")}`, when);
    }
    if (o.follow_up) addTodo(`Call ${call.business} back: ${o.follow_up}`);
    const icon = o.outcome === "booked" || o.outcome === "done" ? "✅" : o.outcome === "needs_tommy" ? "👉" : "📞";
    await notifyAll({ title: `${icon} ${call.business}`, body: o.summary.slice(0, 180), url: "/calls" }).catch(() => {});
  }
}
