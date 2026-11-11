// POST /api/stt — browser mic recording in, text out.
import { transcribe } from "@/lib/elevenlabs";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const form = await req.formData();
    const audio = form.get("audio");
    if (!(audio instanceof Blob) || audio.size === 0) {
      return Response.json({ error: "No audio received" }, { status: 400 });
    }
    if (audio.size > 25 * 1024 * 1024) return Response.json({ error: "Recording too long" }, { status: 413 });
    const name = audio instanceof File && audio.name ? audio.name : "speech.webm";
    return Response.json({ text: await transcribe(audio, name) });
  } catch (err) {
    console.error("[stt]", err);
    return Response.json({ error: err instanceof Error ? err.message : "Transcription failed" }, { status: 500 });
  }
}
