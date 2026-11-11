// GET /api/tts?text=... — streams Jarvis's voice as MP3.
// It's a GET so the browser's <audio> element can play it while it's still downloading.
import { speakStream } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const text = new URL(req.url).searchParams.get("text")?.trim().slice(0, 1500);
  if (!text) return new Response("Missing text", { status: 400 });
  try {
    const upstream = await speakStream(text, req.signal);
    return new Response(upstream.body, {
      headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" },
    });
  } catch (err) {
    console.error("[tts]", err);
    return new Response(err instanceof Error ? err.message : "TTS failed", { status: 500 });
  }
}
