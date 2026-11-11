// Runs a background AI job (research, ranking, crew tasks, reviews) with tools, cost logging and the spending caps.
import Anthropic from "@anthropic-ai/sdk";
import type { BetaRunnableTool } from "@anthropic-ai/sdk/lib/tools/BetaRunnableTool";
import type { ModelChoice } from "@/config/models";
import { resolveModel, runCompat, usingCompat } from "@/lib/llm/compat";
import { personalize } from "@/lib/kit/kit";
import { logAiCall, spendToday } from "@/lib/spend";

let client: Anthropic | null = null;
export const anthropic = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY

type ServerTool = Anthropic.Beta.BetaWebSearchTool20260209 | Anthropic.Beta.BetaWebSearchTool20250305;
export type AnyTool = BetaRunnableTool | ServerTool;

// Web search for any model: Haiku uses the basic version, Sonnet/Opus the newer one with built-in filtering.
export function webSearch(model: string, maxUses: number): ServerTool {
  return model.includes("haiku")
    ? { type: "web_search_20250305", name: "web_search", max_uses: maxUses }
    : { type: "web_search_20260209", name: "web_search", max_uses: maxUses };
}

export class SpendCapError extends Error {}

export interface JobResult {
  text: string;
  costUsd: number;
  stopReason: string | null;
}

export async function runJob(opts: {
  purpose: string;
  model: ModelChoice;
  system: string;
  prompt: string;
  tools?: AnyTool[];
  maxIterations?: number;
  maxTokens?: number;
}): Promise<JobResult> {
  // Client assistants (kit mode): the client's names and businesses instead of Tommy's.
  opts = { ...opts, system: personalize(opts.system), prompt: personalize(opts.prompt) };
  if (process.env.JARVIS_FAKE_BRAIN === "1") {
    // Tests can script a job's answer: globalThis.__fakeJobs[purpose] returns the input for the job's first tool,
    // or a string to return as the job's text.
    const script = (globalThis as { __fakeJobs?: Record<string, (prompt: string) => unknown> }).__fakeJobs?.[opts.purpose];
    if (script) {
      const answer = script(opts.prompt);
      if (typeof answer === "string") return { text: answer, costUsd: 0, stopReason: "end_turn" };
      // {__calls: [{tool, input}]} calls several tools by name; any other object goes to the first tool.
      const calls = (answer as { __calls?: { tool: string; input: unknown }[] }).__calls;
      const runnable = (opts.tools ?? []).filter((t) => "run" in t) as unknown as { name: string; run: (input: unknown) => unknown }[];
      if (calls) for (const c of calls) await runnable.find((t) => t.name === c.tool)?.run(c.input);
      else await runnable[0]?.run(answer);
      return { text: "", costUsd: 0, stopReason: "end_turn" };
    }
    return { text: `(test brain) ${opts.purpose} skipped: no AI call made.`, costUsd: 0, stopReason: "end_turn" };
  }
  const capCheck = () => {
    const s = spendToday();
    if (s.overCap || s.overMonthCap) throw new SpendCapError("Spending cap reached");
  };
  // Another provider (OpenRouter or local Ollama) instead of Claude.
  if (usingCompat()) {
    capCheck();
    const model = resolveModel(opts.model);
    const r = await runCompat({
      model,
      messages: [
        { role: "system", content: opts.system },
        { role: "user", content: opts.prompt },
      ],
      tools: opts.tools,
      maxIterations: opts.maxIterations,
      maxTokens: Math.min(opts.maxTokens ?? 8000, 8000),
      onCall: (u) => {
        logAiCall(opts.purpose, { model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: u.costUsd });
        capCheck();
      },
    });
    return { text: r.text, costUsd: r.costUsd, stopReason: "end_turn" };
  }
  if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is missing");
  capCheck();

  const haiku = opts.model.id.includes("haiku");
  const runner = anthropic().beta.messages.toolRunner({
    model: opts.model.id,
    max_tokens: opts.maxTokens ?? 16000,
    output_config: { effort: opts.model.effort },
    system: [{ type: "text", text: opts.system }],
    messages: [{ role: "user", content: opts.prompt }],
    tools: opts.tools ?? [],
    cache_control: { type: "ephemeral" },
    // Server-side refusal fallback isn't available for Haiku.
    ...(haiku ? {} : { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" as const }),
    thread: false,
    max_iterations: opts.maxIterations ?? 10,
  });

  let cost = 0;
  let last: Anthropic.Beta.BetaMessage | null = null;
  for await (const msg of runner) {
    last = msg;
    const u = msg.usage;
    cost += logAiCall(opts.purpose, {
      model: opts.model.id,
      inputTokens: u.input_tokens,
      outputTokens: u.output_tokens,
      cacheReadTokens: u.cache_read_input_tokens ?? 0,
      cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
      webSearches: u.server_tool_use?.web_search_requests ?? 0,
    });
    if (msg.stop_reason === "refusal") break;
    capCheck();
  }
  const text =
    last?.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
      .map((b) => b.text)
      .join("")
      .trim() ?? "";
  return { text, costUsd: cost, stopReason: last?.stop_reason ?? null };
}
