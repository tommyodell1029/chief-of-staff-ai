// Jarvis's brain. Runs one turn of conversation through the Anthropic API and streams events back.
import Anthropic from "@anthropic-ai/sdk";
import { MODELS, type ModelChoice } from "@/config/models";
import { addMemory, recallMemories } from "@/lib/memory";
import { addTodo, listTodos } from "@/lib/todos";
import { resolveModel, runCompat, usingCompat, type CompatMessage } from "@/lib/llm/compat";
import { logAiCall, spendToday } from "@/lib/spend";
import { systemPrompt, turnNote } from "./prompt";
import { chooseModel } from "./router";
import { jarvisTools, type ToolEvent } from "./tools";

export type JarvisEvent =
  | { type: "model"; model: string; reason: string }
  | { type: "text"; delta: string }
  | ToolEvent
  | { type: "done"; text: string; costUsd: number }
  | { type: "error"; message: string };

export interface TurnInput {
  message: string;
  mode: "voice" | "text";
  history: { role: "user" | "assistant"; content: string }[];
  conversationId: number;
  signal?: AbortSignal;
  purpose?: string; // label for the cost log, e.g. "jarvis_chat" or "briefing_lunch"
  model?: ModelChoice; // skip the router and use this model (scheduled briefings)
  image?: { mediaType: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string }; // a photo from the camera
}

function pickModel(input: TurnInput) {
  if (input.model) return { ...input.model, reason: "scheduled" };
  // Photos: Sonnet sees images well and answers fast; medium effort for a careful look.
  if (input.image) return { ...MODELS.fastVoice, effort: "medium" as const, reason: "photo" };
  return chooseModel(input.message, input.mode);
}

let client: Anthropic | null = null;
const anthropic = () => (client ??= new Anthropic()); // reads ANTHROPIC_API_KEY

// Past turns as proper alternating messages. Stored history never changes, so it stays prompt-cached.
function buildMessages(input: TurnInput): Anthropic.Beta.BetaMessageParam[] {
  const msgs: Anthropic.Beta.BetaMessageParam[] = [];
  for (const m of input.history.slice(-30)) {
    const last = msgs[msgs.length - 1];
    if (last?.role === m.role) last.content = `${last.content}\n\n${m.content}`;
    else msgs.push({ role: m.role, content: m.content });
  }
  if (msgs[0]?.role === "assistant") msgs.shift(); // must start with Tommy
  let text = `${turnNote(input.mode)}\n\n${input.message}`;
  // An unanswered message from Tommy (e.g. after an error) is folded into this one so turns alternate.
  if (msgs[msgs.length - 1]?.role === "user") text = `${msgs.pop()!.content}\n\n${text}`;
  msgs.push({
    role: "user",
    content: input.image
      ? [
          { type: "image", source: { type: "base64", media_type: input.image.mediaType, data: input.image.data } },
          { type: "text", text: `(Tommy sent this photo from his camera.)\n${text}` },
        ]
      : text,
  });
  return msgs;
}

export async function* runJarvisTurn(input: TurnInput): AsyncGenerator<JarvisEvent> {
  if (process.env.JARVIS_FAKE_BRAIN === "1") {
    yield* fakeTurn(input);
    return;
  }
  if (usingCompat()) {
    yield* compatTurn(input);
    return;
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    yield { type: "error", message: "ANTHROPIC_API_KEY is missing. Add it to your settings and restart Jarvis." };
    return;
  }

  const choice = pickModel(input);
  yield { type: "model", model: choice.id, reason: choice.reason };

  // Tool handlers push events here; we drain the queue between stream events.
  const pending: JarvisEvent[] = [];
  const runner = anthropic().beta.messages.toolRunner(
    {
      model: choice.id,
      max_tokens: 16000,
      output_config: { effort: choice.effort },
      system: systemPrompt(),
      messages: buildMessages(input),
      tools: jarvisTools((e) => pending.push(e)),
      cache_control: { type: "ephemeral" },
      // If a safety filter declines, Anthropic retries on its recommended fallback model.
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thread: false,
      max_iterations: 6,
      stream: true,
    },
    { signal: input.signal },
  );

  let text = "";
  let cost = 0;
  // Web search answers arrive as several text blocks (one per citation), which run on as one paragraph.
  // A paragraph break is only added when text resumes after a tool call.
  let afterTool = false;
  try {
    for await (const turn of runner) {
      afterTool = !!text;
      for await (const ev of turn) {
        while (pending.length) yield pending.shift()!;
        if (ev.type === "content_block_start") {
          if (ev.content_block.type === "text") {
            if (afterTool && text && !text.endsWith("\n")) {
              text += "\n\n";
              yield { type: "text", delta: "\n\n" };
            }
            afterTool = false;
          } else if (ev.content_block.type === "server_tool_use" || ev.content_block.type === "tool_use") {
            afterTool = true;
            if (ev.content_block.type === "server_tool_use" && ev.content_block.name === "web_search") {
              yield { type: "tool", name: "web_search", detail: "searching the web" };
            }
            if (ev.content_block.type === "server_tool_use" && ev.content_block.name === "web_fetch") {
              yield { type: "tool", name: "web_fetch", detail: "reading a page" };
            }
          }
        } else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") {
          text += ev.delta.text;
          yield { type: "text", delta: ev.delta.text };
        }
      }
      const msg = await turn.finalMessage();
      const u = msg.usage;
      cost += logAiCall(
        input.purpose ?? "jarvis_chat",
        {
          model: choice.id,
          inputTokens: u.input_tokens,
          outputTokens: u.output_tokens,
          cacheReadTokens: u.cache_read_input_tokens ?? 0,
          cacheWriteTokens: u.cache_creation_input_tokens ?? 0,
          webSearches: u.server_tool_use?.web_search_requests ?? 0,
        },
        input.conversationId,
      );
      while (pending.length) yield pending.shift()!;

      if (msg.stop_reason === "refusal") {
        yield { type: "error", message: text || "I'm afraid I can't help with that one, sir." };
        return;
      }
      if (msg.stop_reason === "max_tokens" && msg.content.some((b) => b.type === "tool_use")) {
        yield { type: "error", message: "I ran out of room mid-thought, sir. Try asking that more narrowly." };
        return;
      }
      const spend = spendToday();
      if (spend.overCap || spend.overMonthCap) {
        yield { type: "error", message: "That hit the spending cap, sir, so I've stopped." };
        return;
      }
    }
  } catch (err) {
    if (input.signal?.aborted) return;
    console.error("[jarvis] turn failed:", err);
    let message = err instanceof Error ? err.message : String(err);
    if (err instanceof Anthropic.AuthenticationError) message = "my Anthropic API key was rejected. Check ANTHROPIC_API_KEY.";
    else if (err instanceof Anthropic.RateLimitError) message = "Anthropic says we're sending too much right now. Try again in a minute.";
    else if (err instanceof Anthropic.APIConnectionError) message = "I can't reach Anthropic's servers right now.";
    yield { type: "error", message: `I couldn't reach my brain: ${message}` };
    return;
  }
  yield { type: "done", text: text.trim(), costUsd: cost };
}

// A turn on OpenRouter or a local Ollama model (AI_PROVIDER). Same tools (except Claude's hosted web search and page
// reading), same memory and history; the answer arrives in one piece rather than word by word.
async function* compatTurn(input: TurnInput): AsyncGenerator<JarvisEvent> {
  const choice = pickModel(input);
  let model: string;
  try {
    model = resolveModel(choice);
  } catch (err) {
    yield { type: "error", message: err instanceof Error ? err.message : String(err) };
    return;
  }
  yield { type: "model", model, reason: choice.reason };
  const pending: JarvisEvent[] = [];
  const history: CompatMessage[] = [];
  for (const m of input.history.slice(-30)) history.push({ role: m.role, content: m.content });
  const text = `${turnNote(input.mode)}\n\n${input.message}`;
  const user: CompatMessage = input.image
    ? { role: "user", content: [{ type: "image_url", image_url: { url: `data:${input.image.mediaType};base64,${input.image.data}` } }, { type: "text", text: `(Tommy sent this photo from his camera.)\n${text}` }] }
    : { role: "user", content: text };
  const system = systemPrompt()
    .map((b) => (typeof b === "string" ? b : (b as { text?: string }).text ?? ""))
    .join("\n\n");
  try {
    const r = await runCompat({
      model,
      messages: [{ role: "system", content: system }, ...history, user],
      tools: jarvisTools((e) => pending.push(e)),
      maxIterations: 6,
      signal: input.signal,
      onCall: (u) => logAiCall(input.purpose ?? "jarvis_chat", { model, inputTokens: u.inputTokens, outputTokens: u.outputTokens, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: u.costUsd }, input.conversationId),
    });
    while (pending.length) yield pending.shift()!;
    if (r.text) yield { type: "text", delta: r.text };
    yield { type: "done", text: r.text, costUsd: r.costUsd };
  } catch (err) {
    if (input.signal?.aborted) return;
    while (pending.length) yield pending.shift()!;
    yield { type: "error", message: `I couldn't reach my brain: ${err instanceof Error ? err.message : String(err)}` };
  }
}

// Offline stand-in for testing the screen without spending money (JARVIS_FAKE_BRAIN=1).
async function* fakeTurn(input: TurnInput): AsyncGenerator<JarvisEvent> {
  const choice = pickModel(input);
  yield { type: "model", model: `${choice.id} (fake)`, reason: choice.reason };
  let reply: string;
  const msg = input.message;
  const rememberMatch = msg.match(/^remember (?:that )?(.+)$/i);
  const todoMatch = msg.match(/^(?:remind me to|add) (.+?)(?: to my (?:list|to-?dos))?[.!]?$/i);
  if (input.image) {
    reply = `Test reply, sir: I received your photo (${Math.round((input.image.data.length * 3) / 4 / 1024)} KB). My real brain would describe it.`;
  } else if (/diagnostic|systems check/i.test(msg)) {
    yield { type: "tool", name: "diagnostics", detail: "all systems" };
    const { runDiagnostics, diagnosticsSummary } = await import("@/lib/diagnostics");
    await new Promise((r) => setTimeout(r, 1500));
    reply = `Test diagnostics, sir. ${diagnosticsSummary(await runDiagnostics(true))}`;
  } else if (rememberMatch) {
    const fact = `Tommy says: ${rememberMatch[1].replace(/[.!]$/, "")}.`;
    const m = addMemory(fact, "general", "conversation");
    yield { type: "tool", name: "remember", detail: m.fact };
    reply = `Noted, sir. I've saved that: "${m.fact}"`;
  } else if (todoMatch) {
    const t = addTodo(todoMatch[1]);
    yield { type: "tool", name: "add_todo", detail: t.title };
    reply = `Added to your list, sir: ${t.title}.`;
  } else if (/brief|check-in|review|to-?dos|my list/i.test(msg)) {
    const open = listTodos();
    reply = open.length
      ? `Test briefing, sir. You have ${open.length} open to-do${open.length === 1 ? "" : "s"}: ${open.map((t) => t.title).join("; ")}.`
      : "Test briefing, sir. Your list is clear.";
  } else {
    const found = recallMemories(msg, 3);
    reply = found.length
      ? `From memory, sir: ${found.map((m) => m.fact).join(" ")}`
      : "This is a test reply, sir. My real brain is switched off while JARVIS_FAKE_BRAIN=1.";
  }
  for (const word of reply.split(/(?<= )/)) {
    await new Promise((r) => setTimeout(r, 30));
    yield { type: "text", delta: word };
  }
  yield { type: "done", text: reply, costUsd: 0 };
}
