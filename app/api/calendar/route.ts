import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { leads, users } from "@/db/schema";
import {
  bookMeetingSlot,
  calendarProfileSchema,
  getCalendarOwner,
  getCalendarProfile,
  listMeetingSlots,
  saveCalendarProfile,
} from "@/lib/calendar-meetings";
import { calendarConnected } from "@/lib/whatsapp/calendar";
import { hasPermission } from "@/lib/team";
import { assertLeadInDailyQueue, recordCallResult } from "@/lib/daily-queue";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("slots"), leadId: z.string().uuid() }),
  z.object({ action: z.literal("book"), leadId: z.string().uuid(), start: z.string().datetime(), source: z.enum(["crm", "daily_queue"]).optional().default("crm") }),
]);

async function resolveLeadCalendar(workspace: Awaited<ReturnType<typeof requirePermission>>, leadId: string) {
  const [lead] = await getDb()
    .select({
      id: leads.id,
      ownerId: leads.ownerId,
      company: leads.company,
      contactLocked: leads.contactLocked,
      pipelineStage: leads.pipelineStage,
    })
    .from(leads)
    .where(and(eq(leads.workspaceId, workspace.workspaceId), eq(leads.id, leadId)))
    .limit(1);

  if (!lead) throw new Error("Lead nicht gefunden.");
  const canViewAll = hasPermission(workspace.role, workspace.permissions, "view_all_leads");
  if (!canViewAll && lead.ownerId !== workspace.user.id) throw new Error("FORBIDDEN");
  if (lead.contactLocked || lead.pipelineStage === "lost") throw new Error("Dieser Lead ist für weiteren Kontakt gesperrt.");

  const calendarUserId = lead.ownerId || workspace.user.id;
  const owner = await getCalendarOwner(calendarUserId);
  if (!owner || owner.status !== "active") throw new Error("Der zuständige Mitarbeiter ist nicht aktiv.");
  return { lead, calendarUserId, owner };
}

export async function GET() {
  try {
    const workspace = await requirePermission("book_meetings");
    const [profile, connected] = await Promise.all([
      getCalendarProfile(workspace.workspaceId, workspace.user.id),
      calendarConnected(workspace.user.id).catch(() => false),
    ]);
    return Response.json({
      connected,
      profile,
      user: {
        id: workspace.user.id,
        name: workspace.user.name,
        email: workspace.user.email,
      },
      connectUrl: "/admin/api/gmail/connect?calendar=1&destination=integrations",
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const workspace = await requirePermission("book_meetings");
    const input = calendarProfileSchema.parse(await request.json());
    const profile = await saveCalendarProfile(workspace.workspaceId, workspace.user.id, input);
    return Response.json({ ok: true, profile });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Kalenderregeln sind ungültig.", issues: error.issues }, { status: 400 });
    }
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("book_meetings");
    const input = actionSchema.parse(await request.json());
    const target = await resolveLeadCalendar(workspace, input.leadId);

    if (input.action === "slots") {
      const result = await listMeetingSlots({
        workspaceId: workspace.workspaceId,
        userId: target.calendarUserId,
        limit: 9,
        days: 14,
      });
      return Response.json({
        ...result,
        calendarUserId: target.calendarUserId,
        owner: {
          id: target.owner.id,
          name: target.owner.name,
          email: target.owner.email,
        },
        canConnectSelf: target.calendarUserId === workspace.user.id,
        connectUrl: target.calendarUserId === workspace.user.id
          ? "/admin/api/gmail/connect?calendar=1&destination=queue"
          : "",
      }, { headers: { "cache-control": "no-store" } });
    }

    if (input.source === "daily_queue") {
      await assertLeadInDailyQueue(workspace.workspaceId, target.lead.id);
    }

    const booking = await bookMeetingSlot({
      workspaceId: workspace.workspaceId,
      calendarUserId: target.calendarUserId,
      actorUserId: workspace.user.id,
      leadId: target.lead.id,
      start: input.start,
    });
    if (input.source === "daily_queue") {
      await recordCallResult({
        workspaceId: workspace.workspaceId,
        userId: workspace.user.id,
        leadId: target.lead.id,
      }, "meeting");
    }
    return Response.json({
      ok: true,
      booking,
      owner: {
        id: target.owner.id,
        name: target.owner.name,
        email: target.owner.email,
      },
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Kalenderanfrage ist unvollständig.", issues: error.issues }, { status: 400 });
    }
    if (error instanceof Error && /inzwischen belegt|außerhalb|zu kurzfristig/.test(error.message)) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    return apiError(error);
  }
}
