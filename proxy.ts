import { NextRequest, NextResponse } from "next/server";
import { COCKPIT_COOKIE, validCockpitToken } from "@/lib/cockpit-auth";

const BASE_PATH = "/admin";
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
  "/api/renderer-health",
  "/api/runtime-capabilities",
  "/api/cron/automation",
  "/api/telegram/webhook",
];

function withoutBasePath(pathname: string) {
  if (pathname === BASE_PATH) return "/";
  return pathname.startsWith(`${BASE_PATH}/`) ? pathname.slice(BASE_PATH.length) : pathname;
}

export async function proxy(request: NextRequest) {
  const pathname = withoutBasePath(request.nextUrl.pathname);
  if (publicApiPrefixes.some((prefix) => pathname === prefix || pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const authenticated = await validCockpitToken(request.cookies.get(COCKPIT_COOKIE)?.value);
  if (authenticated) return NextResponse.next();

  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Cockpit-Anmeldung erforderlich." }, { status: 401 });
  }

  const loginUrl = new URL(`${BASE_PATH}/login`, request.url);
  const target = `${BASE_PATH}${pathname === "/" ? "/dashboard" : pathname}${request.nextUrl.search}`;
  loginUrl.searchParams.set("next", target);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/system/:path*",
    "/telegram/:path*",
    "/renderer-status/:path*",
    "/api/:path*",
  ],
};
