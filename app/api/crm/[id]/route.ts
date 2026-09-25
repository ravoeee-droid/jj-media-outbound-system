import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, bookings, leads, outreach, tasks } from "@/db/schema";
import { hasPermission } from "@/lib/team";
import { apiError, requireWorkspace } from "@/lib/workspace";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await requireWorkspace();
    if (!hasPermission(workspace.role, workspace.permissions, "view_own_leads") && !hasPermission(workspace.role, workspace.permissions, "view_all_leads")) {
      throw new Error("FORBIDDEN");
    }

    const { id } = await context.params;
    const db = getDb();
    const [lead] = await db
      .select({
        id: leads.id,
        ownerId: leads.ownerId,
        slug: leads.slug,
        company: leads.company,
        contact: leads.contact,
        email: leads.email,
        phone: leads.phone,
        instagramUrl: leads.instagramUrl,
        websiteUrl: leads.websiteUrl,
        city: leads.city,
        region: leads.region,
        ceo: leads.ceo,
        pipelineStage: leads.pipelineStage,
        researchStatus: leads.researchStatus,
        validationStatus: leads.validationStatus,
        analysisStatus: leads.analysisStatus,
        callStatus: leads.callStatus,
        emailStatus: leads.emailStatus,
        whatsappStatus: leads.whatsappStatus,
        videoStatus: leads.videoStatus,
        nextAction: leads.nextAction,
        nextActionAt: leads.nextActionAt,
        contactLocked: leads.contactLocked,
        contactLockReason: leads.contactLockReason,
        notes: leads.notes,
        objection: leads.objection,
        pitch: leads.pitch,
        recommendedOffer: leads.recommendedOffer,
        dealValue: leads.dealValue,
        probability: leads.probability,
        salesPriority: leads.salesPriority,
        websiteScore: leads.websiteScore,
        jobCount: leads.jobCount,
        jobTitles: leads.jobTitles,
        tags: leads.tags,
        summary: leads.summary,
        confidence: leads.confidence,
        scrollVideoUrl: leads.scrollVideoUrl,
        landingPath: leads.landingPath,
      })
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.workspaceId, workspace.workspaceId)))
      .limit(1);

    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    if (!hasPermission(workspace.role, workspace.permissions, "view_all_leads") && lead.ownerId !== workspace.user.id) {
      throw new Error("FORBIDDEN");
    }

    const [activityRows, taskRows, outreachRows, bookingRows] = await Promise.all([
      db
        .select({
          id: activities.id,
          type: activities.type,
          title: activities.title,
          detail: activities.detail,
          createdAt: activities.createdAt,
        })
        .from(activities)
        .where(eq(activities.leadId, id))
        .orderBy(desc(activities.createdAt))
        .limit(40),
      db
        .select({
          id: tasks.id,
          title: tasks.title,
          dueAt: tasks.dueAt,
          status: tasks.status,
          priority: tasks.priority,
          type: tasks.type,
          assigneeId: tasks.assigneeId,
        })
        .from(tasks)
        .where(eq(tasks.leadId, id))
        .orderBy(desc(tasks.updatedAt))
        .limit(20),
      db
        .select({
          id: outreach.id,
          channel: outreach.channel,
          step: outreach.step,
          subject: outreach.subject,
          status: outreach.status,
          scheduledAt: outreach.scheduledAt,
          sentAt: outreach.sentAt,
        })
        .from(outreach)
        .where(eq(outreach.leadId, id))
        .orderBy(desc(outreach.updatedAt))
        .limit(10),
      db
        .select({
          id: bookings.id,
          scheduledAt: bookings.scheduledAt,
          provider: bookings.provider,
          status: bookings.status,
          createdAt: bookings.createdAt,
        })
        .from(bookings)
        .where(eq(bookings.leadId, id))
        .orderBy(desc(bookings.createdAt))
        .limit(10),
    ]);

    return Response.json({
      lead,
      activities: activityRows,
      tasks: taskRows,
      outreach: outreachRows,
      bookings: bookingRows,
      permissions: {
        canManageLeads: hasPermission(workspace.role, workspace.permissions, "manage_leads"),
        canSendEmail: hasPermission(workspace.role, workspace.permissions, "send_email"),
        canUseWhatsapp: hasPermission(workspace.role, workspace.permissions, "use_whatsapp"),
        canGenerateVideo: hasPermission(workspace.role, workspace.permissions, "generate_video"),
        canBookMeetings: hasPermission(workspace.role, workspace.permissions, "book_meetings"),
      },
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
    if (!hasPermission(workspace.role, workspace.permissions, "manage_leads")) throw new Error("FORBIDDEN");
    const { id } = await context.params;
    const input = activityInput.parse(await request.json());
    const [lead] = await getDb()
      .select({ id: leads.id, ownerId: leads.ownerId })
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.workspaceId, workspace.workspaceId)))
      .limit(1);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    if (!hasPermission(workspace.role, workspace.permissions, "view_all_leads") && lead.ownerId !== workspace.user.id) {
      throw new Error("FORBIDDEN");
    }

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
