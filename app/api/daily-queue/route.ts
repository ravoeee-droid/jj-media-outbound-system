import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { leads, users, workspaceMembers } from "@/db/schema";
import { assertLeadInDailyQueue, ensureCallStarted, getDailyQueue, recordCallResult, recordQueueOutcome } from "@/lib/daily-queue";
import { markNoInterest, scheduleCallback, scheduleManualMeeting } from "@/lib/lead-workflow";
import { hasPermission } from "@/lib/team";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("call_started"), leadId: z.string().uuid() }),
  z.object({ action: z.literal("no_answer"), leadId: z.string().uuid() }),
  z.object({ action: z.literal("info_requested"), leadId: z.string().uuid(), email: z.string().trim().email().max(320).optional() }),
  z.object({ action: z.literal("whatsapp_requested"), leadId: z.string().uuid() }),
  z.object({ action: z.literal("callback"), leadId: z.string().uuid(), dueAt: z.string().datetime() }),
  z.object({ action: z.literal("meeting"), leadId: z.string().uuid(), scheduledAt: z.string().datetime() }),
  z.object({ action: z.literal("no_interest"), leadId: z.string().uuid() }),
]);

type Workspace = Awaited<ReturnType<typeof requirePermission>>;

async function resolveOwner(workspace: Workspace, requested: string | null) {
  const canViewAll = hasPermission(workspace.role, workspace.permissions, "view_all_leads");
  if (!requested || requested === "mine" || !canViewAll) return workspace.user.id;

  const parsed = z.string().uuid().safeParse(requested);
  if (!parsed.success) throw new Error("FORBIDDEN");

  const [member] = await getDb()
    .select({ userId: workspaceMembers.userId })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(
      eq(workspaceMembers.workspaceId, workspace.workspaceId),
      eq(workspaceMembers.userId, parsed.data),
      eq(users.status, "active"),
    ))
    .limit(1);

  if (!member) throw new Error("FORBIDDEN");
  return parsed.data;
}

async function activeMembers(workspaceId: string) {
  return getDb()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.status, "active")));
}

async function assertLeadAccess(workspace: Workspace, leadId: string) {
  const [lead] = await getDb()
    .select({ ownerId: leads.ownerId })
    .from(leads)
    .where(and(eq(leads.workspaceId, workspace.workspaceId), eq(leads.id, leadId)))
    .limit(1);

  if (!lead) throw new Error("Lead nicht gefunden.");
  const canViewAll = hasPermission(workspace.role, workspace.permissions, "view_all_leads");
  if (!canViewAll && lead.ownerId !== workspace.user.id) throw new Error("FORBIDDEN");
}

export async function GET(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const url = new URL(request.url);
    const ownerId = await resolveOwner(workspace, url.searchParams.get("owner"));
    const canViewAll = hasPermission(workspace.role, workspace.permissions, "view_all_leads");

    const [queue, members] = await Promise.all([
      getDailyQueue(workspace.workspaceId, ownerId),
      canViewAll ? activeMembers(workspace.workspaceId) : Promise.resolve([]),
    ]);

    return Response.json({
      ...queue,
      ownerId,
      currentUser: {
        id: workspace.user.id,
        name: workspace.user.name,
        email: workspace.user.email,
      },
      permissions: {
        canViewAll,
        canSendEmail: hasPermission(workspace.role, workspace.permissions, "send_email"),
        canUseWhatsapp: hasPermission(workspace.role, workspace.permissions, "use_whatsapp"),
        canBookMeetings: hasPermission(workspace.role, workspace.permissions, "book_meetings"),
      },
      members: members.map((member) => ({
        userId: member.userId,
        name: member.name || member.email || "Mitarbeiter",
        role: member.role,
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const input = actionInput.parse(await request.json());
    await assertLeadAccess(workspace, input.leadId);
    await assertLeadInDailyQueue(workspace.workspaceId, input.leadId);
    const base = { workspaceId: workspace.workspaceId, userId: workspace.user.id, leadId: input.leadId };

    if (input.action === "call_started") {
      return Response.json({ ok: true, ...(await ensureCallStarted(base)) });
    }

    if (input.action === "info_requested" && !hasPermission(workspace.role, workspace.permissions, "send_email")) {
      throw new Error("FORBIDDEN");
    }
    if (input.action === "whatsapp_requested" && !hasPermission(workspace.role, workspace.permissions, "use_whatsapp")) {
      throw new Error("FORBIDDEN");
    }
    if (input.action === "no_answer" || input.action === "whatsapp_requested") {
      const lead = await recordQueueOutcome(base, input.action);
      await recordCallResult(base, input.action);
      return Response.json({ lead });
    }
    if (input.action === "info_requested") {
      const lead = await recordQueueOutcome(base, input.action, { email: input.email });
      await recordCallResult(base, input.action);
      return Response.json({ lead });
    }

    if (input.action === "callback") {
      const dueAt = new Date(input.dueAt);
      if (dueAt.getTime() <= Date.now() - 60_000) {
        return Response.json({ error: "Der Rückruf muss in der Zukunft liegen." }, { status: 400 });
      }
      const result = await scheduleCallback(base, dueAt);
      await recordCallResult(base, "callback");
      return Response.json(result);
    }

    if (input.action === "meeting") {
      if (!hasPermission(workspace.role, workspace.permissions, "book_meetings")) throw new Error("FORBIDDEN");
      const scheduledAt = new Date(input.scheduledAt);
      if (scheduledAt.getTime() <= Date.now() - 60_000) {
        return Response.json({ error: "Der Termin muss in der Zukunft liegen." }, { status: 400 });
      }
      const result = await scheduleManualMeeting(base, scheduledAt);
      await recordCallResult(base, "meeting");
      return Response.json(result);
    }

    const lead = await markNoInterest(base);
    await recordCallResult(base, "no_interest");
    return Response.json({ lead });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Call-Ergebnis ist unvollständig.", issues: error.issues }, { status: 400 });
    }
    if (error instanceof Error && (
      error.message.includes("nicht mehr in der aktuellen Tages-Queue")
      || error.message.includes("gehört aktuell zu keiner Tages-Queue")
    )) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return apiError(error);
  }
}
