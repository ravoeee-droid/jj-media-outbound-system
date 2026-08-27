import { NextResponse } from "next/server";
import { COCKPIT_COOKIE } from "@/lib/cockpit-auth";

export async function POST() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(COCKPIT_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return response;
}
