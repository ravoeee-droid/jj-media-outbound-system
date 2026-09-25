import { and, eq } from "drizzle-orm";
import { NextResponse } from "next/server";
import { getDb } from "@/db";
import { users, workspaceMembers } from "@/db/schema";
import { COCKPIT_COOKIE, COCKPIT_COOKIE_MAX_AGE, createCockpitSessionToken, passwordMatches } from "@/lib/cockpit-auth";
import { verifyPassword } from "@/lib/password-auth";
import { ensureBootstrapUser } from "@/lib/workspace";

export const runtime = "nodejs";

async function failure() {
  await new Promise((resolve) => setTimeout(resolve, 450));
  return NextResponse.json({ error: "E-Mail oder Passwort ist nicht korrekt." }, { status: 401 });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => ({})) as { email?: unknown; password?: unknown };
  const email = typeof payload.email === "string" ? payload.email.trim().toLowerCase() : "";
  const password = typeof payload.password === "string" ? payload.password : "";
  if (!password) return failure();

  let userId = "";

  if (email) {
    const db = getDb();
    const [user] = await db
      .select()
      .from(users)
      .where(and(eq(users.email, email), eq(users.status, "active")))
      .limit(1);
    if (!user || !verifyPassword(password, user.passwordSalt, user.passwordHash)) return failure();

    const [membership] = await db
      .select({ workspaceId: workspaceMembers.workspaceId })
      .from(workspaceMembers)
      .where(eq(workspaceMembers.userId, user.id))
      .limit(1);
    if (!membership) return failure();

    userId = user.id;
    await db.update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
  } else {
    // Backwards-compatible bootstrap for Jessica and the local WhatsApp worker.
    if (!passwordMatches(password)) return failure();
    const user = await ensureBootstrapUser();
    userId = user.id;
    await getDb().update(users).set({ lastLoginAt: new Date(), updatedAt: new Date() }).where(eq(users.id, user.id));
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set(COCKPIT_COOKIE, await createCockpitSessionToken(userId), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COCKPIT_COOKIE_MAX_AGE,
  });
  return response;
}
