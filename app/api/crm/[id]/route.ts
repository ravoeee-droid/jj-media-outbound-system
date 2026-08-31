import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, bookings, events, leads, outreach, tasks } from "@/db/schema";
import { apiError, requireWorkspace } from "@/lib/workspace";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { id } = await context.params;
    const db = getDb();
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.workspaceId, workspaceId)))
      .limit(1);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    const [activityRows, taskRows, outreachRows, eventRows, bookingRows] = await Promise.all([
      db.select().from(activities).where(eq(activities.leadId, id)).orderBy(desc(activities.createdAt)).limit(100),
      db.select().from(tasks).where(eq(tasks.leadId, id)).orderBy(desc(tasks.createdAt)).limit(50),
      db.select().from(outreach).where(eq(outreach.leadId, id)).orderBy(desc(outreach.createdAt)).limit(50),
      db.select().from(events).where(eq(events.leadId, id)).orderBy(desc(events.createdAt)).limit(100),
      db.select().from(bookings).where(eq(bookings.leadId, id)).orderBy(desc(bookings.createdAt)).limit(20),
    ]);
    return Response.json({
      lead,
      activities: activityRows,
      tasks: taskRows,
      outreach: outreachRows,
      events: eventRows,
      bookings: bookingRows,
    });
  } catch (error) {
    return apiError(error);
  }
}

const activityInput = z.object({
  type: z.enum(["note", "call", "email", "meeting", "objection"]),
  title: z.string().trim().min(2).max(200),
  detail: z.string().trim().max(10000).optional().default(""),
});

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await requireWorkspace();
    const { id } = await context.params;
    const input = activityInput.parse(await request.json());
    const [lead] = await getDb()
      .select({ id: leads.id })
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.workspaceId, workspace.workspaceId)))
      .limit(1);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    const [activity] = await getDb()
      .insert(activities)
      .values({
        workspaceId: workspace.workspaceId,
        leadId: id,
        userId: workspace.user.id,
        type: input.type,
        title: input.title,
        detail: input.detail,
      })
      .returning();
    await getDb()
      .update(leads)
      .set({
        lastActivityAt: new Date(),
        lastContactAt: ["call", "email", "meeting"].includes(input.type) ? new Date() : undefined,
        updatedAt: new Date(),
      })
      .where(eq(leads.id, id));
    return Response.json({ activity }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Aktivität ist unvollständig." }, { status: 400 });
    return apiError(error);
  }
}
