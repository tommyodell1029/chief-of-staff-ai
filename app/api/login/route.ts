// POST /api/login — check the password and set the sign-in cookie.
import { SESSION_COOKIE, SESSION_MAX_AGE, authEnabled, passwordMatches, sessionToken } from "@/lib/auth";

export const dynamic = "force-dynamic";

// Slow down guessing: at most 10 wrong tries per 15 minutes (resets when the app restarts).
const failures: number[] = [];

export async function POST(req: Request) {
  if (!authEnabled()) return Response.json({ ok: true });
  const now = Date.now();
  while (failures.length && now - failures[0] > 15 * 60_000) failures.shift();
  if (failures.length >= 10) {
    return Response.json({ error: "Too many wrong tries. Wait 15 minutes." }, { status: 429 });
  }
  const { password } = (await req.json().catch(() => ({}))) as { password?: string };
  if (!password || !passwordMatches(password)) {
    failures.push(now);
    await new Promise((r) => setTimeout(r, 800));
    return Response.json({ error: "Wrong password." }, { status: 401 });
  }
  const res = Response.json({ ok: true });
  const secure = new URL(req.url).protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  res.headers.append(
    "Set-Cookie",
    `${SESSION_COOKIE}=${sessionToken()}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE}${secure ? "; Secure" : ""}`,
  );
  return res;
}
