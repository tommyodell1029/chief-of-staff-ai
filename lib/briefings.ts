// Scheduled briefings: Jarvis prepares them on his own and they wait on the dashboard until Tommy plays them.
import { and, desc, gte, isNull, eq } from "drizzle-orm";
import { MODELS } from "@/config/models";
import { addMessage, getMessages, latestConversationId } from "@/lib/conversations";
import { getDb, schema } from "@/lib/db";
import type { Briefing } from "@/lib/db/schema";
import { runJarvisTurn } from "@/lib/jarvis/orchestrator";
import { notifyAll } from "@/lib/push";
import { spendToday } from "@/lib/spend";

export type BriefingKind = "morning" | "lunch" | "evening";

const REQUESTS: Record<BriefingKind, string> = {
  morning: "Brief me.",
  lunch: "Give me my lunch check-in.",
  evening: "Give me my evening review.",
};

export const BRIEFING_TITLES: Record<string, string> = {
  morning: "Morning briefing",
  lunch: "Lunch check-in",
  evening: "Evening review",
};

export async function runBriefing(kind: BriefingKind): Promise<Briefing | null> {
  const spend = spendToday();
  if (spend.overCap || spend.overMonthCap) {
    console.log(`[briefing] skipped ${kind}: spending cap reached`);
    return null;
  }
  const conversationId = latestConversationId();
  const history = getMessages(conversationId).map((m) => ({ role: m.role, content: m.content }));
  let text = "";
  let model: string | undefined;
  for await (const e of runJarvisTurn({
    message: REQUESTS[kind],
    mode: "voice",
    history,
    conversationId,
    purpose: `briefing_${kind}`,
    // Sonnet at medium effort: good enough to plan the day, far cheaper than the full brain.
    model: { ...MODELS.fastVoice, effort: "medium" },
  })) {
    if (e.type === "model") model = e.model;
    if (e.type === "done") text = e.text;
    if (e.type === "error") {
      console.error(`[briefing] ${kind} failed: ${e.message}`);
      return null;
    }
  }
  if (!text) return null;
  addMessage(conversationId, "assistant", `${BRIEFING_TITLES[kind]}:\n${text}`, "voice", model);
  console.log(`[briefing] ${kind} ready`);
  const briefing = getDb().insert(schema.briefings).values({ kind, content: text }).returning().get();
  await notifyAll({ title: BRIEFING_TITLES[kind], body: `${text.length > 140 ? `${text.slice(0, 140)}…` : text} Tap to listen.`, url: "/", tag: "briefing", say: text }).catch(
    (err) => console.error("[briefing] notification failed:", err),
  );
  return briefing;
}

// The newest briefing Tommy hasn't played or dismissed, if it's from the last 12 hours.
export function unreadBriefing(): Briefing | undefined {
  const b = schema.briefings;
  return getDb()
    .select()
    .from(b)
    .where(and(isNull(b.readAt), gte(b.createdAt, new Date(Date.now() - 12 * 3_600_000))))
    .orderBy(desc(b.createdAt))
    .limit(1)
    .get();
}

export function markBriefingRead(id: number) {
  getDb().update(schema.briefings).set({ readAt: new Date() }).where(eq(schema.briefings.id, id)).run();
}
