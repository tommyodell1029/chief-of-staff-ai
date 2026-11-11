"use client";
// Presence sensing for the station: watches the webcam at very low resolution and reports when someone is moving in
// front of it. Everything happens in the browser; no picture is saved or sent anywhere.

export interface MotionWatcher {
  stop: () => void;
}

// Calls onArrive when there's steady movement (most of the last few checks), at most once per `cooldownMs`.
export async function watchMotion(onArrive: () => void, opts: { intervalMs?: number; cooldownMs?: number } = {}): Promise<MotionWatcher> {
  const interval = opts.intervalMs ?? 700;
  const cooldown = opts.cooldownMs ?? 60_000;
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: 160, height: 120, frameRate: 5 }, audio: false });
  const video = document.createElement("video");
  video.muted = true;
  video.playsInline = true;
  video.srcObject = stream;
  await video.play().catch(() => {});

  const W = 40;
  const H = 30;
  const canvas = document.createElement("canvas");
  canvas.width = W;
  canvas.height = H;
  const g = canvas.getContext("2d", { willReadFrequently: true });
  let prev: Uint8ClampedArray | null = null;
  const recent: boolean[] = [];
  let lastFired = 0;

  const timer = setInterval(() => {
    if (!g || video.readyState < 2) return;
    g.drawImage(video, 0, 0, W, H);
    const px = g.getImageData(0, 0, W, H).data;
    const gray = new Uint8ClampedArray(W * H);
    for (let i = 0; i < W * H; i++) gray[i] = (px[i * 4] * 3 + px[i * 4 + 1] * 6 + px[i * 4 + 2]) / 10;
    if (prev) {
      // Ignore small flicker and whole-frame light changes (a lamp turning on shifts everything evenly).
      let mean = 0;
      for (let i = 0; i < gray.length; i++) mean += gray[i] - prev[i];
      mean /= gray.length;
      let changed = 0;
      for (let i = 0; i < gray.length; i++) if (Math.abs(gray[i] - prev[i] - mean) > 28) changed++;
      recent.push(changed / gray.length > 0.06);
      if (recent.length > 5) recent.shift();
      const moving = recent.filter(Boolean).length >= 3;
      if (moving && Date.now() - lastFired > cooldown) {
        lastFired = Date.now();
        onArrive();
      }
    }
    prev = gray;
  }, interval);

  return {
    stop: () => {
      clearInterval(timer);
      stream.getTracks().forEach((t) => t.stop());
      video.srcObject = null;
    },
  };
}
