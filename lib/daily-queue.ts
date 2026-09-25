import { and, asc, desc, eq, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads } from "@/db/schema";

export type QueueOutcome = "no_answer" | "info_requested" | "whatsapp_requested";

type QueueContext = {
  workspaceId: string;
  userId: string;
  leadId: string;
};

const berlinDayStartSql = sql`(date_trunc('day', now() AT TIME ZONE 'Europe/Berlin') AT TIME ZONE 'Europe/Berlin')`;

function queueEligibility(workspaceId: string, ownerId: string) {
  const noAnswerToday = sql`not exists (
    select 1
    from ${activities} queue_activity
    where queue_activity.lead_id = ${leads.id}
      and queue_activity.type = 'call_no_answer'
      and queue_activity.created_at >= ${berlinDayStartSql}
  )`;

  return and(
    eq(leads.workspaceId, workspaceId),
    eq(leads.ownerId, ownerId),
    eq(leads.contactLocked, false),
    sql`${leads.phone} <> ''`,
    sql`${leads.pipelineStage} not in ('won', 'lost')`,
    or(
      and(
        eq(leads.nextAction, "callback"),
        lte(leads.nextActionAt, new Date()),
      ),
      and(
        or(eq(leads.nextAction, "call"), eq(leads.nextAction, "retry_call")),
        noAnswerToday,
      ),
    ),
  )!;
}

export async function getDailyQueue(workspaceId: string, ownerId: string, limit = 40) {
  const db = getDb();
  const where = queueEligibility(workspaceId, ownerId);

  const rowsPromise = db
    .select({
      id: leads.id,
      company: leads.company,
      contact: leads.contact,
      ceo: leads.ceo,
      phone: leads.phone,
      email: leads.email,
      instagramUrl: leads.instagramUrl,
      websiteUrl: leads.websiteUrl,
      city: leads.city,
      region: leads.region,
      summary: leads.summary,
      pitch: leads.pitch,
      recommendedOffer: leads.recommendedOffer,
      notes: leads.notes,
      pipelineStage: leads.pipelineStage,
      callStatus: leads.callStatus,
      emailStatus: leads.emailStatus,
      whatsappStatus: leads.whatsappStatus,
      nextAction: leads.nextAction,
      nextActionAt: leads.nextActionAt,
      salesPriority: leads.salesPriority,
      confidence: leads.confidence,
      ownerId: leads.ownerId,
      createdAt: leads.createdAt,
    })
    .from(leads)
    .where(where)
    .orderBy(
      asc(sql`case when ${leads.nextAction} = 'callback' then 0 else 1 end`),
      asc(sql`case when ${leads.nextAction} = 'callback' then ${leads.nextActionAt} else null end`),
      desc(leads.salesPriority),
      asc(leads.createdAt),
    )
    .limit(Math.max(1, Math.min(limit, 60)));

  const statsPromise = db
    .select({
      total: sql<number>`count(*)::int`,
      callbacks: sql<number>`count(*) filter (where ${leads.nextAction} = 'callback')::int`,
      highPriority: sql<number>`count(*) filter (where ${leads.salesPriority} >= 75)::int`,
    })
    .from(leads)
    .where(where);

  const [rows, statsRows] = await Promise.all([rowsPromise, statsPromise]);
  const stats = statsRows[0] ?? { total: 0, callbacks: 0, highPriority: 0 };

  return {
    leads: rows,
    stats: {
      total: Number(stats.total || 0),
      callbacks: Number(stats.callbacks || 0),
      highPriority: Number(stats.highPriority || 0),
    },
  };
}

async function getLead(context: QueueContext) {
  const [lead] = await getDb()
    .select({
      id: leads.id,
      ownerId: leads.ownerId,
      company: leads.company,
      contactLocked: leads.contactLocked,
      pipelineStage: leads.pipelineStage,
    })
    .from(leads)
    .where(and(eq(leads.workspaceId, context.workspaceId), eq(leads.id, context.leadId)))
    .limit(1);

  if (!lead) throw new Error("Lead nicht gefunden.");
  if (lead.contactLocked || lead.pipelineStage === "lost") throw new Error("Dieser Lead ist für weiteren Kontakt gesperrt.");
  return lead;
}

export async function recordQueueOutcome(context: QueueContext, outcome: QueueOutcome) {
  const db = getDb();
  const lead = await getLead(context);
  const now = new Date();

  const values: Partial<typeof leads.$inferInsert> = {
    lastActivityAt: now,
    updatedAt: now,
  };
  let activity: typeof activities.$inferInsert;

  if (outcome === "no_answer") {
    Object.assign(values, {
      callStatus: "attempted",
      nextAction: "call",
      nextActionAt: null,
    });
    activity = {
      workspaceId: context.workspaceId,
      leadId: lead.id,
      userId: context.userId,
      type: "call_no_answer",
      title: "Nicht erreicht",
      detail: "Heute aus der Tages-Queue genommen; erscheint am nächsten Arbeitstag erneut.",
    };
  } else if (outcome === "info_requested") {
    Object.assign(values, {
      pipelineStage: "contacted",
      callStatus: "connected",
      emailStatus: "ready",
      nextAction: "send_info",
      nextActionAt: null,
      lastContactAt: now,
    });
    activity = {
      workspaceId: context.workspaceId,
      leadId: lead.id,
      userId: context.userId,
      type: "call_info_requested",
      title: "Info gewünscht",
      detail: "Nächster Schritt: persönliche Info-Mail vorbereiten und senden.",
    };
  } else {
    Object.assign(values, {
      pipelineStage: "contacted",
      callStatus: "connected",
      whatsappStatus: "ready",
      nextAction: "whatsapp",
      nextActionAt: null,
      lastContactAt: now,
    });
    activity = {
      workspaceId: context.workspaceId,
      leadId: lead.id,
      userId: context.userId,
      type: "call_whatsapp_requested",
      title: "WhatsApp gewünscht",
      detail: "Nächster Schritt: WhatsApp manuell öffnen bzw. übernehmen.",
    };
  }

  const [updated] = await db
    .update(leads)
    .set(values)
    .where(and(eq(leads.workspaceId, context.workspaceId), eq(leads.id, lead.id)))
    .returning({
      id: leads.id,
      pipelineStage: leads.pipelineStage,
      callStatus: leads.callStatus,
      emailStatus: leads.emailStatus,
      whatsappStatus: leads.whatsappStatus,
      nextAction: leads.nextAction,
      nextActionAt: leads.nextActionAt,
    });

  await db.insert(activities).values(activity);
  return updated;
}
