"use client";
// Shrinks a camera photo before sending: max 1568 px on the long side (what Claude reads best), JPEG.
export async function photoToDataUrl(file: File, maxSide = 1568): Promise<string> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", 0.85);
}

// Takes ONE photo with the computer's webcam and turns the camera straight back off. JPEG, max 1568 px.
export async function webcamSnapshot(maxSide = 1568): Promise<string> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 }, facingMode: "user" }, audio: false });
  try {
    const video = document.createElement("video");
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    await video.play();
    // Give the camera a moment to set exposure and focus.
    await new Promise((r) => setTimeout(r, 900));
    const w = video.videoWidth || 1280;
    const h = video.videoHeight || 720;
    const scale = Math.min(1, maxSide / Math.max(w, h));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(w * scale);
    canvas.height = Math.round(h * scale);
    canvas.getContext("2d")!.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/jpeg", 0.85);
  } finally {
    stream.getTracks().forEach((t) => t.stop());
  }
}

// Questions about something Tommy is showing the camera.
export const wantsCamera = (q: string) =>
  /\b(what('?s| is) (this|that|it)|look at (this|that|me)|take a look|can you see|what do you see|what am i (holding|wearing)|read (this|that|the label)|how do i look|is this (ripe|ok|okay|safe|real|broken)|identify (this|that)|what kind of|which one|show you|see this|check (this|that) out|camera|picture of me)\b/i.test(q);
