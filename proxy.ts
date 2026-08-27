import { NextRequest, NextResponse } from "next/server";
import { COCKPIT_COOKIE, validCockpitToken } from "@/lib/cockpit-auth";

const publicApiPrefixes = [
  "/api/cockpit/login",
  "/api/auth/",
  "/api/gmail/callback",
  "/api/landing/",
  "/api/events",
  "/api/bookings",
  "/api/media/",
  "/api/internal/website-capture",
  "/api/internal/social-profile-capture",
  "/api/preview/",
  "/api/cron/automation",
  "/api/campaign-control",
  "/api/telegram/webhook",
];

export async function proxy(request: NextRequest) {
  const pathname = request.nextUrl.pathname;
  if (publicApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const authenticated = await validCockpitToken(request.cookies.get(COCKPIT_COOKIE)?.value);
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Cockpit-Anmeldung erforderlich." }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.url);
  loginUrl.searchParams.set("next", `${pathname}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
