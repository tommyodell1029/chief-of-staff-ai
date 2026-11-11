// Image generation with Google's Gemini API (pay-per-use). Uses Jarvis's one Google key (GOOGLE_API_KEY, or the older GEMINI_API_KEY).
// Reference photos keep Nina's face and style consistent from post to post.
import sharp from "sharp";
import { GEMINI_IMAGE } from "@/config/models";
import { logAiCall } from "@/lib/spend";

// GOOGLE_API_KEY: Maps, Weather and YouTube. GEMINI_API_KEY: Gemini (Google asks for a separate key made in AI Studio).
// Either one alone works for everything it's allowed to do.
export const googleApiKey = () => process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
export const geminiApiKey = () => process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || "";

export function geminiConfigured(): boolean {
  return !!geminiApiKey();
}

interface Part {
  text?: string;
  inlineData?: { mimeType: string; data: string };
  inline_data?: { mime_type: string; data: string };
}

// Returns a JPEG (Instagram only accepts JPEG), 4:5 portrait by default.
const API = "https://generativelanguage.googleapis.com/v1beta";
let picked: { at: number; model: string } | null = null;

// The image model to use: asks Google which models this key can use (free), then takes the best available.
export async function imageModel(force = false): Promise<string> {
  if (!force && picked && Date.now() - picked.at < 6 * 3_600_000) return picked.model;
  const names: string[] = [];
  let pageToken = "";
  for (let i = 0; i < 5; i++) {
    const res = await fetch(`${API}/models?pageSize=200${pageToken ? `&pageToken=${pageToken}` : ""}`, { headers: { "x-goog-api-key": geminiApiKey() }, signal: AbortSignal.timeout(20_000) });
    const d = (await res.json().catch(() => ({}))) as { models?: { name: string; supportedGenerationMethods?: string[] }[]; nextPageToken?: string; error?: { message?: string } };
    if (!res.ok) {
      const msg = d.error?.message ?? `HTTP ${res.status}`;
      throw new Error(
        /API_KEY_SERVICE_BLOCKED|blocked|not been used|disabled/i.test(msg)
          ? `Gemini: ${process.env.GEMINI_API_KEY ? "your GEMINI_API_KEY" : "your Google key"} isn't allowed to use the Gemini API. Make a Gemini key in AI Studio (aistudio.google.com → Get API key) and add it in Render as GEMINI_API_KEY. (${msg})`
          : `Gemini: ${msg}`,
      );
    }
    for (const m of d.models ?? []) if (m.supportedGenerationMethods?.includes("generateContent")) names.push(m.name.replace(/^models\//, ""));
    if (!d.nextPageToken) break;
    pageToken = d.nextPageToken;
  }
  const wanted = [process.env.GEMINI_IMAGE_MODEL, ...GEMINI_IMAGE.preferred].filter(Boolean) as string[];
  const model =
    wanted.find((w) => names.includes(w)) ??
    names.filter((n) => /image/i.test(n) && !/imagen/i.test(n)).sort().reverse()[0];
  if (!model) throw new Error("Gemini: no image model is available to your key. Check that billing is on for the Google project (AI Studio → Plan / Billing).");
  picked = { at: Date.now(), model };
  return model;
}

export async function generateImage(
  prompt: string,
  refs: { mimeType: string; data: Buffer }[] = [],
  aspectRatio = "4:5",
): Promise<Buffer> {
  if (!geminiConfigured()) throw new Error("GEMINI_API_KEY isn't set. See docs/connections-setup.md.");
  try {
    return await makeImage(await imageModel(), prompt, refs, aspectRatio);
  } catch (err) {
    // The model may have just been retired: look again once and retry.
    if (/not found|not supported|NOT_FOUND|404/i.test(String(err))) return makeImage(await imageModel(true), prompt, refs, aspectRatio);
    throw err;
  }
}

async function makeImage(model: string, prompt: string, refs: { mimeType: string; data: Buffer }[], aspectRatio: string): Promise<Buffer> {
  const res = await fetch(`${API}/models/${model}:generateContent`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": geminiApiKey() },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            ...refs.map((r) => ({ inline_data: { mime_type: r.mimeType, data: r.data.toString("base64") } })),
            { text: prompt },
          ],
        },
      ],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = (await res.json()) as {
    candidates?: { content?: { parts?: Part[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
    error?: { message?: string };
  };
  if (!res.ok) {
    const msg = data.error?.message ?? String(res.status);
    console.error(`[gemini] ${model}: ${msg}`);
    if (/quota|RESOURCE_EXHAUSTED|limit: 0|billing/i.test(msg)) {
      throw new Error(`Gemini (${model}): image generation needs billing on your Google project (free keys get 0 images). Turn on billing in AI Studio → Plan / Billing. (${msg})`);
    }
    throw new Error(`Gemini (${model}): ${msg}`);
  }
  const part = data.candidates?.[0]?.content?.parts?.find((p) => p.inlineData?.data || p.inline_data?.data);
  const b64 = part?.inlineData?.data ?? part?.inline_data?.data;
  if (!b64) {
    const why = data.promptFeedback?.blockReason ?? data.candidates?.[0]?.finishReason ?? "no image returned";
    console.error(`[gemini] ${model}: no image (${why})`);
    throw new Error(`Gemini didn't make the image (${why}). Try a different prompt.`);
  }
  logAiCall("gemini_image", {
    model,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    costUsd: GEMINI_IMAGE.usdPerImage,
  });
  return sharp(Buffer.from(b64, "base64")).jpeg({ quality: 90 }).toBuffer();
}
