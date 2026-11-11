// To-do reminders: when a to-do's due time arrives, Jarvis sends one notification to Tommy's phone.
import { and, eq, isNotNull, isNull, lte, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { notifyAll } from "@/lib/push";

export async function sendDueReminders() {
  const t = schema.todos;
  const now = new Date();
  const due = getDb()
    .select()
    .from(t)
    .where(
      and(
        eq(t.done, false),
        isNull(t.notifiedAt),
        isNotNull(t.dueAt),
        lte(t.dueAt, now),
        // Don't fire a pile of stale reminders (e.g. after downtime): only things due in the last 6 hours.
        gte(t.dueAt, new Date(now.getTime() - 6 * 3_600_000)),
      ),
    )
    .all();
  for (const todo of due) {
    // Mark first, so a slow send can never cause a double notification.
    getDb().update(t).set({ notifiedAt: now }).where(eq(t.id, todo.id)).run();
    await notifyAll({ title: "Reminder", body: todo.title, url: "/todos", tag: `todo-${todo.id}` });
  }
}
