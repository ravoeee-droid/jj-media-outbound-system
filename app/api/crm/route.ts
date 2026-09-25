import { and, desc, eq, ilike, isNull, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, leads, users, workspaceMembers } from "@/db/schema";
import { hasPermission } from "@/lib/team";
import { apiError, requireWorkspace } from "@/lib/workspace";

const allowedStages = ["new", "qualified", "contact_ready", "contacted", "replied", "call_booked", "won", "lost"] as const;
const scopeSchema = z.string().max(80).default("mine");
const listLimit = 50;

type Cursor = { updatedAt: string; id: string };

function encodeCursor(value: Cursor) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function decodeCursor(value: string | null): Cursor | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as Cursor;
    if (!parsed.updatedAt || !parsed.id || Number.isNaN(Date.parse(parsed.updatedAt))) return null;
    return parsed;
  } catch {
    return null;
  }
}

export async function GET(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const db = getDb();
    const url = new URL(request.url);
    const requestedScope = scopeSchema.parse(url.searchParams.get("scope") || "mine");
    const query = (url.searchParams.get("q") || "").trim().slice(0, 120);
    const cursor = decodeCursor(url.searchParams.get("cursor"));

    const canViewOwn = hasPermission(workspace.role, workspace.permissions, "view_own_leads");
    const canViewAll = hasPermission(workspace.role, workspace.permissions, "view_all_leads");
    if (!canViewOwn && !canViewAll) throw new Error("FORBIDDEN");
    const scope = canViewAll ? requestedScope : "mine";

    const baseConditions = [eq(leads.workspaceId, workspace.workspaceId)];
    if (scope === "mine") {
      baseConditions.push(eq(leads.ownerId, workspace.user.id));
    } else if (scope === "unassigned") {
      baseConditions.push(isNull(leads.ownerId));
    } else if (scope !== "all") {
      const scopedUser = z.string().uuid().safeParse(scope);
      if (!scopedUser.success) return Response.json({ error: "Ungültiger CRM-Bereich." }, { status: 400 });
      baseConditions.push(eq(leads.ownerId, scopedUser.data));
    }

    if (query.length >= 2) {
      const pattern = `%${query.replaceAll("%", "\\%").replaceAll("_", "\\_")}%`;
      baseConditions.push(or(
        ilike(leads.company, pattern),
        ilike(leads.contact, pattern),
        ilike(leads.email, pattern),
        ilike(leads.phone, pattern),
        ilike(leads.city, pattern),
      )!);
    }

    if (cursor) {
      const cursorDate = new Date(cursor.updatedAt);
      baseConditions.push(or(
        lt(leads.updatedAt, cursorDate),
        and(eq(leads.updatedAt, cursorDate), lt(leads.id, cursor.id)),
      )!);
    }

    const listWhere = and(...baseConditions)!;

    const memberPromise = db
      .select({
        userId: users.id,
        name: users.name,
        email: users.email,
        status: users.status,
        role: workspaceMembers.role,
      })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .where(eq(workspaceMembers.workspaceId, workspace.workspaceId));

    const countsPromise = db
      .select({
        ownerId: leads.ownerId,
        count: sql<number>`count(*)::int`,
      })
      .from(leads)
      .where(eq(leads.workspaceId, workspace.workspaceId))
      .groupBy(leads.ownerId);

    const rowsPromise = db
      .select({
        id: leads.id,
        company: leads.company,
        contact: leads.contact,
        email: leads.email,
        phone: leads.phone,
        instagramUrl: leads.instagramUrl,
        websiteUrl: leads.websiteUrl,
        city: leads.city,
        region: leads.region,
        pipelineStage: leads.pipelineStage,
        researchStatus: leads.researchStatus,
        validationStatus: leads.validationStatus,
        callStatus: leads.callStatus,
        emailStatus: leads.emailStatus,
        whatsappStatus: leads.whatsappStatus,
        nextAction: leads.nextAction,
        nextActionAt: leads.nextActionAt,
        contactLocked: leads.contactLocked,
        videoStatus: leads.videoStatus,
        watchPercent: leads.watchPercent,
        salesPriority: leads.salesPriority,
        ownerId: leads.ownerId,
        ownerName: users.name,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .leftJoin(users, eq(users.id, leads.ownerId))
      .where(listWhere)
      .orderBy(desc(leads.updatedAt), desc(leads.id))
      .limit(listLimit + 1);

    const [memberRows, countRows, rawRows] = await Promise.all([memberPromise, countsPromise, rowsPromise]);

    const hasMore = rawRows.length > listLimit;
    const rows = hasMore ? rawRows.slice(0, listLimit) : rawRows;
    const last = rows.at(-1);
    const counts = new Map(countRows.map((row) => [row.ownerId ?? "unassigned", Number(row.count || 0)]));
    const total = countRows.reduce((sum, row) => sum + Number(row.count || 0), 0);

    return Response.json({
      leads: rows,
      page: {
        hasMore,
        nextCursor: hasMore && last ? encodeCursor({ updatedAt: last.updatedAt.toISOString(), id: last.id }) : null,
        limit: listLimit,
      },
      scope,
      query,
      currentUser: {
        id: workspace.user.id,
        name: workspace.user.name,
        email: workspace.user.email,
        role: workspace.role,
      },
      permissions: {
        canViewAll,
        canManageLeads: hasPermission(workspace.role, workspace.permissions, "manage_leads"),
      },
      tabs: {
        total,
        unassigned: counts.get("unassigned") ?? 0,
        members: memberRows
          .filter((member) => member.status === "active")
          .map((member) => ({
            userId: member.userId,
            name: member.name || member.email || "Mitarbeiter",
            role: member.role,
            count: counts.get(member.userId) ?? 0,
          })),
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige CRM-Abfrage." }, { status: 400 });
    return apiError(error);
  }
}

const updateInput = z.object({
  id: z.string().uuid(),
  ownerId: z.string().uuid().nullable().optional(),
  pipelineStage: z.enum(allowedStages).optional(),
  contact: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(80).optional(),
  notes: z.string().max(20000).optional(),
  objection: z.string().max(4000).optional(),
  pitch: z.string().max(10000).optional(),
  recommendedOffer: z.string().max(1000).optional(),
  dealValue: z.number().int().min(0).max(10000000).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
});

export async function PUT(request: Request) {
  try {
    const workspace = await requireWorkspace();
    if (!hasPermission(workspace.role, workspace.permissions, "manage_leads")) throw new Error("FORBIDDEN");

    const input = updateInput.parse(await request.json());
    const db = getDb();
    const [existing] = await db
      .select({ id: leads.id, ownerId: leads.ownerId })
      .from(leads)
      .where(and(eq(leads.id, input.id), eq(leads.workspaceId, workspace.workspaceId)))
      .limit(1);
    if (!existing) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });

    const canViewAll = hasPermission(workspace.role, workspace.permissions, "view_all_leads");
    if (!canViewAll && existing.ownerId !== workspace.user.id) throw new Error("FORBIDDEN");

    if (input.ownerId !== undefined) {
      if (!canViewAll) throw new Error("FORBIDDEN");
      if (input.ownerId) {
        const [member] = await db
          .select({ userId: workspaceMembers.userId })
          .from(workspaceMembers)
          .where(and(eq(workspaceMembers.workspaceId, workspace.workspaceId), eq(workspaceMembers.userId, input.ownerId)))
          .limit(1);
        if (!member) return Response.json({ error: "Dieser Mitarbeiter gehört nicht zum Workspace." }, { status: 400 });
      }
    }

    const updates: Partial<typeof leads.$inferInsert> = {
      updatedAt: new Date(),
      ...(input.ownerId !== undefined ? { ownerId: input.ownerId, assignedAt: new Date() } : {}),
      ...(input.pipelineStage ? { pipelineStage: input.pipelineStage } : {}),
      ...(input.contact !== undefined ? { contact: input.contact.trim() } : {}),
      ...(input.email !== undefined ? { email: input.email.trim() } : {}),
      ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.objection !== undefined ? { objection: input.objection } : {}),
      ...(input.pitch !== undefined ? { pitch: input.pitch } : {}),
      ...(input.recommendedOffer !== undefined ? { recommendedOffer: input.recommendedOffer } : {}),
      ...(input.dealValue !== undefined ? { dealValue: input.dealValue } : {}),
      ...(input.probability !== undefined ? { probability: input.probability } : {}),
      ...(input.nextFollowUpAt !== undefined ? { nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null } : {}),
    };

    const [lead] = await db
      .update(leads)
      .set(updates)
      .where(and(eq(leads.id, input.id), eq(leads.workspaceId, workspace.workspaceId)))
      .returning();
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });

    const activityRows: Array<typeof activities.$inferInsert> = [];
    if (input.pipelineStage) activityRows.push({
      workspaceId: workspace.workspaceId,
      leadId: lead.id,
      userId: workspace.user.id,
      type: "stage_changed",
      title: `Pipeline: ${input.pipelineStage}`,
      detail: "Status im CRM geändert.",
    });
    if (input.ownerId !== undefined && input.ownerId !== existing.ownerId) activityRows.push({
      workspaceId: workspace.workspaceId,
      leadId: lead.id,
      userId: workspace.user.id,
      type: "owner_changed",
      title: input.ownerId ? "Lead neu zugewiesen" : "Lead auf unzugeordnet gesetzt",
      detail: "",
    });
    if (activityRows.length) await db.insert(activities).values(activityRows);

    return Response.json({ lead });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige CRM-Daten.", issues: error.issues }, { status: 400 });
    return apiError(error);
  }
}
