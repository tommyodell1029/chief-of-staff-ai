// GET /api/conversation — the current conversation and its messages.
// POST /api/conversation — start a fresh conversation (memories are kept).
import { getMessages, latestConversationId, newConversation } from "@/lib/conversations";

export const dynamic = "force-dynamic";

export async function GET() {
  const id = latestConversationId();
  const messages = getMessages(id).map((m) => ({ id: m.id, role: m.role, content: m.content, mode: m.mode, model: m.model }));
  return Response.json({ id, messages });
}

export async function POST() {
  return Response.json({ id: newConversation(), messages: [] });
}
