import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { accounts } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";
import { googleOAuthAppBase } from "@/lib/google-oauth-url";

const STATE_COOKIE = "dg_gmail_oauth_state";

function finish(request: Request, status: "connected" | "denied" | "error", detail?: string) {
  const calendar = request.headers.get("cookie")?.split(";").some((entry) => entry.trim() === "jj_google_destination=whatsapp");
  const url = new URL(`${googleOAuthAppBase(request.url)}/dashboard/${calendar ? "whatsapp?tab=connection" : "outbound"}`);
  url.searchParams.set("gmail", status);
  if (detail) url.searchParams.set("detail", detail.slice(0, 180));
  if (!calendar) url.hash = "integrationen";
  const response = NextResponse.redirect(url);
  response.cookies.set(STATE_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  response.cookies.set("jj_google_destination", "", { path: "/", maxAge: 0, httpOnly: true });
  return response;
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    if (url.searchParams.get("error")) return finish(request, "denied", url.searchParams.get("error") || undefined);
    const code = url.searchParams.get("code");
    const state = url.searchParams.get("state");
    const cookieState = request.headers.get("cookie")
      ?.split(";")
      .map((entry) => entry.trim().split("="))
      .find(([key]) => key === STATE_COOKIE)?.[1];
    if (!code || !state || !cookieState || state !== decodeURIComponent(cookieState)) {
      return finish(request, "error", "Ungültige oder abgelaufene Google-Anfrage.");
    }

    const clientId = process.env.AUTH_GOOGLE_ID;
    const clientSecret = process.env.AUTH_GOOGLE_SECRET;
    if (!clientId || !clientSecret) return finish(request, "error", "Google-Zugangsdaten fehlen in Vercel.");
    const origin = googleOAuthAppBase(request.url);
    const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: `${origin}/api/gmail/callback`,
        grant_type: "authorization_code",
      }),
    });
    const tokens = await tokenResponse.json() as {
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      id_token?: string;
      scope?: string;
      token_type?: string;
      error_description?: string;
    };
    if (!tokenResponse.ok || !tokens.access_token) {
      return finish(request, "error", tokens.error_description || "Google-Token konnte nicht erstellt werden.");
    }

    const userResponse = await fetch("https://openidconnect.googleapis.com/v1/userinfo", {
      headers: { authorization: `Bearer ${tokens.access_token}` },
    });
    const googleUser = await userResponse.json() as { sub?: string; email?: string };
    if (!userResponse.ok || !googleUser.sub) return finish(request, "error", "Google-Konto konnte nicht gelesen werden.");

    const workspace = await requireWorkspace();
    const db = getDb();
    const [existing] = await db
      .select()
      .from(accounts)
      .where(and(eq(accounts.userId, workspace.user.id), eq(accounts.provider, "google")))
      .limit(1);
    const refreshToken = tokens.refresh_token || (existing?.providerAccountId === googleUser.sub ? existing.refresh_token : undefined);
    if (!refreshToken) return finish(request, "error", "Google hat keinen dauerhaften Zugriff erteilt. Bitte erneut verbinden.");

    await db.delete(accounts).where(and(eq(accounts.userId, workspace.user.id), eq(accounts.provider, "google")));
    await db.insert(accounts).values({
      userId: workspace.user.id,
      type: "oauth",
      provider: "google",
      providerAccountId: googleUser.sub,
      access_token: tokens.access_token,
      refresh_token: refreshToken,
      expires_at: Math.floor(Date.now() / 1000) + (tokens.expires_in || 3600),
      token_type: tokens.token_type || "Bearer",
      scope: tokens.scope || "",
      id_token: tokens.id_token,
    });
    return finish(request, "connected", googleUser.email);
  } catch (error) {
    return finish(request, "error", error instanceof Error ? error.message : "Gmail-Verbindung fehlgeschlagen.");
  }
}
