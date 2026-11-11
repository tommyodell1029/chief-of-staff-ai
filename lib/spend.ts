// Cost logging, the daily and monthly spending caps, and a simple per-minute rate limit.
import { gte, sql } from "drizzle-orm";
import { PRICING, WEB_SEARCH_USD_PER_SEARCH } from "@/config/models";
import { getDb, schema } from "@/lib/db";

export interface CallUsage {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  webSearches?: number;
  costUsd?: number; // if the SDK reported it; otherwise estimated from PRICING
}

export function estimateCost(u: CallUsage): number {
  const searches = (u.webSearches ?? 0) * WEB_SEARCH_USD_PER_SEARCH;
  const p = PRICING[u.model];
  if (!p) return searches;
  // Cache writes cost ~1.25x input; close enough for a dashboard estimate.
  return (
    (u.inputTokens * p.input +
      u.outputTokens * p.output +
      u.cacheReadTokens * p.cacheRead +
      u.cacheWriteTokens * p.input * 1.25) /
      1_000_000 +
    searches
  );
}

export function logAiCall(purpose: string, u: CallUsage, conversationId?: number) {
  const costUsd = u.costUsd ?? estimateCost(u);
  getDb()
    .insert(schema.aiCalls)
    .values({
      purpose,
      model: u.model,
      inputTokens: u.inputTokens,
      outputTokens: u.outputTokens,
      cacheReadTokens: u.cacheReadTokens,
      cacheWriteTokens: u.cacheWriteTokens,
      costUsd,
      conversationId,
    })
    .run();
  console.log(
    `[ai] ${purpose} ${u.model} in=${u.inputTokens} out=${u.outputTokens} cacheRead=${u.cacheReadTokens} $${costUsd.toFixed(4)}`,
  );
  return costUsd;
}

function startOfToday(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function startOfMonth(): Date {
  const d = startOfToday();
  d.setDate(1);
  return d;
}

function capFromEnv(name: string, fallback: number): number {
  const cap = Number(process.env[name]);
  return Number.isFinite(cap) && cap > 0 ? cap : fallback;
}

export const dailyCapUsd = () => capFromEnv("DAILY_SPEND_CAP_USD", 3);
export const monthlyCapUsd = () => capFromEnv("MONTHLY_SPEND_CAP_USD", 35);

export function spentSince(since: Date) {
  const row = getDb()
    .select({
      total: sql<number>`coalesce(sum(${schema.aiCalls.costUsd}), 0)`,
      calls: sql<number>`count(*)`,
    })
    .from(schema.aiCalls)
    .where(gte(schema.aiCalls.createdAt, since))
    .get();
  return { total: row?.total ?? 0, calls: row?.calls ?? 0 };
}

// Today's and this month's AI spend against the caps. The meter shows whichever is closer to its cap.
export function spendToday() {
  const day = spentSince(startOfToday());
  const month = spentSince(startOfMonth());
  const cap = dailyCapUsd();
  const monthCap = monthlyCapUsd();
  const fraction = Math.max(day.total / cap, month.total / monthCap);
  return {
    totalUsd: day.total,
    calls: day.calls,
    capUsd: cap,
    monthUsd: month.total,
    monthCapUsd: monthCap,
    fraction,
    warning: fraction >= 0.8,
    overCap: day.total >= cap,
    overMonthCap: month.total >= monthCap,
  };
}

// ---- Rate limit (in memory; resets when the app restarts) ----
const recent: number[] = [];

export function checkRateLimit(): boolean {
  const limit = Number(process.env.MAX_REQUESTS_PER_MINUTE) || 20;
  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= limit) return false;
  recent.push(now);
  return true;
}
