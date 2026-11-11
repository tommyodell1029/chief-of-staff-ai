// Telegram: talk to Jarvis, get his alerts, and approve things or answer the crew's questions with one tap.
// TELEGRAM_BOT_TOKEN comes from @BotFather (free). Only ONE chat is ever accepted: the one that sends the private
// start code from Connections. Telegram's calls to Jarvis carry a secret header that is checked every time.
import { createHmac, randomInt } from "node:crypto";
import { getSetting, setSetting } from "@/lib/settings";

const token = () => process.env.TELEGRAM_BOT_TOKEN?.trim() ?? "";
export const telegramConfigured = () => !!token();
export const telegramChatId = () => getSetting("tg_chat_id") || "";
export const telegramPaired = () => telegramConfigured() && !!telegramChatId();

export function webhookSecret(): string {
  const key = process.env.SESSION_SECRET || process.env.JARVIS_PASSWORD || "jarvis-local";
  return createHmac("sha256", key).update(`telegram:${token()}`).digest("hex").slice(0, 48);
}

async function tg<T>(method: string, body: Record<string, unknown>): Promise<T> {
  const res = await fetch(`https://api.telegram.org/bot${token()}/${method}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
  const d = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!d.ok) throw new Error(`Telegram: ${d.description ?? res.status}`);
  return d.result as T;
}

type Buttons = { text: string; data: string }[][];

export async function sendTelegram(text: string, buttons?: Buttons, chatId = telegramChatId()): Promise<void> {
  if (!telegramConfigured() || !chatId) return;
  const parts = text.match(/[\s\S]{1,3900}(?:\n|$)|[\s\S]{1,3900}/g) ?? [text];
  for (let i = 0; i < parts.length; i++) {
    await tg("sendMessage", {
      chat_id: chatId,
      text: parts[i],
      disable_web_page_preview: true,
      ...(buttons && i === parts.length - 1 ? { reply_markup: { inline_keyboard: buttons.map((row) => row.map((b) => ({ text: b.text, callback_data: b.data }))) } } : {}),
    });
  }
}

// Connections → Connect Telegram: point the bot at Jarvis and make a one-time start code (good for 15 minutes).
export async function connectTelegram(baseUrl: string): Promise<{ bot: string; link: string; code: string }> {
  if (!telegramConfigured()) throw new Error("Add TELEGRAM_BOT_TOKEN in Render first (see docs/telegram-setup.md).");
  if (!/^https:\/\//.test(baseUrl)) throw new Error("Telegram needs Jarvis's public https address.");
  await tg("setWebhook", { url: `${baseUrl}/api/telegram/webhook`, secret_token: webhookSecret(), allowed_updates: ["message", "callback_query"], drop_pending_updates: true });
  const me = await tg<{ username: string }>("getMe", {});
  const code = String(randomInt(100000, 999999));
  setSetting("tg_pair_code", JSON.stringify({ code, until: Date.now() + 15 * 60_000 }));
  return { bot: me.username, code, link: `https://t.me/${me.username}?start=${code}` };
}

export async function disconnectTelegram() {
  if (telegramConfigured()) await tg("deleteWebhook", {}).catch(() => {});
  setSetting("tg_chat_id", "");
  setSetting("tg_pair_code", "");
}

function pairCodeValid(code: string): boolean {
  try {
    const p = JSON.parse(getSetting("tg_pair_code") || "null") as { code: string; until: number } | null;
    return !!p && p.code === code && Date.now() < p.until;
  } catch {
    return false;
  }
}

// Alerts → Telegram, with buttons for approvals and the crew's questions.
export async function telegramAlert(msg: { title: string; body: string; url?: string; tag?: string }) {
  if (!telegramPaired()) return;
  let buttons: Buttons | undefined;
  const approval = msg.tag?.match(/^approval-(\d+)$/);
  const question = msg.tag?.match(/^question-(\d+)$/);
  if (approval) {
    buttons = [[{ text: "✅ Approve", data: `a:${approval[1]}:y` }, { text: "✖ Deny", data: `a:${approval[1]}:n` }]];
  } else if (question) {
    const { getDb, schema } = await import("@/lib/db");
    const { eq } = await import("drizzle-orm");
    const q = getDb().select().from(schema.questions).where(eq(schema.questions.id, Number(question[1]))).get();
    if (q) buttons = (JSON.parse(q.options) as string[]).map((o, i) => [{ text: o.slice(0, 60), data: `q:${q.id}:${i}` }]);
  }
  await sendTelegram(`${msg.title}\n${msg.body}`, buttons);
}

interface Update {
  message?: { chat: { id: number }; text?: string; voice?: unknown; photo?: unknown };
  callback_query?: { id: string; data?: string; message?: { chat: { id: number }; message_id: number } };
}

// Everything Telegram sends us. Only the paired chat gets anywhere.
export async function handleTelegramUpdate(u: Update) {
  const paired = telegramChatId();
  if (u.message) {
    const chat = String(u.message.chat.id);
    const text = u.message.text?.trim() ?? "";
    const start = text.match(/^\/start\s+(\d{6})$/);
    if (start) {
      if (pairCodeValid(start[1])) {
        setSetting("tg_chat_id", chat);
        setSetting("tg_pair_code", "");
        await sendTelegram("Connected, sir. Talk to me here any time; alerts, approvals and the crew's questions will come here too.", undefined, chat);
      } else {
        await sendTelegram("That code isn't valid any more. Make a new one in Jarvis → Connections → Telegram.", undefined, chat);
      }
      return;
    }
    if (chat !== paired) return; // a stranger: ignore
    if (!text) {
      await sendTelegram("I can only read text here for now, sir.");
      return;
    }
    await chatTurn(text);
    return;
  }
  const cb = u.callback_query;
  if (cb?.data && cb.message && String(cb.message.chat.id) === paired) {
    let reply = "";
    const a = cb.data.match(/^a:(\d+):(y|n)$/);
    const q = cb.data.match(/^q:(\d+):(\d+)$/);
    if (a) {
      const { decideApproval } = await import("@/lib/crews/crews");
      const r = await decideApproval(Number(a[1]), a[2] === "y");
      reply = !r ? "That one was already decided." : a[2] === "y" ? `Approved.${r.actionResult ? ` ${r.actionResult}` : ""}` : "Denied.";
    } else if (q) {
      const { getDb, schema } = await import("@/lib/db");
      const { eq } = await import("drizzle-orm");
      const { answerQuestion } = await import("@/lib/crews/deck");
      const row = getDb().select().from(schema.questions).where(eq(schema.questions.id, Number(q[1]))).get();
      const opt = row ? (JSON.parse(row.options) as string[])[Number(q[2])] : undefined;
      reply = opt && answerQuestion(Number(q[1]), opt) ? `Told them: "${opt}".` : "That question was already answered.";
    }
    await tg("answerCallbackQuery", { callback_query_id: cb.id, text: reply.slice(0, 190) }).catch(() => {});
    await tg("editMessageReplyMarkup", { chat_id: cb.message.chat.id, message_id: cb.message.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
    if (reply) await sendTelegram(reply);
  }
}

// A message from Tommy: one Jarvis turn in the Telegram conversation, answered in the chat.
async function chatTurn(text: string) {
  const { checkRateLimit, spendToday } = await import("@/lib/spend");
  const { addMessage, conversationExists, getMessages, newConversation } = await import("@/lib/conversations");
  const { runJarvisTurn } = await import("@/lib/jarvis/orchestrator");
  if (!checkRateLimit()) return sendTelegram("Easy, sir: too many messages this minute.");
  const s = spendToday();
  if (s.overCap || s.overMonthCap) return sendTelegram("The AI spending cap has been reached, sir, so I can't answer until it resets.");
  let conv = Number(getSetting("tg_conversation") || 0);
  if (!conv || !conversationExists(conv)) {
    conv = newConversation();
    setSetting("tg_conversation", String(conv));
  }
  const history = getMessages(conv).map((m) => ({ role: m.role, content: m.content }));
  addMessage(conv, "user", text, "text");
  await tg("sendChatAction", { chat_id: telegramChatId(), action: "typing" }).catch(() => {});
  let answer = "";
  let model: string | undefined;
  for await (const e of runJarvisTurn({ message: text, mode: "text", history, conversationId: conv, purpose: "jarvis_telegram" })) {
    if (e.type === "model") model = e.model;
    if (e.type === "done") answer = e.text;
    if (e.type === "error") answer = e.message;
  }
  if (answer) addMessage(conv, "assistant", answer, "text", model);
  await sendTelegram(answer || "I didn't get an answer together, sir. Try again?");
}
