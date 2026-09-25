import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { accounts, leads, tasks, users, workspaceMembers } from "@/db/schema";
import { hashPassword } from "@/lib/password-auth";
import {
  PERMISSION_LABELS,
  ROLE_DEFAULTS,
  ROLE_LABELS,
  TEAM_PERMISSIONS,
  TEAM_ROLES,
  normalizedPermissions,
  normalizedRole,
} from "@/lib/team";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";

const editableRoles = ["admin", "sales", "setter", "research", "viewer"] as const;

const createInput = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(320),
  password: z.string().min(10).max(128),
  role: z.enum(editableRoles),
  permissions: z.array(z.enum(TEAM_PERMISSIONS)).optional(),
});

const updateInput = z.object({
  userId: z.string().uuid(),
  name: z.string().trim().min(2).max(120).optional(),
  role: z.enum(editableRoles).optional(),
  permissions: z.array(z.enum(TEAM_PERMISSIONS)).optional(),
  status: z.enum(["active", "inactive"]).optional(),
  password: z.string().min(10).max(128).optional(),
});

export async function GET() {
  try {
    const workspace = await requirePermission("manage_team");
    const db = getDb();

    const [memberRows, leadRows, taskRows] = await Promise.all([
      db
        .select({
          userId: users.id,
          name: users.name,
          email: users.email,
          status: users.status,
          lastLoginAt: users.lastLoginAt,
          createdAt: users.createdAt,
          role: workspaceMembers.role,
          permissions: workspaceMembers.permissions,
          googleScope: accounts.scope,
        })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .leftJoin(accounts, and(eq(accounts.userId, users.id), eq(accounts.provider, "google")))
        .where(eq(workspaceMembers.workspaceId, workspace.workspaceId)),
      db.select({ ownerId: leads.ownerId }).from(leads).where(eq(leads.workspaceId, workspace.workspaceId)),
      db
        .select({ assigneeId: tasks.assigneeId })
        .from(tasks)
        .where(and(eq(tasks.workspaceId, workspace.workspaceId), eq(tasks.status, "open"))),
    ]);

    const leadCounts = new Map<string, number>();
    for (const lead of leadRows) {
      if (!lead.ownerId) continue;
      leadCounts.set(lead.ownerId, (leadCounts.get(lead.ownerId) ?? 0) + 1);
    }
    const taskCounts = new Map<string, number>();
    for (const task of taskRows) {
      if (!task.assigneeId) continue;
      taskCounts.set(task.assigneeId, (taskCounts.get(task.assigneeId) ?? 0) + 1);
    }

    const members = memberRows
      .map((row) => {
        const role = normalizedRole(row.role);
        return {
          ...row,
          role,
          permissions: normalizedPermissions(role, row.permissions),
          leadCount: leadCounts.get(row.userId) ?? 0,
          openTaskCount: taskCounts.get(row.userId) ?? 0,
          isCurrentUser: row.userId === workspace.user.id,
          calendarConnected: Boolean(
            row.googleScope?.includes("https://www.googleapis.com/auth/calendar.events")
            && row.googleScope?.includes("https://www.googleapis.com/auth/calendar.freebusy")
          ),
        };
      })
      .sort((a, b) => {
        if (a.role === "owner") return -1;
        if (b.role === "owner") return 1;
        return (a.name || a.email || "").localeCompare(b.name || b.email || "", "de");
      });

    return Response.json({
      currentUser: {
        id: workspace.user.id,
        name: workspace.user.name,
        email: workspace.user.email,
        role: workspace.role,
        permissions: workspace.permissions,
      },
      members,
      meta: {
        roles: TEAM_ROLES.filter((role) => role !== "owner").map((role) => ({
          value: role,
          label: ROLE_LABELS[role],
          permissions: ROLE_DEFAULTS[role],
        })),
        permissions: TEAM_PERMISSIONS.map((permission) => ({
          value: permission,
          label: PERMISSION_LABELS[permission],
        })),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("manage_team");
    const input = createInput.parse(await request.json());
    const email = input.email.toLowerCase();
    const db = getDb();

    const [existingUser] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (existingUser) {
      const [existingMember] = await db
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .where(and(eq(workspaceMembers.workspaceId, workspace.workspaceId), eq(workspaceMembers.userId, existingUser.id)))
        .limit(1);
      if (existingMember) {
        return Response.json({ error: "Dieser Mitarbeiter ist bereits im Team." }, { status: 409 });
      }
    }

    const credentials = hashPassword(input.password);
    let user = existingUser;

    if (user) {
      [user] = await db
        .update(users)
        .set({
          name: input.name,
          passwordHash: credentials.hash,
          passwordSalt: credentials.salt,
          status: "active",
          updatedAt: new Date(),
        })
        .where(eq(users.id, user.id))
        .returning();
    } else {
      [user] = await db
        .insert(users)
        .values({
          name: input.name,
          email,
          passwordHash: credentials.hash,
          passwordSalt: credentials.salt,
          status: "active",
        })
        .returning();
    }

    if (!user) throw new Error("Mitarbeiter konnte nicht angelegt werden.");

    const role = normalizedRole(input.role);
    const permissions = normalizedPermissions(role, input.permissions);
    await db.insert(workspaceMembers).values({
      workspaceId: workspace.workspaceId,
      userId: user.id,
      role,
      permissions,
    });

    return Response.json({
      ok: true,
      member: {
        userId: user.id,
        name: user.name,
        email: user.email,
        status: user.status,
        role,
        permissions,
        leadCount: 0,
        openTaskCount: 0,
      },
    }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Bitte Name, E-Mail, Passwort und Rolle prüfen.", issues: error.issues }, { status: 400 });
    }
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const workspace = await requirePermission("manage_team");
    const input = updateInput.parse(await request.json());
    const db = getDb();

    const [membership] = await db
      .select()
      .from(workspaceMembers)
      .where(and(eq(workspaceMembers.workspaceId, workspace.workspaceId), eq(workspaceMembers.userId, input.userId)))
      .limit(1);
    if (!membership) return Response.json({ error: "Mitarbeiter nicht gefunden." }, { status: 404 });

    if (membership.role === "owner" && (input.role || input.status === "inactive")) {
      return Response.json({ error: "Der Workspace-Owner kann hier nicht deaktiviert oder umgestuft werden." }, { status: 400 });
    }
    if (input.userId === workspace.user.id && input.status === "inactive") {
      return Response.json({ error: "Du kannst deinen eigenen Zugang nicht deaktivieren." }, { status: 400 });
    }

    const role = input.role ? normalizedRole(input.role) : normalizedRole(membership.role);
    const permissions = input.permissions !== undefined
      ? normalizedPermissions(role, input.permissions)
      : input.role
        ? normalizedPermissions(role, null)
        : normalizedPermissions(role, membership.permissions);

    await db
      .update(workspaceMembers)
      .set({ role, permissions })
      .where(and(eq(workspaceMembers.workspaceId, workspace.workspaceId), eq(workspaceMembers.userId, input.userId)));

    const userUpdate: Partial<typeof users.$inferInsert> = { updatedAt: new Date() };
    if (input.name !== undefined) userUpdate.name = input.name;
    if (input.status !== undefined) userUpdate.status = input.status;
    if (input.password) {
      const credentials = hashPassword(input.password);
      userUpdate.passwordHash = credentials.hash;
      userUpdate.passwordSalt = credentials.salt;
    }
    const [user] = await db.update(users).set(userUpdate).where(eq(users.id, input.userId)).returning();

    return Response.json({ ok: true, user, role, permissions });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Änderungen konnten nicht gespeichert werden.", issues: error.issues }, { status: 400 });
    }
    return apiError(error);
  }
}
