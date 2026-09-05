import { NextResponse } from "next/server";
import { googleOAuthAppBase } from "@/lib/google-oauth-url";

const STATE_COOKIE = "dg_gmail_oauth_state";

export async function GET(request: Request) {
  const clientId = process.env.AUTH_GOOGLE_ID;
  if (!clientId) {
    return NextResponse.json({
      error: "AUTH_GOOGLE_ID fehlt in Vercel. Gmail kann noch nicht verbunden werden.",
    }, { status: 503 });
  }

  const origin = googleOAuthAppBase(request.url);
  const url = new URL(request.url);
  const calendar = url.searchParams.get("calendar") === "1";
  const destination = url.searchParams.get("destination") === "email" ? "email" : calendar ? "whatsapp" : "outbound";
  const state = crypto.randomUUID();
  const authorizationUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", `${origin}/api/gmail/callback`);
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("access_type", "offline");
  authorizationUrl.searchParams.set("prompt", "consent");
  authorizationUrl.searchParams.set("include_granted_scopes", "true");
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("scope", [
    "openid",
    "email",
    "profile",
    ...(calendar ? ["https://www.googleapis.com/auth/calendar.events", "https://www.googleapis.com/auth/calendar.freebusy"] : []),
  ].join(" "));

  const response = NextResponse.redirect(authorizationUrl);
  response.cookies.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60,
  });
  response.cookies.set("jj_google_destination", destination, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 600 });
  return response;
}