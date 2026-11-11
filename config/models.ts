// Every model Jarvis uses lives here. Change a model ID in one place and the whole app follows.

export type EffortLevel = "low" | "medium" | "high" | "xhigh" | "max";

export interface ModelChoice {
  id: string;
  effort: EffortLevel;
  why: string;
}

export const MODELS = {
  // The full brain: plans, delegates, checks work, handles anything non-trivial.
  // Swap to "claude-fable-5-1" if you want the most capable (and priciest) model.
  orchestrator: {
    id: "claude-opus-5-5",
    effort: "medium",
    why: "Smartest everyday model. Plans, delegates, checks work.",
  },
  // Quick back-and-forth for simple questions so voice stays snappy.
  fastVoice: {
    id: "claude-sonnet-5-5",
    effort: "low",
    why: "Fast replies for simple questions.",
  },
  // Phase 3+: research, strategy and writing sub-agents.
  writer: {
    id: "claude-sonnet-5-5",
    effort: "medium",
    why: "Strong writing at lower cost.",
  },
  // Phase 4+: repetitive, high-volume sub-agents (tracking, sorting, posting).
  worker: {
    id: "claude-haiku-5-5",
    effort: "low",
    why: "Cheap and fast for repetitive work.",
  },
} satisfies Record<string, ModelChoice>;

// List prices in US dollars per 1 million tokens. Used to estimate the cost of every call. Check https://claude.com/pricing if these drift.
export const PRICING: Record<string, { input: number; output: number; cacheRead: number }> = {
  "claude-fable-5-1": { input: 10, output: 50, cacheRead: 0.25 },
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.2 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01 },
};

// Anthropic's web search tool: $10 per 1,000 searches, on top of tokens.
export const WEB_SEARCH_USD_PER_SEARCH = 0.01;
// Most searches Jarvis may run while answering one message.
export const WEB_SEARCHES_PER_MESSAGE = 3;

// Nina Studio images: Gemini API (pay-per-use, no subscription). Change the model in settings if Google renames it.
// Gemini image models, best first. Google retires these often, so Jarvis asks Google which ones the key can use
// and takes the first available (GEMINI_IMAGE_MODEL, if set and still available, wins). See lib/integrations/gemini.ts.
export const GEMINI_IMAGE = {
  preferred: ["gemini-3.1-flash-image", "gemini-nano-banana-2.1", "gemini-3.1-flash-image-preview", "gemini-3.1-flash-lite-image", "gemini-2.5-flash-image"],
  usdPerImage: Number(process.env.GEMINI_IMAGE_USD || 0.07), // an estimate for spend tracking; Google's price varies by model
};

// How Jarvis picks between the full brain and the fast model. See lib/jarvis/router.ts.
export const ROUTING = {
  // Messages longer than this always get the full brain.
  longMessageChars: 220,
  // In text mode, messages shorter than this (with no "thinking" words) use the fast model.
  shortTextChars: 60,
  // Words that signal a question deserves real thought.
  fullBrainWords: [
    "plan", "strategy", "strategize", "analyze", "analyse", "compare", "decide", "decision",
    "should i", "pros and cons", "business", "research", "write", "draft", "explain",
    "idea", "ideas", "think hard", "think it through", "review", "budget", "price", "pricing",
    "money", "invest", "why", "evening review",
  ],
};

// ElevenLabs voice settings.
export const VOICE = {
  sttModel: "scribe_v2",
  // Flash is ElevenLabs' low-latency model. Use "eleven_multilingual_v2" for richer, slower audio.
  ttsModel: "eleven_flash_v2_5",
  ttsOutputFormat: "mp3_44100_128",
};
