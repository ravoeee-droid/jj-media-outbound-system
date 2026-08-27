import { NextResponse } from "next/server";
import { COCKPIT_COOKIE, COCKPIT_COOKIE_MAX_AGE, cockpitToken, passwordMatches } from "@/lib/cockpit-auth";

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as { password?: unknown };
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!passwordMatches(password)) {
    await new Promise((resolve) => setTimeout(resolve, 450));
    return NextResponse.json({ error: "Das Passwort ist nicht korrekt." }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COCKPIT_COOKIE, await cockpitToken(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COCKPIT_COOKIE_MAX_AGE,
  });
  return response;
}
