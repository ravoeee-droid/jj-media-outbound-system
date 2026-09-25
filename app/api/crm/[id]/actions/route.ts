import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { leads } from "@/db/schema";
import { analyzeLead, markNoInterest, scheduleCallback, scheduleManualMeeting, validateLead } from "@/lib/lead-workflow";
import { hasPermission } from "@/lib/team";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("validate") }),
  z.object({ action: z.literal("analyze") }),
  z.object({ action: z.literal("callback"), dueAt: z.string().datetime() }),
  z.object({ action: z.literal("meeting"), scheduledAt: z.string().datetime() }),
  z.object({ action: z.literal("no_interest") }),
]);

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await requirePermission("manage_leads");
    const { id } = await context.params;
    const input = inputSchema.parse(await request.json());
    const db = getDb();

    const [lead] = await db
      .select({ id: leads.id, ownerId: leads.ownerId })
      .from(leads)
      .where(and(eq(leads.workspaceId, workspace.workspaceId), eq(leads.id, id)))
      .limit(1);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });

    if (!hasPermission(workspace.role, workspace.permissions, "view_all_leads") && lead.ownerId !== workspace.user.id) {
      throw new Error("FORBIDDEN");
    }

    const base = { workspaceId: workspace.workspaceId, userId: workspace.user.id, leadId: id };

    if (input.action === "validate") {
      return Response.json({ lead: await validateLead(base) });
    }
    if (input.action === "analyze") {
      return Response.json({ lead: await analyzeLead(base) });
    }
    if (input.action === "callback") {
      const dueAt = new Date(input.dueAt);
      if (dueAt.getTime() <= Date.now() - 60_000) {
        return Response.json({ error: "Der Rückruf muss in der Zukunft liegen." }, { status: 400 });
      }
      return Response.json(await scheduleCallback(base, dueAt));
    }
    if (input.action === "meeting") {
      if (!hasPermission(workspace.role, workspace.permissions, "book_meetings")) throw new Error("FORBIDDEN");
      const scheduledAt = new Date(input.scheduledAt);
      if (scheduledAt.getTime() <= Date.now() - 60_000) {
        return Response.json({ error: "Der Termin muss in der Zukunft liegen." }, { status: 400 });
      }
      return Response.json(await scheduleManualMeeting(base, scheduledAt));
    }
    return Response.json({ lead: await markNoInterest(base) });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Aktion ist unvollständig.", issues: error.issues }, { status: 400 });
    return apiError(error);
  }
}
