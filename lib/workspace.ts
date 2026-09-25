import { and, eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { assertDatabaseConfigured, getDb } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";
import { COCKPIT_COOKIE, readCockpitSession, validCockpitToken } from "@/lib/cockpit-auth";
import { hasPermission, normalizedPermissions, normalizedRole, type TeamPermission } from "@/lib/team";

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function ensureBootstrapUser() {
  assertDatabaseConfigured();
  const db = getDb();
  const email = "cockpit@jj-media.local";
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) {
    if (existing.name !== "Jessica Just" || existing.status !== "active") {
      const [updated] = await db
        .update(users)
        .set({ name: "Jessica Just", status: "active", updatedAt: new Date() })
        .where(eq(users.id, existing.id))
        .returning();
      return updated ?? existing;
    }
    return existing;
  }

  const [created] = await db
    .insert(users)
    .values({ name: "Jessica Just", email, status: "active" })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (created) return created;

  const [resolved] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!resolved) throw new Error("Cockpit-Benutzer konnte nicht angelegt werden.");
  return resolved;
}

export async function requireUser() {
  assertDatabaseConfigured();
  const cookieValue = (await cookies()).get(COCKPIT_COOKIE)?.value;
  if (!await validCockpitToken(cookieValue)) throw new Error("UNAUTHORIZED");

  const session = await readCockpitSession(cookieValue);
  if (!session) return ensureBootstrapUser();

  const [user] = await getDb()
    .select()
    .from(users)
    .where(and(eq(users.id, session.userId), eq(users.status, "active")))
    .limit(1);
  if (!user) throw new Error("UNAUTHORIZED");
  return user;
}

export async function requireWorkspace() {
  assertDatabaseConfigured();
  const user = await requireUser();
  const db = getDb();
  const [membership] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      permissions: workspaceMembers.permissions,
      name: workspaces.name,
      slug: workspaces.slug,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, user.id))
    .limit(1);

  if (membership) {
    const role = normalizedRole(membership.role);
    const permissions = normalizedPermissions(role, membership.permissions);
    return { ...membership, role, permissions, user };
  }

  // Only the legacy bootstrap account may create the first workspace.
  if (user.email !== "cockpit@jj-media.local") throw new Error("UNAUTHORIZED");

  const name = "JJ-Media";
  const workspaceSlug = `${slugify(name)}-${user.id.slice(0, 8)}`;
  const [workspace] = await db
    .insert(workspaces)
    .values({ name, slug: workspaceSlug, ownerId: user.id })
    .onConflictDoNothing({ target: workspaces.slug })
    .returning();

  const resolved =
    workspace ??
    (
      await db
        .select()
        .from(workspaces)
        .where(and(eq(workspaces.slug, workspaceSlug), eq(workspaces.ownerId, user.id)))
        .limit(1)
    )[0];
  if (!resolved) throw new Error("Workspace konnte nicht angelegt werden.");

  await db
    .insert(workspaceMembers)
    .values({ workspaceId: resolved.id, userId: user.id, role: "owner", permissions: [] })
    .onConflictDoNothing();

  return {
    workspaceId: resolved.id,
    role: "owner" as const,
    permissions: normalizedPermissions("owner", []),
    name: resolved.name,
    slug: resolved.slug,
    user,
  };
}

export async function requirePermission(permission: TeamPermission) {
  const workspace = await requireWorkspace();
  if (!hasPermission(workspace.role, workspace.permissions, permission)) throw new Error("FORBIDDEN");
  return workspace;
}

export function apiError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  if (error instanceof Error && error.message === "FORBIDDEN") {
    return Response.json({ error: "Dafür fehlen dir die Rechte." }, { status: 403 });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "Unbekannter Serverfehler." },
    { status: 500 },
  );
}
