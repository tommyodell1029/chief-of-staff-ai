// Tommy's to-dos and reminders.
import { and, asc, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { Todo } from "@/lib/db/schema";

export function listTodos(includeDone = false, limit = 100): Todo[] {
  const t = schema.todos;
  const db = getDb();
  const open = db
    .select()
    .from(t)
    .where(eq(t.done, false))
    // Dated items first (soonest first), then undated, newest first.
    .orderBy(sql`${t.dueAt} is null`, asc(t.dueAt), desc(t.createdAt))
    .limit(limit)
    .all();
  if (!includeDone) return open;
  const done = db.select().from(t).where(eq(t.done, true)).orderBy(desc(t.completedAt)).limit(20).all();
  return [...open, ...done];
}

export function addTodo(title: string, dueAt?: Date | null): Todo {
  return getDb()
    .insert(schema.todos)
    .values({ title: title.trim(), dueAt: dueAt ?? null })
    .returning()
    .get();
}

export function setTodoDone(id: number, done: boolean): Todo | undefined {
  return getDb()
    .update(schema.todos)
    .set({ done, completedAt: done ? new Date() : null })
    .where(eq(schema.todos.id, id))
    .returning()
    .get();
}

export function updateTodo(id: number, changes: { title?: string; dueAt?: Date | null }): Todo | undefined {
  // A new due time gets a fresh reminder.
  const set = changes.dueAt !== undefined ? { ...changes, notifiedAt: null } : changes;
  return getDb().update(schema.todos).set(set).where(eq(schema.todos.id, id)).returning().get();
}

export function deleteTodo(id: number) {
  getDb().delete(schema.todos).where(eq(schema.todos.id, id)).run();
}

// Find an open to-do by id, or by words in its title ("the oil change one").
export function findOpenTodo(idOrText: number | string): Todo | undefined {
  const t = schema.todos;
  if (typeof idOrText === "number") {
    return getDb().select().from(t).where(and(eq(t.id, idOrText), eq(t.done, false))).get();
  }
  const words = idOrText.toLowerCase().split(/\W+/).filter((w) => w.length > 2);
  let best: { todo: Todo; score: number } | undefined;
  for (const todo of listTodos()) {
    const title = todo.title.toLowerCase();
    const score = words.filter((w) => title.includes(w)).length;
    if (score > 0 && (!best || score > best.score)) best = { todo, score };
  }
  return best?.todo;
}

// "Due Fri 3:00 PM" style, in Tommy's time zone.
export function formatDue(d: Date | null): string {
  if (!d) return "";
  return d.toLocaleString("en-US", {
    weekday: "short",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: process.env.TZ || undefined,
  });
}
