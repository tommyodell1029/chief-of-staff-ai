"use client";
// Jarvis's interface sounds, synthesized in the browser (no audio files): soft, short, original.
// startup: a rising shimmer when the station opens · listen: he heard you · done: back to idle
// alert: something important · note: a small heads-up (weather, calendar) · camera: a soft shutter.

let ctx: AudioContext | null = null;
function audio(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      ctx = new Ctx();
    }
    if (ctx.state === "suspended") ctx.resume().catch(() => {});
    return ctx;
  } catch {
    return null;
  }
}

// One soft tone: frequency glide, gentle attack and release, optional sparkle partial.
function tone(c: AudioContext, at: number, from: number, to: number, dur: number, vol = 0.12, type: OscillatorType = "sine") {
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(from, at);
  o.frequency.exponentialRampToValueAtTime(to, at + dur * 0.8);
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(vol, at + Math.min(0.03, dur / 4));
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  o.connect(g).connect(c.destination);
  o.start(at);
  o.stop(at + dur + 0.05);
}

export type SoundName = "startup" | "listen" | "done" | "alert" | "note" | "camera";

export function play(name: SoundName) {
  const c = audio();
  if (!c) return;
  const t = c.currentTime + 0.02;
  switch (name) {
    case "startup":
      [392, 523.25, 659.25, 783.99].forEach((f, i) => tone(c, t + i * 0.11, f * 0.98, f, 0.55, 0.07));
      tone(c, t + 0.45, 1567.98, 1567.98, 0.9, 0.025, "triangle");
      break;
    case "listen":
      tone(c, t, 660, 990, 0.18, 0.11);
      break;
    case "done":
      tone(c, t, 880, 590, 0.2, 0.08);
      break;
    case "alert":
      tone(c, t, 784, 784, 0.32, 0.1, "triangle");
      tone(c, t + 0.16, 1046.5, 1046.5, 0.45, 0.09, "triangle");
      break;
    case "note":
      tone(c, t, 1174.66, 1174.66, 0.22, 0.06, "triangle");
      break;
    case "camera":
      tone(c, t, 2200, 1400, 0.06, 0.05, "square");
      tone(c, t + 0.07, 1800, 1100, 0.07, 0.04, "square");
      break;
  }
}
