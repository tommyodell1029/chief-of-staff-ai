// Password login. Turned on by setting JARVIS_PASSWORD (always set it when Jarvis is on the internet).
import { createHmac, timingSafeEqual } from "node:crypto";

export const SESSION_COOKIE = "jarvis_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 365; // stay signed in for a year on your own devices

export function authEnabled(): boolean {
  return !!process.env.JARVIS_PASSWORD;
}

// The cookie value is a signature of the password, so changing JARVIS_PASSWORD signs every device out.
export function sessionToken(): string {
  const secret = process.env.SESSION_SECRET || "jarvis-local";
  return createHmac("sha256", secret).update(`session:${process.env.JARVIS_PASSWORD ?? ""}`).digest("hex");
}

function same(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export function validSession(cookie: string | undefined): boolean {
  return !authEnabled() || (!!cookie && same(cookie, sessionToken()));
}

export function passwordMatches(attempt: string): boolean {
  return authEnabled() && same(attempt, process.env.JARVIS_PASSWORD!);
}
