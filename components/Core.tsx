"use client";
// Jarvis's core: an animated, glowing ring system that shows what he's doing. An original design.
// idle: slow drift and a soft breath · listening: brighter, rings open up · looking: a scanning sweep
// thinking: segments spin fast · speaking: ripples pulse out like a voice · muted: dim and still.
import { useEffect, useRef } from "react";

export type CorePhase = "idle" | "listening" | "looking" | "thinking" | "speaking" | "muted" | "starting" | "unsupported" | "blocked";

export interface Satellite {
  label: string; // e.g. "Etsy 40%"
  warn?: boolean; // behind on a goal
}

export default function Core({
  phase,
  size = 96,
  className = "",
  satellites = [],
  tone = "normal",
}: {
  phase: CorePhase;
  size?: number;
  className?: string;
  satellites?: Satellite[];
  tone?: "normal" | "alert"; // alert: the rings turn amber (something failed or needs attention)
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef<CorePhase>(phase);
  phaseRef.current = phase;
  const satRef = useRef<Satellite[]>(satellites);
  satRef.current = satellites;
  const toneRef = useRef(tone);
  toneRef.current = tone;

  useEffect(() => {
    const el = canvas.current;
    if (!el) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = size * dpr;
    el.height = size * dpr;
    const g = el.getContext("2d");
    if (!g) return;
    g.scale(dpr, dpr);
    const accentBase = getComputedStyle(document.documentElement).getPropertyValue("--color-accent").trim() || "#4cc9f0";
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const ripples: { r: number; a: number }[] = [];
    let energy = 0.3; // eases toward the phase's target
    let spin = 0;
    let lastRipple = 0;
    let raf = 0;
    const c = size / 2;
    const orbit = satRef.current.length > 0;
    const R = size * (orbit ? 0.27 : 0.42);
    const warn = getComputedStyle(document.documentElement).getPropertyValue("--color-warn").trim() || "#f4a261";

    const draw = (now: number) => {
      const p = phaseRef.current;
      const accent = toneRef.current === "alert" ? warn : accentBase;
      const target = p === "speaking" ? 1 : p === "listening" || p === "looking" ? 0.8 : p === "thinking" ? 0.7 : p === "muted" || p === "blocked" || p === "unsupported" ? 0.08 : 0.35;
      energy += (target - energy) * 0.06;
      const speed = reduced ? 0 : p === "thinking" ? 0.06 : p === "listening" || p === "looking" ? 0.02 : p === "muted" ? 0 : 0.006;
      spin += speed;
      const breath = reduced ? 0.5 : 0.5 + 0.5 * Math.sin(now / (p === "listening" ? 350 : 1400));
      g.clearRect(0, 0, size, size);
      g.globalCompositeOperation = "lighter";

      // Glow.
      const glow = g.createRadialGradient(c, c, 0, c, c, R * 1.2);
      glow.addColorStop(0, hexA(accent, 0.35 * energy + 0.05));
      glow.addColorStop(0.45, hexA(accent, 0.12 * energy));
      glow.addColorStop(1, hexA(accent, 0));
      g.fillStyle = glow;
      g.beginPath();
      g.arc(c, c, R * 1.2, 0, Math.PI * 2);
      g.fill();

      // Bright center.
      g.fillStyle = hexA(accent, 0.55 + 0.4 * energy * breath);
      g.beginPath();
      g.arc(c, c, R * (0.16 + 0.04 * energy * breath), 0, Math.PI * 2);
      g.fill();

      g.lineCap = "round";
      // Inner ring of segments.
      const segs = 6;
      for (let i = 0; i < segs; i++) {
        const a0 = spin * 2 + (i * Math.PI * 2) / segs;
        g.strokeStyle = hexA(accent, 0.35 + 0.5 * energy);
        g.lineWidth = Math.max(1.5, size * 0.022);
        g.beginPath();
        g.arc(c, c, R * 0.42, a0, a0 + (Math.PI * 2) / segs - 0.35);
        g.stroke();
      }
      // Middle ring (counter-rotating, with gaps).
      for (let i = 0; i < 3; i++) {
        const a0 = -spin * 1.3 + (i * Math.PI * 2) / 3;
        g.strokeStyle = hexA(accent, 0.25 + 0.45 * energy);
        g.lineWidth = Math.max(1, size * 0.012);
        g.beginPath();
        g.arc(c, c, R * (0.64 + 0.03 * energy * breath), a0, a0 + Math.PI * 0.5);
        g.stroke();
      }
      // Outer tick ring.
      const ticks = 48;
      for (let i = 0; i < ticks; i++) {
        const a = spin * 0.4 + (i * Math.PI * 2) / ticks;
        const long = i % 4 === 0;
        const r1 = R * 0.88;
        const r2 = R * (long ? 0.97 : 0.93);
        g.strokeStyle = hexA(accent, (long ? 0.45 : 0.2) * (0.4 + energy));
        g.lineWidth = Math.max(0.8, size * 0.006);
        g.beginPath();
        g.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
        g.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
        g.stroke();
      }
      // Looking: a scanning sweep.
      if (p === "looking" && !reduced) {
        const a = (now / 500) % (Math.PI * 2);
        const sweep = g.createLinearGradient(c, c, c + Math.cos(a) * R, c + Math.sin(a) * R);
        sweep.addColorStop(0, hexA(accent, 0.5));
        sweep.addColorStop(1, hexA(accent, 0));
        g.strokeStyle = sweep;
        g.lineWidth = Math.max(2, size * 0.03);
        g.beginPath();
        g.moveTo(c, c);
        g.lineTo(c + Math.cos(a) * R, c + Math.sin(a) * R);
        g.stroke();
      }
      // Speaking: ripples like a voice.
      if (p === "speaking" && !reduced && now - lastRipple > 180 + Math.random() * 220) {
        lastRipple = now;
        ripples.push({ r: R * 0.3, a: 0.5 + Math.random() * 0.4 });
      }
      for (const w of ripples) {
        w.r += size * 0.008;
        w.a *= 0.955;
        g.strokeStyle = hexA(accent, w.a);
        g.lineWidth = Math.max(1, size * 0.01);
        g.beginPath();
        g.arc(c, c, w.r, 0, Math.PI * 2);
        g.stroke();
      }
      while (ripples.length && (ripples[0].a < 0.03 || ripples[0].r > R * 1.15)) ripples.shift();

      // Satellites: one per business, slowly orbiting, labels kept upright.
      const sats = satRef.current;
      if (sats.length) {
        const oR = size * 0.4;
        g.strokeStyle = hexA(accent, 0.12);
        g.lineWidth = 1;
        g.setLineDash([2, 6]);
        g.beginPath();
        g.arc(c, c, oR, 0, Math.PI * 2);
        g.stroke();
        g.setLineDash([]);
        g.font = `${Math.max(10, Math.round(size * 0.04))}px ui-sans-serif, system-ui, sans-serif`;
        g.textAlign = "center";
        sats.forEach((s, i) => {
          const a = (reduced ? 0 : now / 30000) + (i * Math.PI * 2) / sats.length - Math.PI / 2;
          const x = c + Math.cos(a) * oR;
          const y = c + Math.sin(a) * oR;
          const col = s.warn ? warn : accent;
          g.fillStyle = hexA(col, 0.9);
          g.beginPath();
          g.arc(x, y, Math.max(2.5, size * 0.012), 0, Math.PI * 2);
          g.fill();
          g.fillStyle = hexA(col, 0.85);
          // Keep the label inside the frame.
          const half = g.measureText(s.label).width / 2 + 2;
          const tx = Math.min(Math.max(x, half), size - half);
          g.fillText(s.label, tx, y + (Math.sin(a) >= 0 ? size * 0.055 : -size * 0.03));
        });
      }

      g.globalCompositeOperation = "source-over";
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [size, satellites.length]);

  return <canvas ref={canvas} style={{ width: size, height: size }} className={className} aria-hidden />;
}

// "#4cc9f0" or "rgb(…)" / "oklch(…)" → a color with alpha.
function hexA(color: string, alpha: number): string {
  const a = Math.max(0, Math.min(1, alpha));
  const m = color.match(/^#([0-9a-f]{6})$/i);
  if (m) {
    const n = parseInt(m[1], 16);
    return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${a})`;
  }
  if (/^(rgb|hsl|oklch|oklab|lab|lch)\(/i.test(color)) return `color-mix(in srgb, ${color} ${Math.round(a * 100)}%, transparent)`;
  return `rgba(76, 201, 240, ${a})`;
}
