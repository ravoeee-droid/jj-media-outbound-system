import { and, eq } from "drizzle-orm";
import { assertDatabaseConfigured, getDb } from "@/db";
import { users, workspaceMembers, workspaces } from "@/db/schema";

function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

export async function requireUser() {
  assertDatabaseConfigured();
  const db = getDb();
  const email = "cockpit@jj-media.local";
  const [existing] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(users)
    .values({ name: "JJ-Media", email })
    .onConflictDoNothing({ target: users.email })
    .returning();
  if (created) return created;

  const [resolved] = await db.select().from(users).where(eq(users.email, email)).limit(1);
  if (!resolved) throw new Error("Cockpit-Benutzer konnte nicht angelegt werden.");
  return resolved;
}

export async function requireWorkspace() {
  assertDatabaseConfigured();
  const user = await requireUser();
  const db = getDb();
  const [membership] = await db
    .select({
      workspaceId: workspaceMembers.workspaceId,
      role: workspaceMembers.role,
      name: workspaces.name,
      slug: workspaces.slug,
    })
    .from(workspaceMembers)
    .innerJoin(workspaces, eq(workspaces.id, workspaceMembers.workspaceId))
    .where(eq(workspaceMembers.userId, user.id))
    .limit(1);

  if (membership) return { ...membership, user };

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
    .values({ workspaceId: resolved.id, userId: user.id, role: "owner" })
    .onConflictDoNothing();

  return { workspaceId: resolved.id, role: "owner", name: resolved.name, slug: resolved.slug, user };
}

export function apiError(error: unknown) {
  if (error instanceof Error && error.message === "UNAUTHORIZED") {
    return Response.json({ error: "Nicht angemeldet." }, { status: 401 });
  }
  return Response.json(
    { error: error instanceof Error ? error.message : "Unbekannter Serverfehler." },
    { status: 500 },
  );
}
