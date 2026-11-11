// POST /api/push/test — send a test notification to every device that has them on.
import { notifyAll } from "@/lib/push";

export const dynamic = "force-dynamic";

export async function POST() {
  const sent = await notifyAll({
    title: "Jarvis",
    body: "Notifications are on, sir. I'll ping you when a briefing is ready or a to-do comes due.",
    url: "/",
    tag: "test",
  });
  return Response.json({ sent });
}
