"use client";
// Sends one message to Jarvis and streams the reply (the same /api/chat the Command Center uses).

export interface ChatHandlers {
  onText?: (delta: string) => void;
  onTool?: (name: string, detail: string) => void;
  onConversation?: (id: number) => void;
}

export async function streamChat(
  body: { message: string; mode: "voice" | "text"; conversationId: number | null; image?: string },
  h: ChatHandlers,
  signal?: AbortSignal,
): Promise<string> {
  const res = await fetch("/api/chat", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal });
  if (res.status === 401) throw new Error("signed_out");
  if (!res.ok || !res.body) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line.trim()) continue;
      const e = JSON.parse(line) as { type: string; delta?: string; name?: string; detail?: string; id?: number; message?: string };
      if (e.type === "text" && e.delta) {
        text += e.delta;
        h.onText?.(e.delta);
      } else if (e.type === "tool") h.onTool?.(e.name ?? "", e.detail ?? "");
      else if (e.type === "conversation" && e.id) h.onConversation?.(e.id);
      else if (e.type === "error") throw new Error(e.message || "Something went wrong.");
    }
  }
  return text;
}
