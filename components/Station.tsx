"use client";
// Hands-free voice for the station screen. The browser listens for "Jarvis" (Edge and Chrome have speech
// recognition built in, so nothing to install). "Jarvis, what's the weather?" is sent right away; "Jarvis" on
// its own waits for your next sentence. While Jarvis talks, listening pauses so he doesn't hear himself, then
// stays open a few seconds for a follow-up without the wake word.
import { useCallback, useEffect, useRef, useState } from "react";
import { streamChat } from "@/lib/client/chat";
import { Speaker } from "@/lib/client/voice";
import { wantsCamera, webcamSnapshot } from "@/lib/client/image";
import { watchMotion, type MotionWatcher } from "@/lib/client/motion";
import { play } from "@/lib/client/sounds";
import Core from "./Core";
import { useIdentity } from "@/lib/client/identity";

type Phase = "starting" | "idle" | "listening" | "looking" | "thinking" | "speaking" | "muted" | "unsupported" | "blocked";

interface SR {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
}

// The wake word is the assistant's name ("Jarvis" plus a few common mishearings on Tommy's; set from the profile on
// client assistants).
let WAKE = /\b(jarvis|jarvas|jervis|travis)\b/i;
const FOLLOW_UP_MS = 7000; // after he answers, listen this long without needing "Jarvis"
const COMMAND_WAIT_MS = 8000; // after "Jarvis" on its own, wait this long for the question
const RELOAD_EVERY_MS = 6 * 60 * 60_000; // fresh page every 6 hours (only while idle)
// "Jarvis, stop" / "Jarvis, that'll be all" while he's thinking or talking cuts him off.
const STOP_WORDS = "(stop|stop talking|that'?s enough|enough|quiet|be quiet|cancel|never ?mind|that'?ll be all|that will be all|hold on|wait|shush|shut up)";
let STOP = new RegExp(`\\b(jarvis|jarvas|jervis|travis)\\b[\\s,.!]*${STOP_WORDS}\\b`, "i");
function setWakeName(name: string) {
  const n = name.trim().toLowerCase();
  if (!n || n === "jarvis") return;
  const names = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  WAKE = new RegExp(`\\b(${names})\\b`, "i");
  STOP = new RegExp(`\\b(${names})\\b[\\s,.!]*${STOP_WORDS}\\b`, "i");
}
// Said when a request needs a moment (he's using a tool before he has anything to say).
const ACKS = ["Right away, sir.", "One moment, sir.", "On it.", "Give me a second, sir.", "Working on it, sir."];
// What he's doing, shown under the orb while he works.
const DOING: Record<string, string> = {
  web_search: "Searching the web",
  web_fetch: "Reading a page",
  remember: "Saving to memory",
  recall: "Searching memory",
  add_todo: "Adding a to-do",
  list_todos: "Checking your to-dos",
  complete_todo: "Checking off a to-do",
  delegate_to_crew: "Assigning a crew",
  crew_status: "Checking on the crews",
  ask_approval: "Requesting your approval",
  phone_call: "Preparing a call",
  call_results: "Checking call results",
  scorecard: "Pulling the scorecard",
  autopilot: "Checking autopilot",
  set_goal: "Setting a goal",
  record_number: "Logging a number",
  run_review: "Running the weekly review",
  protocol: "Running protocol",
  uber_link: "Plotting a route",
  weather: "Checking the weather",
  create_campaign: "Building a campaign",
  outreach_status: "Checking outreach",
  save_to_drive: "Saving to Drive",
  etsy_summary: "Checking Etsy",
  stripe_summary: "Checking Stripe",
  gmail_search: "Searching your inbox",
  email_draft: "Drafting an email",
  calendar_events: "Checking your calendar",
  diagnostics: "Running diagnostics",
  clients: "Checking clients",
  walkin_audit: "Auditing on Google Maps",
  holiday_listings: "Updating Etsy listings",
  boost_picks: "Ranking posts to boost",
  crew_questions: "Checking the crew's questions",
  night_shift: "Setting up the night shift",
};
const ALERTY = /fail|couldn'?t|paused|error|declin|offline|problem/i;

// After "Jarvis": the rest of the sentence, without "hey" or punctuation in front.
function afterWake(text: string): string {
  const i = text.search(WAKE);
  if (i < 0) return "";
  return text
    .slice(i)
    .replace(WAKE, "")
    .replace(/^[\s,.!?:;-]+/, "")
    .trim();
}
const words = (t: string) => t.split(/\s+/).filter(Boolean).length;

const chime = (up = true) => play(up ? "listen" : "done");

export default function Station() {
  const idn = useIdentity();
  useEffect(() => setWakeName(idn.assistant), [idn.assistant]);
  const [phase, setPhase] = useState<Phase>("starting");
  const [heard, setHeard] = useState("");
  const [reply, setReply] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [needsTap, setNeedsTap] = useState(false);
  const [link, setLink] = useState<{ label: string; url: string } | null>(null);
  const [photo, setPhoto] = useState<string | null>(null); // the snapshot sent with the current question
  const pendingPhoto = useRef<string | null>(null); // taken with the camera button, waiting for the question
  const [bulletin, setBulletin] = useState<{ text: string; at: number } | null>(null); // latest announcement on screen
  const [announceOn, setAnnounceOn] = useState(true);
  const announceOnRef = useRef(true);
  const announcing = useRef<{ wasMuted: boolean } | null>(null);
  const queue = useRef<{ id: number; kind?: string; text: string; say: string; quiet: boolean }[]>([]);
  const lastAnnId = useRef<number | null>(null);

  const phaseRef = useRef<Phase>("starting");
  const rec = useRef<SR | null>(null);
  const running = useRef(false); // recognizer currently started
  const wantListening = useRef(true);
  const awaitingCommandUntil = useRef(0); // >0: next sentence is the question (no wake word needed)
  const speaker = useRef<Speaker | null>(null);
  const conversationId = useRef<number | null>(null);
  const abort = useRef<AbortController | null>(null);
  const backoff = useRef(300);
  const lastActive = useRef(Date.now());
  const speakingNow = useRef(false);
  const greetIfAwayRef = useRef<(() => Promise<boolean>) | null>(null);
  const streamDone = useRef(true); // the reply has fully arrived (the speaker can pause between sentences before that)
  const bargeOnly = useRef(false); // listening only for "Jarvis, stop" while he thinks or talks
  const gotText = useRef(false); // the reply has started (vs. only the "one moment" acknowledgment)
  const [activity, setActivity] = useState<string[]>([]); // what he's doing right now
  const [tone, setTone] = useState<"normal" | "alert">("normal");
  const [boot, setBoot] = useState<{ lines: { name: string; status: string }[]; shown: number; done: boolean } | null>(null);
  const [sensing, setSensing] = useState(false);
  const lastArrive = useRef(0);

  const set = (p: Phase) => {
    phaseRef.current = p;
    setPhase(p);
  };

  const startRec = useCallback(() => {
    if (!rec.current || running.current || !wantListening.current) return;
    try {
      rec.current.start();
      running.current = true;
    } catch {
      // Already started; ignore.
    }
  }, []);

  const stopRec = useCallback(() => {
    if (!rec.current || !running.current) return;
    try {
      rec.current.abort();
    } catch {}
    running.current = false;
  }, []);

  const resumeListening = useCallback(
    (followUp: boolean) => {
      if (phaseRef.current === "muted") return;
      awaitingCommandUntil.current = followUp ? Date.now() + FOLLOW_UP_MS : 0;
      set(followUp ? "listening" : "idle");
      wantListening.current = true;
      startRec();
      if (followUp) {
        setTimeout(() => {
          if (phaseRef.current === "listening" && Date.now() >= awaitingCommandUntil.current) {
            awaitingCommandUntil.current = 0;
            set("idle");
          }
        }, FOLLOW_UP_MS + 100);
      }
    },
    [startRec],
  );

  // Tells Jarvis Tommy is here; returns the greeting or "while you were out" catch-up to say first, if any.
  const checkIn = useCallback(async (): Promise<string | null> => {
    try {
      const r = await fetch("/api/presence", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ event: "activity" }) });
      const d = (await r.json()) as { say?: { say: string } | null };
      return d.say?.say ?? null;
    } catch {
      return null;
    }
  }, []);

  const awakeDay = useRef("");
  const markAwake = useCallback(() => {
    const today = new Date().toDateString();
    if (awakeDay.current === today) return;
    awakeDay.current = today;
    fetch("/api/announcements", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ awake: true }) }).catch(() => {
      awakeDay.current = "";
    });
  }, []);

  const ask = useCallback(
    async (question: string) => {
      markAwake();
      lastActive.current = Date.now();
      awaitingCommandUntil.current = 0;
      bargeOnly.current = true; // the mic stays on, but only "Jarvis, stop" counts until he's done
      gotText.current = false;
      setHeard(question);
      setReply("");
      setNote(null);
      setLink(null);
      setActivity([]);
      setTone("normal");
      // A question about something he's showing: take one photo (camera on for a moment, then off).
      let image = pendingPhoto.current ?? undefined;
      pendingPhoto.current = null;
      if (!image && wantsCamera(question)) {
        set("looking");
        try {
          image = await webcamSnapshot();
          play("camera");
        } catch {
          setNote("I couldn't open the camera. Allow it for this site in Edge, then try again.");
        }
      }
      setPhoto(image ?? null);
      set("thinking");
      speaker.current?.stop();
      const greeting = await checkIn();
      if (greeting) speaker.current?.push(`${greeting} `);
      const ac = new AbortController();
      abort.current = ac;
      streamDone.current = false;
      let spoke = false;
      let acked = false;
      try {
        await streamChat(
          { message: question, mode: "voice", conversationId: conversationId.current, image },
          {
            onConversation: (id) => (conversationId.current = id),
            onTool: (name, detail) => {
              const what = DOING[name];
              if (what) {
                const extra = name === "uber_link" || !detail || detail.length > 60 ? "" : ` · ${detail}`;
                setActivity((a) => [...a.slice(-3), `${what}${extra}`]);
              }
              // Working on something before he has anything to say: a quick word so Tommy knows he heard.
              if (!acked && !spoke) {
                acked = true;
                setTimeout(() => {
                  if (!gotText.current && !ac.signal.aborted) {
                    speaker.current?.push(`${ACKS[Math.floor(Math.random() * ACKS.length)]} `);
                    speaker.current?.flush();
                  }
                }, 900);
              }
              if (name !== "uber_link") return;
              try {
                setLink(JSON.parse(detail) as { label: string; url: string });
              } catch {}
            },
            onText: (d) => {
              gotText.current = true;
              if (!spoke) {
                spoke = true;
                set("speaking");
              }
              setReply((r) => r + d);
              speaker.current?.push(d);
            },
          },
          ac.signal,
        );
        streamDone.current = true;
        speaker.current?.flush();
        // If nothing is playing (e.g. no voice set up), go straight back to listening.
        setTimeout(() => {
          if ((phaseRef.current === "thinking" || phaseRef.current === "speaking") && !speakingNow.current) {
            bargeOnly.current = false;
            resumeListening(true);
          }
        }, 600);
      } catch (err) {
        if (ac.signal.aborted) return;
        const msg = err instanceof Error ? err.message : String(err);
        if (msg === "signed_out") {
          window.location.href = "/login?next=/station";
          return;
        }
        setNote(msg);
        setTone("alert");
        streamDone.current = true;
        bargeOnly.current = false;
        resumeListening(false);
      } finally {
        abort.current = null;
      }
    },
    [checkIn, markAwake, resumeListening, stopRec],
  );

  useEffect(() => {
    const Ctor =
      (window as unknown as { SpeechRecognition?: new () => SR }).SpeechRecognition ||
      (window as unknown as { webkitSpeechRecognition?: new () => SR }).webkitSpeechRecognition;

    speaker.current = new Speaker();
    // While he talks the mic only listens for "Jarvis, stop". When he finishes, the recognizer is restarted so
    // nothing he said himself is mistaken for Tommy's next question.
    const listenAfterSpeaking = () => {
      bargeOnly.current = false;
      stopRec();
      setTimeout(() => resumeListening(true), 250);
    };
    speaker.current.onStateChange = (on) => {
      speakingNow.current = on;
      if (on) {
        set("speaking");
        if (!announcing.current?.wasMuted && phaseRef.current !== "muted") {
          bargeOnly.current = true;
          wantListening.current = true;
          startRec();
        }
      } else if (announcing.current) {
        const { wasMuted } = announcing.current;
        announcing.current = null;
        if (wasMuted) {
          bargeOnly.current = false;
          stopRec();
          set("muted");
        } else listenAfterSpeaking();
      } else if (!streamDone.current && !gotText.current) set("thinking"); // the "one moment" line ended; still working
      else if (phaseRef.current === "speaking" && streamDone.current) listenAfterSpeaking();
    };

    fetch("/api/conversation")
      .then((r) => {
        if (r.status === 401) window.location.href = "/login?next=/station";
        return r.json();
      })
      .then((d: { id?: number }) => (conversationId.current = d.id ?? null))
      .catch(() => {});

    // Audio may need one tap before the browser lets a page play sound (the station shortcut turns this off).
    new Audio("data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAQB8AAIA+AAACABAAZGF0YQAAAAA=").play().catch(() => setNeedsTap(true));

    wantListening.current = true;
    try {
      if (localStorage.getItem("jarvis.station.muted") === "1") {
        wantListening.current = false;
        set("muted");
      }
    } catch {}

    if (!Ctor) {
      set("unsupported");
      return;
    }
    const r = new Ctor();
    r.continuous = true;
    r.interimResults = true;
    r.lang = "en-US";
    rec.current = r;

    let pendingWake: ReturnType<typeof setTimeout> | null = null;
    r.onresult = (e) => {
      backoff.current = 300;
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i];
        const text = res[0].transcript.trim();
        if (!text) continue;
        if (bargeOnly.current) {
          if (STOP.test(text)) stopEverything();
          continue;
        }
        const awaiting = awaitingCommandUntil.current > Date.now();
        if (awaiting) {
          setHeard(text);
          if (res.isFinal && words(text) >= 1) {
            const q = WAKE.test(text) ? afterWake(text) || text : text;
            if (words(q) >= 2 || !WAKE.test(text)) ask(q);
          }
          continue;
        }
        if (!WAKE.test(text)) continue;
        const rest = afterWake(text);
        if (res.isFinal) {
          if (pendingWake) clearTimeout(pendingWake);
          pendingWake = null;
          if (words(rest) >= 2) {
            chime(true);
            ask(rest);
          } else {
            // "Jarvis" on its own: greet / catch up if he's been away, otherwise listen for the question.
            markAwake();
            greetIfAwayRef.current?.();
            chime(true);
            awaitingCommandUntil.current = Date.now() + COMMAND_WAIT_MS;
            setHeard("");
            setReply("");
            set("listening");
            setTimeout(() => {
              if (phaseRef.current === "listening" && Date.now() >= awaitingCommandUntil.current) {
                awaitingCommandUntil.current = 0;
                set("idle");
              }
            }, COMMAND_WAIT_MS + 100);
          }
        } else if (phaseRef.current === "idle") {
          // Show that he heard his name while the sentence finishes.
          set("listening");
          setHeard(rest);
          if (pendingWake) clearTimeout(pendingWake);
          pendingWake = setTimeout(() => {
            if (phaseRef.current === "listening" && !awaitingCommandUntil.current) set("idle");
          }, 6000);
        }
      }
    };
    r.onend = () => {
      if (rec.current !== r) return; // an old recognizer from before a remount
      running.current = false;
      if (!wantListening.current) return;
      setTimeout(startRec, backoff.current);
      backoff.current = Math.min(backoff.current * 2, 10_000);
    };
    r.onerror = (e) => {
      if (e.error === "not-allowed" || e.error === "service-not-allowed") {
        wantListening.current = false;
        set("blocked");
      } else if (e.error === "network") {
        setNote("Lost the connection to speech recognition; retrying…");
        backoff.current = 5000;
      }
      // "no-speech" and "aborted" are normal; onend restarts.
    };
    if (phaseRef.current !== "muted") {
      set("idle");
      startRec();
    }

    try {
      if (localStorage.getItem("jarvis.station.announce") === "0") {
        announceOnRef.current = false;
        setAnnounceOn(false);
      }
    } catch {}
    const pollAnnouncements = () =>
      fetch(`/api/announcements${lastAnnId.current === null ? "" : `?after=${lastAnnId.current}`}`)
        .then((r) => (r.ok ? r.json() : null))
        .then((d: { lastId?: number; items: { id: number; kind: string; text: string; say: string }[]; quiet: boolean } | null) => {
          if (!d) return;
          if (lastAnnId.current === null) {
            lastAnnId.current = d.lastId ?? 0; // start from now; don't replay old ones
            if (!d.quiet) play("startup");
            return;
          }
          for (const it of d.items) {
            lastAnnId.current = Math.max(lastAnnId.current, it.id);
            queue.current.push({ ...it, quiet: d.quiet });
          }
        })
        .catch(() => {});
    pollAnnouncements();
    const annPoll = setInterval(pollAnnouncements, 15_000);
    const annRun = setInterval(() => {
      const free = ["idle", "muted", "unsupported", "blocked"].includes(phaseRef.current) && !announcing.current && !speakingNow.current;
      if (!free || !queue.current.length) return;
      const it = queue.current.shift()!;
      setBulletin({ text: it.text, at: Date.now() });
      setTone(ALERTY.test(it.text) ? "alert" : "normal");
      if (ALERTY.test(it.text)) setTimeout(() => setTone("normal"), 90_000);
      lastActive.current = Date.now();
      if (it.quiet || !announceOnRef.current) return; // quiet hours or announcements off: show only
      announcing.current = { wasMuted: phaseRef.current === "muted" };
      wantListening.current = false;
      stopRec();
      streamDone.current = true;
      play(it.kind === "calendar" || it.kind === "weather" ? "note" : "alert");
      setTimeout(() => {
        speaker.current?.push(`${it.say} `);
        speaker.current?.flush();
      }, 350);
    }, 2000);

    const onOnline = () => {
      setNote(null);
      backoff.current = 300;
      if (wantListening.current) startRec();
    };
    window.addEventListener("online", onOnline);
    const reload = setInterval(() => {
      if ((phaseRef.current === "idle" || phaseRef.current === "muted") && Date.now() - lastActive.current > 10 * 60_000) window.location.reload();
    }, RELOAD_EVERY_MS);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(reload);
      clearInterval(annPoll);
      clearInterval(annRun);
      wantListening.current = false;
      r.onresult = null;
      r.onend = null;
      r.onerror = null;
      try {
        r.abort();
      } catch {}
      running.current = false;
      if (rec.current === r) rec.current = null;
      speaker.current?.stop();
    };
  }, [ask, resumeListening, startRec, stopRec]);

  // Says the greeting or catch-up (if any), then leaves a few seconds to answer without "Jarvis".
  const greetIfAway = useCallback(async () => {
    const say = await checkIn();
    if (!say) return false;
    announcing.current = { wasMuted: phaseRef.current === "muted" };
    wantListening.current = false;
    stopRec();
    streamDone.current = true;
    speaker.current?.push(`${say} `);
    speaker.current?.flush();
    return true;
  }, [checkIn, stopRec]);

  useEffect(() => {
    greetIfAwayRef.current = greetIfAway;
  }, [greetIfAway]);

  // Let the HUD's big core follow along.
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("jarvis-phase", { detail: phase }));
  }, [phase]);

  // "Jarvis, stop": cut off whatever he's doing and go back to waiting for "Jarvis".
  const stopEverythingRef = useRef<() => void>(() => {});
  function stopEverything() {
    stopEverythingRef.current();
  }
  useEffect(() => {
    stopEverythingRef.current = () => {
      abort.current?.abort();
      streamDone.current = true;
      bargeOnly.current = false;
      announcing.current = null;
      speaker.current?.stop();
      setActivity([]);
      play("done");
      stopRec();
      setTimeout(() => resumeListening(false), 300);
    };
  }, [resumeListening, stopRec]);

  // Boot readout: each system's status scrolls by when the station starts (once per browser tab).
  useEffect(() => {
    try {
      if (sessionStorage.getItem("jarvis.booted") === "1") return;
      sessionStorage.setItem("jarvis.booted", "1");
    } catch {}
    let cancelled = false;
    fetch("/api/diagnostics?quick=1")
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { systems: { name: string; status: string }[] } | null) => {
        if (!d || cancelled) return;
        setBoot({ lines: d.systems, shown: 0, done: false });
        d.systems.forEach((_, i) => setTimeout(() => !cancelled && setBoot((b) => (b ? { ...b, shown: i + 1 } : b)), 180 * (i + 1)));
        const end = 180 * (d.systems.length + 1);
        setTimeout(() => !cancelled && setBoot((b) => (b ? { ...b, done: true } : b)), end);
        setTimeout(() => !cancelled && setBoot(null), end + 2200);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  // Sensing: the webcam notices someone sitting down (locally, nothing is saved or sent). After a few minutes with
  // nobody around, the next arrival checks in, so he greets you and says what you missed, as if you'd said "Jarvis".
  useEffect(() => {
    try {
      if (localStorage.getItem("jarvis.station.sense") === "1") setSensing(true);
    } catch {}
  }, []);
  useEffect(() => {
    if (!sensing) return;
    let watcher: MotionWatcher | null = null;
    let stopped = false;
    watchMotion(
      () => {
        const now = Date.now();
        const gap = now - lastArrive.current;
        lastArrive.current = now;
        const h = new Date().getHours();
        if (gap < 5 * 60_000 || h < 5 || h >= 23) return; // still around, or the middle of the night
        if (phaseRef.current !== "idle") return;
        greetIfAwayRef.current?.();
      },
      { cooldownMs: 60_000 },
    )
      .then((w) => {
        if (stopped) w.stop();
        else watcher = w;
      })
      .catch(() => {
        setNote("Sensing needs the camera. Allow it for this site in Edge, then turn sensing on again.");
        setSensing(false);
      });
    return () => {
      stopped = true;
      watcher?.stop();
    };
  }, [sensing]);

  const toggleSensing = () => {
    const next = !sensing;
    setSensing(next);
    if (next) lastArrive.current = Date.now(); // you're here now; greet the next arrival after you've been away
    try {
      localStorage.setItem("jarvis.station.sense", next ? "1" : "0");
    } catch {}
  };

  // Tap the orb: stop him talking, or start listening without the wake word, or wake from mute.
  const tapOrb = () => {
    markAwake();
    greetIfAway().catch(() => {});
    speaker.current?.unlock();
    setNeedsTap(false);
    if (phaseRef.current === "speaking" || phaseRef.current === "thinking") {
      stopEverything();
      return;
    }
    if (phaseRef.current === "muted") return toggleMute();
    chime(true);
    awaitingCommandUntil.current = Date.now() + COMMAND_WAIT_MS;
    set("listening");
    wantListening.current = true;
    startRec();
  };

  // Camera button: take the photo now, then listen for the question (no "Jarvis" needed).
  const showJarvis = async () => {
    markAwake();
    speaker.current?.unlock();
    if (["thinking", "speaking", "looking"].includes(phaseRef.current)) return;
    set("looking");
    setNote(null);
    setReply("");
    setHeard("");
    try {
      const img = await webcamSnapshot();
      play("camera");
      pendingPhoto.current = img;
      setPhoto(img);
      chime(true);
      awaitingCommandUntil.current = Date.now() + 12_000;
      wantListening.current = true;
      set("listening");
      startRec();
      setTimeout(() => {
        // No question came: ask about the photo anyway.
        if (pendingPhoto.current === img && phaseRef.current === "listening") ask("What's this?");
      }, 12_500);
    } catch {
      setNote("I couldn't open the camera. Allow it for this site in Edge, then try again.");
      set(phaseRef.current === "muted" ? "muted" : "idle");
    }
  };

  const toggleAnnounce = () => {
    const next = !announceOnRef.current;
    announceOnRef.current = next;
    setAnnounceOn(next);
    try {
      localStorage.setItem("jarvis.station.announce", next ? "1" : "0");
    } catch {}
    if (!next && announcing.current) speaker.current?.stop();
  };

  const toggleMute = () => {
    const muting = phaseRef.current !== "muted";
    try {
      localStorage.setItem("jarvis.station.muted", muting ? "1" : "0");
    } catch {}
    if (muting) {
      wantListening.current = false;
      abort.current?.abort();
      speaker.current?.stop();
      stopRec();
      chime(false);
      set("muted");
    } else {
      set("idle");
      resumeListening(false);
    }
  };

  const label: Record<Phase, string> = {
    starting: "Starting…",
    idle: `Say “${idn.assistant}…”`,
    listening: "Listening…",
    looking: "Looking…",
    thinking: "Thinking…",
    speaking: "Speaking (tap to stop)",
    muted: "Mic off (tap to turn on)",
    unsupported: "Wake word needs Edge or Chrome",
    blocked: "Allow the microphone for this site, then reload",
  };
  return (
    <>
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-bg/95 px-6 py-4 backdrop-blur">
        <div className="mx-auto flex max-w-[1600px] items-center gap-6">
          <button onClick={tapOrb} aria-label={label[phase]} className="shrink-0 rounded-full">
            <Core phase={phase} size={96} tone={tone} />
            <span className="sr-only">{label[phase]}</span>
          </button>
          {photo && (heard || reply || phase === "looking" || phase === "listening") && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={photo} alt="What Jarvis saw" className="h-24 w-32 shrink-0 rounded-xl border border-line object-cover" />
          )}
          <div className="min-w-0 flex-1">
            <div className={`text-sm tracking-[0.2em] ${tone === "alert" ? "text-warn" : "text-accent"}`}>{label[phase].toUpperCase()}</div>
            {activity.length > 0 && (phase === "thinking" || phase === "speaking" || phase === "looking") && (
              <div className="font-mono text-xs text-accent/80">
                {activity.map((a, i) => (
                  <div key={i} className={i === activity.length - 1 ? "animate-pulse" : "opacity-60"}>
                    › {a}
                  </div>
                ))}
              </div>
            )}
            {bulletin && Date.now() - bulletin.at < 10 * 60_000 && !heard && !reply && <p className="line-clamp-2 text-xl">🔔 {bulletin.text}</p>}
            {heard && <p className="truncate text-xl text-muted">“{heard}”</p>}
            {reply && <p className="line-clamp-2 text-2xl">{reply}</p>}
            {note && <p className="text-sm text-warn">{note}</p>}
            {link && (
              <a href={link.url} className="mt-1 inline-block rounded-lg bg-accent px-3 py-1 text-sm font-semibold text-bg">
                {link.label} →
              </a>
            )}
          </div>
          <button onClick={showJarvis} className="shrink-0 rounded-xl border border-line px-4 py-3 text-sm text-muted hover:text-ink" aria-label="Show Jarvis something with the camera">
            📷 Show Jarvis
          </button>
          <button
            onClick={toggleSensing}
            className={`shrink-0 rounded-xl border px-4 py-3 text-sm hover:text-ink ${sensing ? "border-accent text-accent" : "border-line text-muted"}`}
            title="Uses the webcam to notice when you sit down, so Jarvis can greet you. Nothing is saved or sent."
          >
            {sensing ? "Sensing on" : "Sensing off"}
          </button>
          <button onClick={toggleAnnounce} className="shrink-0 rounded-xl border border-line px-4 py-3 text-sm text-muted hover:text-ink">
            {announceOn ? "Announcements on" : "Announcements off"}
          </button>
          <button onClick={toggleMute} className="shrink-0 rounded-xl border border-line px-4 py-3 text-sm text-muted hover:text-ink">
            {phase === "muted" ? "Mic on" : "Mic off"}
          </button>
        </div>
      </div>
      {boot && (
        <div className={`pointer-events-none fixed inset-0 z-[25] flex items-center justify-center bg-bg/95 transition-opacity duration-700 ${boot.done ? "opacity-0 delay-[1500ms]" : "opacity-100"}`}>
          <div className="w-[min(90vw,520px)] font-mono text-sm">
            <div className="mb-3 tracking-[0.3em] text-accent">J.A.R.V.I.S. · SYSTEMS CHECK</div>
            {boot.lines.slice(0, boot.shown).map((l) => (
              <div key={l.name} className="flex justify-between border-b border-line/40 py-0.5">
                <span className="text-muted">{l.name.toUpperCase()}</span>
                <span className={l.status === "online" ? "text-accent" : l.status === "warning" ? "text-warn" : "text-muted/60"}>{l.status.toUpperCase()}</span>
              </div>
            ))}
            {boot.done && (
              <div className="mt-3 tracking-[0.3em] text-accent">
                {boot.lines.filter((l) => l.status === "online").length}/{boot.lines.length} SYSTEMS ONLINE
              </div>
            )}
          </div>
        </div>
      )}
      {needsTap && (
        <button onClick={tapOrb} className="fixed inset-0 z-30 flex items-center justify-center bg-bg/90 text-3xl tracking-[0.2em] text-accent">
          TAP ANYWHERE TO START {idn.assistant.toUpperCase()}
        </button>
      )}
    </>
  );
}
