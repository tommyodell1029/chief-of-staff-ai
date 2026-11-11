// Facts Jarvis has learned about Tommy.
import { desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Memory } from "@/lib/db/schema";

export function listMemories(limit = 500): Memory[] {
  return getDb()
    .select()
    .from(schema.memories)
    .orderBy(desc(schema.memories.createdAt))
    .limit(limit)
    .all();
}

export function addMemory(fact: string, category = "general", source = "conversation", confirmed = false) {
  return getDb()
    .insert(schema.memories)
    .values({ fact: fact.trim(), category: category.trim().toLowerCase() || "general", source, confirmed })
    .returning()
    .get();
}

export function updateMemory(id: number, changes: Partial<Pick<Memory, "fact" | "category" | "confirmed">>) {
  return getDb().update(schema.memories).set(changes).where(eq(schema.memories.id, id)).returning().get();
}

export function deleteMemory(id: number) {
  getDb().delete(schema.memories).where(eq(schema.memories.id, id)).run();
}

const STOP_WORDS = new Set(
  "a an and are do does did for from have has i i'm im is it me my of on or the to what when where which who why how you your about like".split(
    " ",
  ),
);

// Simple keyword search: scores each memory by how many query words it contains.
export function recallMemories(query: string, limit = 10): Memory[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter((w) => w.length > 1 && !STOP_WORDS.has(w));
  const all = listMemories();
  if (words.length === 0) return all.slice(0, limit);
  return all
    .map((m) => {
      const hay = `${m.fact} ${m.category}`.toLowerCase();
      // Match word stems loosely: "team" matches "teams", "yankee" matches "yankees".
      const score = words.reduce((s, w) => s + (hay.includes(w.replace(/s$/, "")) ? 1 : 0), 0);
      return { m, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.m);
}
