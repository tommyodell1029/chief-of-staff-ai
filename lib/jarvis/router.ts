// Decides whether a message needs the full brain or the fast model.
// Simple and predictable on purpose: no extra AI call, so it adds zero latency.
import { MODELS, ROUTING, type ModelChoice } from "@/config/models";

export function chooseModel(text: string, mode: "voice" | "text"): ModelChoice & { reason: string } {
  const t = text.toLowerCase();
  if (text.length > ROUTING.longMessageChars) {
    return { ...MODELS.orchestrator, reason: "long message" };
  }
  const word = ROUTING.fullBrainWords.find((w) => new RegExp(`\\b${w}\\b`).test(t));
  if (word) return { ...MODELS.orchestrator, reason: `asked to "${word}"` };
  if (mode === "voice") return { ...MODELS.fastVoice, reason: "quick voice question" };
  if (text.length < ROUTING.shortTextChars) return { ...MODELS.fastVoice, reason: "short question" };
  return { ...MODELS.orchestrator, reason: "default" };
}
