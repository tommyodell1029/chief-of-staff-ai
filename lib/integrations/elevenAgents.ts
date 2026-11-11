// ElevenLabs Agents: the voice that places Jarvis's phone calls, through a Twilio number imported into ElevenLabs.
// Uses the same ELEVENLABS_API_KEY and Jarvis's voice (ELEVENLABS_VOICE_ID). Jarvis creates the calling agent himself
// the first time; Tommy only imports the phone number in ElevenLabs.
import { getSetting, setSetting } from "@/lib/settings";

const API = "https://api.elevenlabs.io/v1/convai";
// Bump when the instructions below change, so the agent is recreated with them.
const AGENT_VERSION = "1";

export const callsConfigured = () => !!process.env.ELEVENLABS_API_KEY;

async function el<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`${API}${path}`, {
    method: init.method ?? "GET",
    headers: { "xi-api-key": process.env.ELEVENLABS_API_KEY!, "Content-Type": "application/json" },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(30_000),
  });
  const data = (await res.json().catch(() => ({}))) as T & { detail?: unknown };
  if (!res.ok) {
    const d = data.detail;
    const msg = typeof d === "string" ? d : d && typeof d === "object" ? JSON.stringify(d).slice(0, 300) : `HTTP ${res.status}`;
    if (res.status === 401 || res.status === 403) {
      throw new Error(`ElevenLabs refused (${msg}). Your ElevenLabs API key needs access to "ElevenAgents" (Agents): edit the key's permissions in ElevenLabs.`);
    }
    throw new Error(`ElevenLabs: ${msg}`);
  }
  return data;
}

const PROMPT = `You are Jarvis, an AI phone assistant making a short call on behalf of {{caller_name}}. You are calling {{business_name}}.

Your goal: {{task}}
Details and limits from {{caller_name}}: {{details}}
Name for any booking: {{caller_name}}. Callback number if they ask: {{callback_number}}.

How to behave:
- You already said you're an AI assistant calling for {{caller_name}}. If anyone asks whether you're a person or a robot, say plainly that you're an AI assistant.
- Be brief, polite and natural. Ask one thing at a time. Let them talk.
- Stay inside the details and limits. If what they offer doesn't fit (time, party size, price), ask for the closest alternative, but don't accept anything outside the limits. Say {{caller_name}} will call back to decide instead.
- Never give card numbers, account numbers or passwords, never agree to pay, pre-pay, place a deposit or sign up for anything. If they require a card or deposit, thank them and say {{caller_name}} will call back to finish it.
- Repeat back what was agreed (day, time, name, party size, any confirmation number) before you hang up.
- If you reach voicemail, an automated menu you can't get past, or a wrong number, end the call politely without leaving a message.
- When the goal is done or can't be done, thank them and end the call.`;

// The calling agent, created once (and again if the instructions above change).
export async function ensureCallAgent(): Promise<string> {
  const saved = getSetting("call_agent_id");
  if (saved && getSetting("call_agent_version") === AGENT_VERSION) return saved;
  const voiceId = process.env.ELEVENLABS_VOICE_ID;
  const body = {
    name: "Jarvis (phone calls)",
    tags: ["jarvis"],
    conversation_config: {
      agent: {
        language: "en",
        first_message: "Hi, this is Jarvis, an AI assistant calling for {{caller_name}}. This call may be transcribed. {{opening}}",
        prompt: { prompt: PROMPT, llm: process.env.CALL_AGENT_LLM || "claude-haiku-5-5", temperature: 0.3 },
      },
      ...(voiceId ? { tts: { voice_id: voiceId, model_id: "eleven_flash_v2_5" } } : {}),
      conversation: { max_duration_seconds: Number(process.env.CALL_MAX_SECONDS || 300) },
    },
    platform_settings: { call_limits: { daily_limit: Number(process.env.CALLS_DAILY_LIMIT || 5) * 2 } },
  };
  const out = await el<{ agent_id: string }>("/agents/create", { method: "POST", body }).catch(async (err) => {
    // Older accounts may not accept every optional setting: try again with just the essentials.
    if (!/ElevenLabs: /.test(String(err))) throw err;
    return el<{ agent_id: string }>("/agents/create", { method: "POST", body: { name: body.name, conversation_config: { agent: body.conversation_config.agent, ...(voiceId ? { tts: { voice_id: voiceId } } : {}) } } });
  });
  setSetting("call_agent_id", out.agent_id);
  setSetting("call_agent_version", AGENT_VERSION);
  return out.agent_id;
}

export interface PhoneNumber {
  phone_number_id: string;
  phone_number: string;
  label: string;
  provider: string;
}

export async function listPhoneNumbers(): Promise<PhoneNumber[]> {
  const n = await el<PhoneNumber[]>("/phone-numbers");
  return Array.isArray(n) ? n : [];
}

export async function callerNumber(): Promise<PhoneNumber> {
  const nums = await listPhoneNumbers();
  const pick = nums.find((n) => n.provider === "twilio") ?? nums[0];
  if (!pick) throw new Error("No phone number in ElevenLabs yet. Import your Twilio number: ElevenLabs → Agents → Phone Numbers → Import number.");
  return pick;
}

export async function startCall(o: { to: string; vars: Record<string, string> }): Promise<string> {
  const [agentId, from] = await Promise.all([ensureCallAgent(), callerNumber()]);
  const r = await el<{ success: boolean; message: string; conversation_id?: string | null }>("/twilio/outbound-call", {
    method: "POST",
    body: {
      agent_id: agentId,
      agent_phone_number_id: from.phone_number_id,
      to_number: o.to,
      conversation_initiation_client_data: { dynamic_variables: o.vars },
      telephony_call_config: { ringing_timeout_secs: 40 },
    },
  });
  if (!r.success || !r.conversation_id) throw new Error(`The call didn't start: ${r.message || "no reason given"}`);
  return r.conversation_id;
}

export interface CallResult {
  status: string; // initiated | in-progress | processing | done | failed
  transcript: { role: "user" | "agent"; message?: string }[];
  summary: string | null;
  durationSecs: number;
  endReason: string;
}

export async function getCall(conversationId: string): Promise<CallResult> {
  const c = await el<{
    status: string;
    transcript?: { role: "user" | "agent"; message?: string }[];
    analysis?: { transcript_summary?: string };
    metadata?: { call_duration_secs?: number; termination_reason?: string };
  }>(`/conversations/${encodeURIComponent(conversationId)}`);
  return {
    status: c.status,
    transcript: c.transcript ?? [],
    summary: c.analysis?.transcript_summary ?? null,
    durationSecs: c.metadata?.call_duration_secs ?? 0,
    endReason: c.metadata?.termination_reason ?? "",
  };
}
