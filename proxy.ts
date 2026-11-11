// Runs before every page and API request: if a password is set, you must be signed in.
import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, validSession } from "@/lib/auth";

export function proxy(req: NextRequest) {
  if (validSession(req.cookies.get(SESSION_COOKIE)?.value)) return NextResponse.next();
  if (req.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Please sign in again." }, { status: 401 });
  }
  const login = new URL("/login", req.url);
  // Come back to the same page after signing in (e.g. the station screen).
  if (req.nextUrl.pathname !== "/") login.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(login);
}

export const config = {
  // Everything except the login page, the app icons/manifest/notification worker (phones fetch these signed out),
  // signed media links (/m/…, checked by their own signature, for Instagram to fetch), Saleshandy's and Telegram's webhooks
  // (checked by their secret headers), the public audit-request form (checked by origin, rate limit and a bot trap), and Next's static files.
  matcher: ["/((?!login|api/login|api/health|api/saleshandy/webhook|api/telegram/webhook|api/public/|_next/static|_next/image|favicon.ico|icon.png|apple-icon.png|icon-192.png|icon-512.png|manifest.webmanifest|sw.js|m/).*)"],
};
