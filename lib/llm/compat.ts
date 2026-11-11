// Choose your model: besides Claude (the default), Jarvis can run on OpenRouter (hundreds of models, one key) or on
// free local models through Ollama. Both speak the OpenAI-style chat API, so one path covers them.
//
//   AI_PROVIDER=anthropic | openrouter | ollama        (default anthropic)
//   OPENROUTER_API_KEY=...                              (openrouter)
//   OLLAMA_URL=http://127.0.0.1:11434                    (ollama; the default)
//   AI_MODEL=...                                        one model for everything, or per role:
//   AI_MODEL_SMART / AI_MODEL_WRITER / AI_MODEL_FAST    (the orchestrator / writers / quick, high-volume work)
//
// Hosted web search and page reading are Claude features; with another provider they're left out, and the model is
// told so. Costs: OpenRouter reports each call's price; local models cost nothing.
import type { ModelChoice } from "@/config/models";

export type Provider = "anthropic" | "openrouter" | "ollama";

export function provider(): Provider {
  const p = (process.env.AI_PROVIDER ?? "").trim().toLowerCase();
  return p === "openrouter" || p === "ollama" ? p : "anthropic";
}

export const usingCompat = () => provider() !== "anthropic";

// The model to use for a role, from the Claude model Jarvis would otherwise pick.
export function resolveModel(choice: Pick<ModelChoice, "id">): string {
  const role = /opus|fable/.test(choice.id) ? "SMART" : /haiku/.test(choice.id) ? "FAST" : "WRITER";
  const m = (process.env[`AI_MODEL_${role}`] || process.env.AI_MODEL || "").trim();
  if (!m) throw new Error(`Set AI_MODEL (or AI_MODEL_${role}) to the ${provider() === "ollama" ? "Ollama" : "OpenRouter"} model to use.`);
  return m;
}

// What's missing for the chosen provider, if anything (for Connections and diagnostics).
export function providerProblem(): string | null {
  const p = provider();
  if (p === "anthropic") return process.env.ANTHROPIC_API_KEY ? null : "no ANTHROPIC_API_KEY";
  if (p === "openrouter" && !process.env.OPENROUTER_API_KEY) return "no OPENROUTER_API_KEY";
  if (!process.env.AI_MODEL && !process.env.AI_MODEL_WRITER) return "no AI_MODEL set";
  return null;
}

export function providerLabel(): string {
  const p = provider();
  if (p === "anthropic") return "Claude (Anthropic)";
  const model = process.env.AI_MODEL_WRITER || process.env.AI_MODEL || "?";
  return `${p === "openrouter" ? "OpenRouter" : "Ollama (local)"}: ${model}`;
}

function endpoint(): { url: string; headers: Record<string, string> } {
  if (provider() === "openrouter") {
    return {
      url: "https://openrouter.ai/api/v1/chat/completions",
      headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY ?? ""}`, "X-Title": "Personal assistant" },
    };
  }
  const base = (process.env.OLLAMA_URL || "http://127.0.0.1:11434").replace(/\/+$/, "");
  return { url: `${base}/v1/chat/completions`, headers: {} };
}

// ---------- Tools ----------

interface Runnable {
  name: string;
  description?: string;
  input_schema: Record<string, unknown>;
  run: (input: unknown) => unknown;
  parse?: (input: unknown) => unknown;
}

const isRunnable = (t: unknown): t is Runnable => !!t && typeof (t as Runnable).run === "function" && !!(t as Runnable).input_schema;

export function splitTools(tools: unknown[]): { runnable: Runnable[]; dropped: string[] } {
  const runnable = tools.filter(isRunnable);
  const dropped = tools.filter((t) => !isRunnable(t)).map((t) => String((t as { name?: string }).name ?? "tool"));
  return { runnable, dropped };
}

export type CompatMessage =
  | { role: "system" | "user" | "assistant"; content: string | { type: string; [k: string]: unknown }[] | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };
interface ToolCall {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
}

// One conversation with tool use, until the model answers without calling a tool (or the step limit).
export async function runCompat(o: {
  model: string;
  messages: CompatMessage[];
  tools?: unknown[];
  maxIterations?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  onCall?: (usage: { inputTokens: number; outputTokens: number; costUsd: number }) => void;
}): Promise<{ text: string; costUsd: number }> {
  const { runnable, dropped } = splitTools(o.tools ?? []);
  const messages = [...o.messages];
  if (dropped.length && messages[0]?.role === "system" && typeof messages[0].content === "string") {
    messages[0] = { ...messages[0], content: `${messages[0].content}\n\n(Not available with this model: ${dropped.join(", ")}. Say so if a task needs them.)` };
  }
  const { url, headers } = endpoint();
  let cost = 0;
  for (let step = 0; step < (o.maxIterations ?? 10); step++) {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify({
        model: o.model,
        messages,
        max_tokens: o.maxTokens ?? 4000,
        ...(runnable.length
          ? { tools: runnable.map((t) => ({ type: "function", function: { name: t.name, description: t.description ?? "", parameters: t.input_schema } })) }
          : {}),
        ...(provider() === "openrouter" ? { usage: { include: true } } : {}),
      }),
      signal: o.signal ?? AbortSignal.timeout(180_000),
    });
    const d = (await res.json().catch(() => ({}))) as {
      choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number; cost?: number };
      error?: { message?: string } | string;
    };
    if (!res.ok || !d.choices?.length) {
      const msg = typeof d.error === "string" ? d.error : (d.error?.message ?? `HTTP ${res.status}`);
      throw new Error(`${provider() === "ollama" ? "Ollama" : "OpenRouter"}: ${msg}`);
    }
    const u = { inputTokens: d.usage?.prompt_tokens ?? 0, outputTokens: d.usage?.completion_tokens ?? 0, costUsd: d.usage?.cost ?? 0 };
    cost += u.costUsd;
    o.onCall?.(u);
    const msg = d.choices[0].message ?? {};
    const calls = msg.tool_calls ?? [];
    if (!calls.length) return { text: (msg.content ?? "").trim(), costUsd: cost };
    messages.push({ role: "assistant", content: msg.content ?? null, tool_calls: calls });
    for (const call of calls) {
      const tool = runnable.find((t) => t.name === call.function.name);
      let out: string;
      try {
        if (!tool) throw new Error(`No tool called ${call.function.name}.`);
        const raw = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const input = tool.parse ? tool.parse(raw) : raw;
        const r = await tool.run(input);
        out = typeof r === "string" ? r : JSON.stringify(r);
      } catch (err) {
        out = `Error: ${err instanceof Error ? err.message : String(err)}`;
      }
      messages.push({ role: "tool", tool_call_id: call.id, content: out.slice(0, 20_000) });
    }
  }
  return { text: "I ran out of steps before finishing, sir.", costUsd: cost };
}
