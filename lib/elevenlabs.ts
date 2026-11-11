// ElevenLabs speech-to-text and text-to-speech.
import { VOICE } from "@/config/models";

const BASE = "https://api.elevenlabs.io/v1";

function apiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error("ELEVENLABS_API_KEY is missing from .env");
  return key;
}

export async function transcribe(audio: Blob, filename: string): Promise<string> {
  const form = new FormData();
  form.append("model_id", VOICE.sttModel);
  form.append("file", audio, filename);
  const res = await fetch(`${BASE}/speech-to-text`, {
    method: "POST",
    headers: { "xi-api-key": apiKey() },
    body: form,
  });
  if (!res.ok) throw new Error(`ElevenLabs STT failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const data = (await res.json()) as { text?: string };
  return (data.text ?? "").trim();
}

// Returns ElevenLabs' streaming MP3 response so audio starts playing before it's fully generated.
export async function speakStream(text: string, signal?: AbortSignal): Promise<Response> {
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  if (!voiceId) throw new Error("ELEVENLABS_VOICE_ID is missing from .env");
  const res = await fetch(
    `${BASE}/text-to-speech/${encodeURIComponent(voiceId)}/stream?output_format=${VOICE.ttsOutputFormat}`,
    {
      method: "POST",
      headers: { "xi-api-key": apiKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
      body: JSON.stringify({ text, model_id: VOICE.ttsModel }),
      signal,
    },
  );
  if (!res.ok || !res.body) throw new Error(`ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return res;
}

// Whole MP3 at once (for saving a voiceover file), in any voice.
export async function speakToBuffer(
  text: string,
  voiceId: string,
  settings?: { stability: number; similarity_boost: number; style?: number; use_speaker_boost?: boolean },
): Promise<Buffer> {
  const res = await fetch(`${BASE}/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${VOICE.ttsOutputFormat}`, {
    method: "POST",
    headers: { "xi-api-key": apiKey(), "Content-Type": "application/json", Accept: "audio/mpeg" },
    body: JSON.stringify({ text, model_id: "eleven_multilingual_v2", ...(settings ? { voice_settings: settings } : {}) }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs TTS failed (${res.status}): ${(await res.text()).slice(0, 300)}`);
  return Buffer.from(await res.arrayBuffer());
}
