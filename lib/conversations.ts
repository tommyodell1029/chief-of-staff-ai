// Chat history helpers.
import { asc, desc, eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";

export function latestConversationId(): number {
  const db = getDb();
  const row = db.select().from(schema.conversations).orderBy(desc(schema.conversations.id)).limit(1).get();
  return row?.id ?? newConversation();
}

export function newConversation(): number {
  return getDb().insert(schema.conversations).values({}).returning().get().id;
}

export function conversationExists(id: number): boolean {
  return !!getDb().select().from(schema.conversations).where(eq(schema.conversations.id, id)).get();
}

export function getMessages(conversationId: number) {
  return getDb()
    .select()
    .from(schema.messages)
    .where(eq(schema.messages.conversationId, conversationId))
    .orderBy(asc(schema.messages.id))
    .all();
}

export function addMessage(
  conversationId: number,
  role: "user" | "assistant",
  content: string,
  mode: "voice" | "text",
  model?: string,
) {
  return getDb()
    .insert(schema.messages)
    .values({ conversationId, role, content, mode, model })
    .returning()
    .get();
}
