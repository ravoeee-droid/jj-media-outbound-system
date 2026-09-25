import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, bookings, leads, outreach, tasks, whatsappQueue, whatsappThreads } from "@/db/schema";
import { cancelPendingEmailFollowups } from "@/lib/outreach-lifecycle";

type Context = {
  workspaceId: string;
  userId: string;
  leadId: string;
};

async function getLead({ workspaceId, leadId }: Pick<Context, "workspaceId" | "leadId">) {
  const [lead] = await getDb()
    .select()
    .from(leads)
    .where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId)))
    .limit(1);
  if (!lead) throw new Error("Lead nicht gefunden.");
  return lead;
}

function readinessScore(lead: Awaited<ReturnType<typeof getLead>>) {
  let score = 20;
  if (lead.phone) score += 18;
  if (lead.email) score += 14;
  if (lead.contact || lead.ceo) score += 12;
  if (lead.instagramUrl) score += 10;
  if (lead.websiteUrl) score += 10;
  if (lead.summary) score += 8;
  if (lead.confidence >= 70) score += 8;
  return Math.min(100, Math.max(0, score));
}

export async function validateLead(context: Context) {
  const db = getDb();
  const lead = await getLead(context);
  const hasDirectContact = Boolean(lead.phone || lead.email);
  const validationStatus = hasDirectContact ? "validated" : "needs_review";
  const nextAction = hasDirectContact ? "analyze" : "enrich";

  const [updated] = await db.update(leads).set({
    validationStatus,
    nextAction,
    updatedAt: new Date(),
  }).where(and(eq(leads.workspaceId, context.workspaceId), eq(leads.id, context.leadId))).returning();

  await db.insert(activities).values({
    workspaceId: context.workspaceId,
    leadId: context.leadId,
    userId: context.userId,
    type: "validated_manual",
    title: hasDirectContact ? "Lead validiert" : "Validierung braucht Nacharbeit",
    detail: hasDirectContact ? "Mindestens ein direkter Kontaktweg ist vorhanden." : "E-Mail oder Telefonnummer fehlen noch.",
  });

  return updated;
}

export async function analyzeLead(context: Context) {
  const db = getDb();
  const lead = await getLead(context);
  const score = readinessScore(lead);
  const contactReady = Boolean(lead.phone || lead.email);
  const nextAction = contactReady ? "call" : "enrich";
  const pipelineStage = contactReady && lead.pipelineStage === "new" ? "contact_ready" : lead.pipelineStage;

  const [updated] = await db.update(leads).set({
    analysisStatus: "ready",
    salesPriority: Math.max(lead.salesPriority, score),
    pipelineStage,
    nextAction,
    updatedAt: new Date(),
  }).where(and(eq(leads.workspaceId, context.workspaceId), eq(leads.id, context.leadId))).returning();

  await db.insert(activities).values({
    workspaceId: context.workspaceId,
    leadId: context.leadId,
    userId: context.userId,
    type: "analyzed_manual",
    title: "Lead-Readiness analysiert",
    detail: contactReady
      ? `Kontaktbereit · Priorität ${Math.max(lead.salesPriority, score)}/100`
      : "Noch nicht kontaktbereit · weitere Recherche empfohlen.",
  });

  return updated;
}

export async function scheduleCallback(context: Context, dueAt: Date) {
  const db = getDb();
  const lead = await getLead(context);
  if (lead.contactLocked) throw new Error("Dieser Lead ist für weiteren Kontakt gesperrt.");

  const title = `Rückruf: ${lead.company}`;
  const [existing] = await db.select().from(tasks)
    .where(and(eq(tasks.workspaceId, context.workspaceId), eq(tasks.leadId, lead.id), eq(tasks.type, "callback"), eq(tasks.status, "open")))
    .limit(1);

  const task = existing
    ? (await db.update(tasks).set({
        assigneeId: lead.ownerId || context.userId,
        title,
        dueAt,
        priority: "high",
        updatedAt: new Date(),
      }).where(eq(tasks.id, existing.id)).returning())[0]
    : (await db.insert(tasks).values({
        workspaceId: context.workspaceId,
        leadId: lead.id,
        assigneeId: lead.ownerId || context.userId,
        title,
        dueAt,
        status: "open",
        priority: "high",
        type: "callback",
      }).returning())[0];

  const [updated] = await db.update(leads).set({
    callStatus: "callback",
    nextAction: "callback",
    nextActionAt: dueAt,
    nextFollowUpAt: dueAt,
    updatedAt: new Date(),
  }).where(eq(leads.id, lead.id)).returning();

  await db.insert(activities).values({
    workspaceId: context.workspaceId,
    leadId: lead.id,
    userId: context.userId,
    type: "callback_scheduled",
    title: "Rückruf geplant",
    detail: dueAt.toISOString(),
  });

  return { lead: updated, task };
}

export async function scheduleManualMeeting(context: Context, scheduledAt: Date) {
  const db = getDb();
  const lead = await getLead(context);
  if (lead.contactLocked) throw new Error("Dieser Lead ist für weiteren Kontakt gesperrt.");

  const [booking] = await db.insert(bookings).values({
    leadId: lead.id,
    scheduledAt,
    provider: "manual_crm",
    status: "requested",
  }).returning();

  const [updated] = await db.update(leads).set({
    pipelineStage: "call_booked",
    callStatus: "completed",
    nextAction: "meeting",
    nextActionAt: scheduledAt,
    probability: Math.max(lead.probability, 60),
    lastActivityAt: new Date(),
    updatedAt: new Date(),
  }).where(eq(leads.id, lead.id)).returning();

  await Promise.all([
    db.insert(activities).values({
      workspaceId: context.workspaceId,
      leadId: lead.id,
      userId: context.userId,
      type: "meeting_scheduled",
      title: "Termin manuell eingetragen",
      detail: scheduledAt.toISOString(),
    }),
    db.update(tasks).set({ status: "done", updatedAt: new Date() })
      .where(and(
        eq(tasks.workspaceId, context.workspaceId),
        eq(tasks.leadId, lead.id),
        eq(tasks.type, "callback"),
        eq(tasks.status, "open"),
      )),
  ]);

  await cancelPendingEmailFollowups({
    workspaceId: context.workspaceId,
    leadId: lead.id,
    userId: context.userId,
    reason: "Termin wurde im CRM eingetragen.",
  });
  return { lead: updated, booking };
}

export async function markNoInterest(context: Context) {
  const db = getDb();
  const lead = await getLead(context);
  const [updated] = await db.update(leads).set({
    pipelineStage: "lost",
    contactLocked: true,
    contactLockReason: "Kein Interesse",
    callStatus: "completed",
    emailStatus: "stopped",
    whatsappStatus: "stopped",
    nextAction: "none",
    nextActionAt: null,
    updatedAt: new Date(),
  }).where(eq(leads.id, lead.id)).returning();

  const [whatsappThread] = await db
    .select({ id: whatsappThreads.id })
    .from(whatsappThreads)
    .where(and(eq(whatsappThreads.workspaceId, context.workspaceId), eq(whatsappThreads.leadId, lead.id)))
    .limit(1);

  await Promise.all([
    db.update(tasks).set({ status: "dismissed", updatedAt: new Date() })
      .where(and(eq(tasks.workspaceId, context.workspaceId), eq(tasks.leadId, lead.id), eq(tasks.status, "open"))),
    db.update(outreach).set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(outreach.workspaceId, context.workspaceId), eq(outreach.leadId, lead.id), eq(outreach.status, "scheduled"))),
    db.update(whatsappThreads).set({ status: "closed", updatedAt: new Date() })
      .where(and(eq(whatsappThreads.workspaceId, context.workspaceId), eq(whatsappThreads.leadId, lead.id))),
  ]);
  if (whatsappThread) {
    await db.update(whatsappQueue).set({ status: "cancelled", updatedAt: new Date() })
      .where(and(eq(whatsappQueue.workspaceId, context.workspaceId), eq(whatsappQueue.threadId, whatsappThread.id), eq(whatsappQueue.status, "queued")));
  }

  await cancelPendingEmailFollowups({
    workspaceId: context.workspaceId,
    leadId: lead.id,
    userId: context.userId,
    reason: "Kein Interesse / weiterer Kontakt gesperrt.",
  });

  await db.insert(activities).values({
    workspaceId: context.workspaceId,
    leadId: lead.id,
    userId: context.userId,
    type: "no_interest",
    title: "Kein Interesse",
    detail: "Weiterer Kontakt wurde gesperrt.",
  });

  return updated;
}
