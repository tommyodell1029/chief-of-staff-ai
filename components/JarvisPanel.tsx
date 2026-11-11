"use client";
import { useIdentity } from "@/lib/client/identity";
// The Jarvis panel: conversation, push-to-talk mic, and text box.
import { useCallback, useEffect, useRef, useState } from "react";
import { photoToDataUrl } from "@/lib/client/image";
import { Recorder, Speaker, extensionFor, micSupported } from "@/lib/client/voice";
import type { BriefingInfo } from "./TodayBar";

interface UiMessage {
  key: string;
  role: "user" | "assistant";
  content: string;
  mode: "voice" | "text";
  model?: string | null;
  notes?: string[];
  links?: { label: string; url: string }[];
  image?: string; // photo preview (this session only)
  error?: boolean;
  pending?: boolean;
}

type RecState = "idle" | "starting" | "recording" | "transcribing";

const SUGGESTIONS = ["Brief me", "Remind me to call the bank tomorrow at 5", "What's the weather this weekend?"];

// How each tool call shows up under Jarvis's reply.
const TOOL_NOTES: Record<string, (detail: string) => string> = {
  remember: (d) => `Saved to memory: ${d}`,
  add_todo: (d) => `Added to-do: ${d}`,
  complete_todo: (d) => `Done: ${d}`,
  list_todos: () => "Checked your to-dos",
  web_search: () => "Searched the web",
  web_fetch: () => "Read a source",
  calendar_events: () => "Checked your calendar",
  delegate_to_crew: (d) => `Handed to ${d}`,
  crew_status: () => "Checked on the crews",
  ask_approval: () => "Added to Waiting on you",
  stripe_summary: () => "Checked Stripe",
  etsy_summary: () => "Checked Etsy",
  save_to_drive: (d) => `Saved to Drive: ${d}`,
  create_campaign: (d) => `Campaign drafted: ${d}`,
  outreach_status: () => "Checked outreach",
  gmail_search: () => "Checked Gmail",
  email_draft: (d) => `Draft saved in Gmail: ${d}`,
  phone_call: (d) => `Call to ${d} waiting for your OK`,
  scorecard: () => "Checked the scorecard",
  protocol: (d) => `Protocol: ${d}`,
  set_goal: (d) => `Goal: ${d}`,
  record_number: (d) => `Recorded ${d}`,
  run_review: () => "Ran the business review",
  weather: (d) => `Checked the weather: ${d}`,
};
const HOLD_MS = 350; // hold longer than this = push-to-talk; a quick tap = tap to start, tap to stop

let keySeq = 0;
const newKey = () => `m${Date.now()}-${keySeq++}`;

export default function JarvisPanel({
  voiceReady,
  briefing,
  onChanged,
}: {
  voiceReady: boolean;
  briefing: BriefingInfo | null;
  onChanged: () => void; // something changed (spend, to-dos, briefings): refresh the dashboard
}) {
  const idn = useIdentity();
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [conversationId, setConversationId] = useState<number | null>(null);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [recState, setRecState] = useState<RecState>("idle");
  const [speakReplies, setSpeakReplies] = useState(true);
  const [speaking, setSpeaking] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [tapMode, setTapMode] = useState(false); // true after a quick tap: keep listening until the next tap

  const speaker = useRef<Speaker | null>(null);
  const recorder = useRef(new Recorder());
  const pressStart = useRef(0);
  const abortRef = useRef<AbortController | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    speaker.current = new Speaker();
    speaker.current.onStateChange = setSpeaking;
    try {
      if (localStorage.getItem("jarvis.speak") === "0") setSpeakReplies(false);
    } catch {}
    loadConversation();
    return () => speaker.current?.stop();
  }, []);

  function loadConversation() {
    fetch("/api/conversation")
      .then((r) => r.json())
      .then((d: { id: number; messages: { id: number; role: "user" | "assistant"; content: string; mode: "voice" | "text"; model: string | null }[] }) => {
        setConversationId(d.id);
        setMessages(d.messages.map((m) => ({ key: `db${m.id}`, role: m.role, content: m.content, mode: m.mode, model: m.model })));
      })
      .catch(() => setNotice("Couldn't load the conversation. Is the server running?"));
  }

  // A scheduled briefing was added to the conversation on the server: show it.
  const briefingId = briefing?.id;
  useEffect(() => {
    if (briefingId && !busy) loadConversation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [briefingId]);

  const handleBriefing = async (play: boolean) => {
    if (!briefing) return;
    if (play && voiceReady) {
      speaker.current?.stop();
      speaker.current?.unlock();
      speaker.current?.push(briefing.content);
      speaker.current?.flush();
    }
    await fetch(`/api/briefings/${briefing.id}`, { method: "POST" }).catch(() => {});
    onChanged();
  };

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  const patchLast = (fn: (m: UiMessage) => UiMessage) =>
    setMessages((ms) => (ms.length ? [...ms.slice(0, -1), fn(ms[ms.length - 1])] : ms));

  const send = useCallback(
    async (text: string, mode: "voice" | "text", image?: string) => {
      const message = text.trim() || (image ? "What's this?" : "");
      if (!message || busy) return;
      setNotice(null);
      setBusy(true);
      const speak = voiceReady && speakReplies;
      speaker.current?.stop();
      setMessages((ms) => [
        ...ms,
        { key: newKey(), role: "user", content: message, mode, image },
        { key: newKey(), role: "assistant", content: "", mode, pending: true, notes: [] },
      ]);

      const abort = new AbortController();
      abortRef.current = abort;
      try {
        const res = await fetch("/api/chat", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message, mode, conversationId, image }),
          signal: abort.signal,
        });
        if (!res.ok || !res.body) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || `Request failed (${res.status})`);
        }
        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split("\n");
          buf = lines.pop() ?? "";
          for (const line of lines) {
            if (!line.trim()) continue;
            const e = JSON.parse(line);
            switch (e.type) {
              case "conversation":
                setConversationId(e.id);
                break;
              case "model":
                patchLast((m) => ({ ...m, model: e.model }));
                break;
              case "text":
                if (speak) speaker.current?.push(e.delta);
                patchLast((m) => ({ ...m, content: m.content + e.delta }));
                break;
              case "tool": {
                if (e.name === "uber_link") {
                  try {
                    const link = JSON.parse(e.detail) as { label: string; url: string };
                    patchLast((m) => ({ ...m, links: [...(m.links ?? []), link] }));
                  } catch {}
                  break;
                }
                const note = TOOL_NOTES[e.name]?.(e.detail);
                if (note) patchLast((m) => (m.notes?.includes(note) ? m : { ...m, notes: [...(m.notes ?? []), note] }));
                break;
              }
              case "done":
                if (speak) speaker.current?.flush();
                patchLast((m) => ({ ...m, pending: false }));
                break;
              case "error":
                patchLast((m) => ({ ...m, pending: false, error: true, content: m.content || e.message }));
                break;
              case "spend":
                onChanged();
                break;
            }
          }
        }
        patchLast((m) => ({ ...m, pending: false }));
      } catch (err) {
        if (abort.signal.aborted) {
          patchLast((m) => ({ ...m, pending: false, content: m.content || "(stopped)" }));
        } else {
          patchLast((m) => ({
            ...m,
            pending: false,
            error: true,
            content: err instanceof Error ? err.message : "Something went wrong.",
          }));
        }
      } finally {
        abortRef.current = null;
        setBusy(false);
      }
    },
    [busy, conversationId, onChanged, speakReplies, voiceReady],
  );

  // ---------- Camera ("what's this?") ----------

  const onPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const dataUrl = await photoToDataUrl(file);
      const question = input.trim();
      setInput("");
      send(question || "What's this?", "text", dataUrl);
    } catch {
      setNotice("Couldn't read that photo. Try again.");
    }
  };

  // ---------- Mic ----------

  const finishRecording = useCallback(async () => {
    setRecState("transcribing");
    const blob = await recorder.current.stop();
    if (!blob || blob.size < 1500) {
      setRecState("idle");
      setNotice("I didn't catch that, sir. Hold the mic while you talk, or tap once to start and again to stop.");
      return;
    }
    try {
      const form = new FormData();
      form.append("audio", blob, `speech.${extensionFor(blob.type)}`);
      const res = await fetch("/api/stt", { method: "POST", body: form });
      const data = (await res.json()) as { text?: string; error?: string };
      if (!res.ok) throw new Error(data.error || "Transcription failed");
      setRecState("idle");
      if (!data.text) {
        setNotice("I didn't catch any words, sir.");
        return;
      }
      send(data.text, "voice");
    } catch (err) {
      setRecState("idle");
      setNotice(err instanceof Error ? err.message : "Transcription failed");
    }
  }, [send]);

  const onMicDown = async (e: React.PointerEvent) => {
    e.preventDefault();
    if (busy || recState === "transcribing") return;
    speaker.current?.stop();
    speaker.current?.unlock();
    if (recState === "recording" || recState === "starting") {
      // Second tap in tap-to-talk mode: stop and send.
      setTapMode(false);
      finishRecording();
      return;
    }
    const support = micSupported();
    if (!support.ok) {
      setNotice(support.reason ?? "Mic unavailable.");
      return;
    }
    if (!voiceReady) {
      setNotice("Voice isn't set up yet: add ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID to .env, then restart.");
      return;
    }
    setNotice(null);
    pressStart.current = Date.now();
    setTapMode(false);
    setRecState("starting");
    try {
      await recorder.current.start();
      setRecState((s) => (s === "starting" ? "recording" : s));
    } catch {
      recorder.current.cancel();
      setRecState("idle");
      setNotice("I couldn't open the microphone. Check that this site is allowed to use it.");
    }
  };

  const onMicUp = (e: React.PointerEvent) => {
    e.preventDefault();
    if (recState !== "recording" && recState !== "starting") return;
    if (Date.now() - pressStart.current < HOLD_MS) {
      setTapMode(true);
      return;
    }
    if (!tapMode) finishRecording();
  };

  const toggleSpeak = () => {
    const next = !speakReplies;
    setSpeakReplies(next);
    if (!next) speaker.current?.stop();
    try {
      localStorage.setItem("jarvis.speak", next ? "1" : "0");
    } catch {}
  };

  const newChat = async () => {
    if (busy) return;
    speaker.current?.stop();
    const d = (await fetch("/api/conversation", { method: "POST" }).then((r) => r.json())) as { id: number };
    setConversationId(d.id);
    setMessages([]);
    setNotice(null);
  };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    speaker.current?.unlock();
    const t = input;
    setInput("");
    send(t, "text");
  };

  const recording = recState === "recording" || recState === "starting";
  const micLabel =
    recState === "transcribing" ? "Transcribing…" : recording ? (tapMode ? "Listening — tap to send" : "Listening — release to send") : "Hold to talk";

  return (
    <div className="flex h-full min-h-0 flex-col rounded-2xl border border-line bg-panel">
      <div className="flex items-center gap-3 border-b border-line px-4 py-3">
        <div className={`h-2.5 w-2.5 rounded-full ${busy || speaking ? "bg-accent recording-pulse" : "bg-accent/60"}`} />
        <h1 className="font-semibold tracking-[0.25em]">{idn.assistant.toUpperCase()}</h1>
        <div className="ml-auto flex items-center gap-2">
          {speaking && (
            <button onClick={() => speaker.current?.stop()} className="rounded-lg px-2.5 py-1.5 text-xs text-accent hover:bg-panel-2">
              Stop voice
            </button>
          )}
          <button
            onClick={toggleSpeak}
            disabled={!voiceReady}
            title={voiceReady ? "Speak replies out loud" : "Voice not configured"}
            className={`rounded-lg border px-2.5 py-1.5 text-xs transition disabled:opacity-40 ${
              speakReplies && voiceReady ? "border-accent/50 text-accent" : "border-line text-muted"
            }`}
          >
            {speakReplies && voiceReady ? "Voice on" : "Voice off"}
          </button>
          <button onClick={newChat} className="rounded-lg border border-line px-2.5 py-1.5 text-xs text-muted hover:text-ink">
            New chat
          </button>
        </div>
      </div>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4">
        {messages.length === 0 && (
          <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
            <p className="text-lg text-ink/80">At your service, sir.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  onClick={() => {
                    speaker.current?.unlock();
                    send(s, "text");
                  }}
                  className="rounded-full border border-line px-3 py-1.5 text-sm text-muted hover:border-accent hover:text-ink"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}
        {messages.map((m) => (
          <Bubble key={m.key} m={m} />
        ))}
      </div>

      {briefing && (
        <div className="mx-4 mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent-dim/30 px-3 py-2 text-sm">
          <span className="mr-auto text-accent">{briefing.title} is ready</span>
          <button
            onClick={() => handleBriefing(true)}
            className="rounded-lg bg-accent px-3 py-1.5 text-xs font-semibold text-bg"
          >
            {voiceReady ? "▶ Play" : "Got it"}
          </button>
          {voiceReady && (
            <button onClick={() => handleBriefing(false)} className="rounded-lg px-2 py-1.5 text-xs text-muted hover:text-ink">
              Dismiss
            </button>
          )}
        </div>
      )}

      {notice && <div className="mx-4 mb-2 rounded-lg bg-warn/10 px-3 py-2 text-sm text-warn">{notice}</div>}

      <div className="flex items-end gap-2 border-t border-line p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:gap-3">
        <div className="flex flex-col items-center gap-1">
          <button
            type="button"
            aria-label={micLabel}
            onPointerDown={onMicDown}
            onPointerUp={onMicUp}
            onPointerCancel={onMicUp}
            onContextMenu={(e) => e.preventDefault()}
            disabled={busy || recState === "transcribing"}
            className={`no-touch-callout flex h-16 w-16 items-center justify-center rounded-full border-2 transition disabled:opacity-40 ${
              recording
                ? "recording-pulse border-accent bg-accent text-bg"
                : "border-accent/60 bg-accent-dim/40 text-accent hover:bg-accent-dim/70"
            }`}
          >
            <MicIcon />
          </button>
          <span className="w-16 text-center text-[10px] leading-tight text-muted sm:w-24">{micLabel}</span>
        </div>
        <input ref={cameraRef} type="file" accept="image/*" capture="environment" onChange={onPhoto} className="hidden" />
        <button
          type="button"
          onClick={() => {
            speaker.current?.unlock();
            cameraRef.current?.click();
          }}
          disabled={busy}
          aria-label="Take a photo and ask Jarvis about it"
          title="Take a photo and ask about it (type a question first, or he'll tell you what it is)"
          className="flex h-11 w-11 shrink-0 items-center justify-center self-center rounded-xl border border-line text-muted hover:border-accent hover:text-accent disabled:opacity-40 sm:h-12 sm:w-12"
        >
          <CameraIcon />
        </button>
        <form onSubmit={submit} className="flex min-w-0 flex-1 items-end gap-2 self-center">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                (e.currentTarget.form as HTMLFormElement).requestSubmit();
              }
            }}
            rows={1}
            placeholder="Ask Jarvis…"
            className="max-h-40 min-h-12 w-full min-w-0 flex-1 resize-none rounded-xl border border-line bg-panel-2 px-3 py-3 text-base outline-none placeholder:text-muted focus:border-accent/70"
          />
          {busy ? (
            <button
              type="button"
              onClick={() => abortRef.current?.abort()}
              className="h-12 rounded-xl border border-line px-4 text-sm text-muted hover:text-ink"
            >
              Stop
            </button>
          ) : (
            <button
              type="submit"
              disabled={!input.trim()}
              className="h-12 rounded-xl bg-accent px-4 text-sm font-semibold text-bg transition disabled:opacity-30"
            >
              Send
            </button>
          )}
        </form>
      </div>
    </div>
  );
}

function Bubble({ m }: { m: UiMessage }) {
  if (m.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-md bg-accent-dim/50 px-4 py-2.5 break-words whitespace-pre-wrap">
          {m.image && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={m.image} alt="Your photo" className="mb-2 max-h-48 rounded-lg" />
          )}
          {m.mode === "voice" && <span className="mr-1.5 text-xs text-accent" title="Spoken">🎙</span>}
          {m.content}
        </div>
      </div>
    );
  }
  return (
    <div className="max-w-[92%]">
      <div
        className={`rounded-2xl rounded-bl-md border px-4 py-2.5 break-words whitespace-pre-wrap ${
          m.error ? "border-danger/40 text-danger" : "border-line bg-panel-2"
        }`}
      >
        {m.content ? <Rich text={m.content} /> : m.pending ? <Thinking /> : null}
      </div>
      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 px-1 text-[11px] text-muted">
        {m.links?.map((l) => (
          <a key={l.url} href={l.url} className="rounded-md bg-accent px-2 py-0.5 font-semibold text-bg">
            {l.label} →
          </a>
        ))}
        {m.notes?.map((n) => (
          <span key={n} className="text-accent">✓ {n}</span>
        ))}
        {m.model && <span>{m.model}</span>}
      </div>
    </div>
  );
}

// Minimal formatting: **bold** only. Everything else shows as plain text.
// Bold text, and web addresses as tappable links (sources, Uber links).
function Rich({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)\]]+)/g).map((part, i) =>
        part.startsWith("**") && part.endsWith("**") ? (
          <strong key={i}>{part.slice(2, -2)}</strong>
        ) : /^https?:\/\//.test(part) ? (
          <a key={i} href={part} target="_blank" rel="noreferrer" className="break-all text-accent underline">
            {part.includes("m.uber.com") ? "Open in Uber" : part.replace(/^https?:\/\/(www\.)?/, "").slice(0, 60)}
          </a>
        ) : (
          part
        ),
      )}
    </>
  );
}

function Thinking() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Thinking">
      {[0, 150, 300].map((d) => (
        <span key={d} className="h-1.5 w-1.5 animate-bounce rounded-full bg-accent" style={{ animationDelay: `${d}ms` }} />
      ))}
    </span>
  );
}

function MicIcon() {
  return (
    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="2" width="6" height="12" rx="3" />
      <path d="M5 10a7 7 0 0 0 14 0M12 17v4M8 21h8" />
    </svg>
  );
}

function CameraIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M4 7h3l2-3h6l2 3h3a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1z" />
      <circle cx="12" cy="13" r="4" />
    </svg>
  );
}
