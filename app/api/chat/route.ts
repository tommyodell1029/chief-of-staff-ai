// POST /api/chat — send Jarvis a message; the reply streams back as one JSON object per line.
import { addMessage, conversationExists, getMessages, latestConversationId } from "@/lib/conversations";
import { runJarvisTurn, type JarvisEvent, type TurnInput } from "@/lib/jarvis/orchestrator";
import { checkRateLimit, spendToday } from "@/lib/spend";

export const dynamic = "force-dynamic";

type StreamEvent = JarvisEvent | { type: "conversation"; id: number } | { type: "spend"; spend: ReturnType<typeof spendToday> };

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as {
    message?: string;
    mode?: "voice" | "text";
    conversationId?: number;
    image?: string; // data URL from the camera
  };
  let image: TurnInput["image"];
  if (body.image) {
    const m = body.image.match(/^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/);
    if (!m) return Response.json({ error: "Unsupported image" }, { status: 400 });
    if (m[2].length > 7_000_000) return Response.json({ error: "Photo too large" }, { status: 413 });
    image = { mediaType: m[1] as NonNullable<TurnInput["image"]>["mediaType"], data: m[2] };
  }
  const message = body.message?.trim() || (image ? "What's this?" : "");
  if (!message) return Response.json({ error: "Empty message" }, { status: 400 });
  const mode = body.mode === "voice" ? "voice" : "text";

  if (!checkRateLimit()) {
    return Response.json({ error: "Easy, sir — too many messages this minute. Give me a moment." }, { status: 429 });
  }
  const spend = spendToday();
  if (spend.overMonthCap) {
    return Response.json(
      { error: `This month's AI budget ($${spend.monthCapUsd.toFixed(2)}) has been used up. Raise MONTHLY_SPEND_CAP_USD if you want more.` },
      { status: 402 },
    );
  }
  if (spend.overCap) {
    return Response.json(
      { error: `Today's AI spending cap ($${spend.capUsd.toFixed(2)}) has been reached. Raise DAILY_SPEND_CAP_USD in .env if you need more.` },
      { status: 402 },
    );
  }

  const conversationId =
    body.conversationId && conversationExists(body.conversationId) ? body.conversationId : latestConversationId();
  const history = getMessages(conversationId).map((m) => ({ role: m.role, content: m.content }));
  // Photos aren't stored; the conversation keeps a marker so later turns know one was sent.
  addMessage(conversationId, "user", image ? `📷 [photo] ${message}` : message, mode);

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: StreamEvent) => controller.enqueue(encoder.encode(JSON.stringify(e) + "\n"));
      send({ type: "conversation", id: conversationId });
      let model: string | undefined;
      try {
        for await (const e of runJarvisTurn({
          message,
          mode,
          history,
          conversationId,
          image,
          signal: req.signal,
        })) {
          if (e.type === "model") model = e.model;
          if (e.type === "done" && e.text) addMessage(conversationId, "assistant", e.text, mode, model);
          send(e);
        }
        send({ type: "spend", spend: spendToday() });
      } catch (err) {
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "Content-Type": "application/x-ndjson; charset=utf-8", "Cache-Control": "no-cache, no-transform" },
  });
}
