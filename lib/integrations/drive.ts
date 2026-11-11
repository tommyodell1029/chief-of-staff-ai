// Google Drive (through Tommy's Google sign-in): saves Jarvis's work as Google Docs in a "Jarvis" folder.
// The drive.file permission only lets Jarvis see files he created himself, never the rest of Tommy's Drive.
import { getSetting, setSetting } from "@/lib/settings";
import { accessToken, gmailConnected, googleScopes } from "./gmail";

export const driveConnected = () => gmailConnected() && googleScopes().includes("drive.file");

async function drive<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${await accessToken()}`, ...(init.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
  });
  const d = (await res.json()) as T & { error?: { message?: string } };
  if (!res.ok) throw new Error(`Google Drive: ${d.error?.message ?? res.status}`);
  return d;
}

async function jarvisFolder(): Promise<string> {
  const saved = getSetting("drive_folder_id");
  if (saved) return saved;
  const f = await drive<{ id: string }>("https://www.googleapis.com/drive/v3/files", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Jarvis", mimeType: "application/vnd.google-apps.folder" }),
  });
  setSetting("drive_folder_id", f.id);
  return f.id;
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Simple Markdown → HTML, which Drive converts into a formatted Google Doc.
function toHtml(md: string): string {
  const out: string[] = [];
  let list: "ul" | "ol" | null = null;
  const inline = (t: string) => esc(t).replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>");
  for (const line of md.split("\n")) {
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    const ul = line.match(/^\s*[-*•]\s+(.*)$/);
    const ol = line.match(/^\s*\d+[.)]\s+(.*)$/);
    const want = ul ? "ul" : ol ? "ol" : null;
    if (list && list !== want) {
      out.push(`</${list}>`);
      list = null;
    }
    if (h) {
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
    } else if (want) {
      if (!list) {
        out.push(`<${want}>`);
        list = want;
      }
      out.push(`<li>${inline((ul ?? ol)![1])}</li>`);
    } else if (line.trim()) {
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  if (list) out.push(`</${list}>`);
  return `<html><body>${out.join("")}</body></html>`;
}

// Creates a Google Doc and returns its link.
export async function saveDoc(title: string, markdown: string): Promise<string> {
  const folder = await jarvisFolder();
  const boundary = `jarvis${Date.now()}`;
  const body =
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n` +
    JSON.stringify({ name: title.slice(0, 200), mimeType: "application/vnd.google-apps.document", parents: [folder] }) +
    `\r\n--${boundary}\r\nContent-Type: text/html; charset=UTF-8\r\n\r\n${toHtml(markdown)}\r\n--${boundary}--`;
  const f = await drive<{ id: string; webViewLink: string }>(
    "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
    { method: "POST", headers: { "Content-Type": `multipart/related; boundary=${boundary}` }, body },
  );
  return f.webViewLink;
}
