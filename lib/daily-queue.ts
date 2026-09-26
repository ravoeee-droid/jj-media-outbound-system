import { and, asc, desc, eq, gte, inArray, lte, or, sql } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads, tasks } from "@/db/schema";

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

export async function getDailyQueueStatsForOwners(workspaceId: string, ownerIds: string[]) {
  const unique = [...new Set(ownerIds)].filter(Boolean);
  if (!unique.length) return [];

  const noAnswerToday = sql`not exists (
    select 1
    from ${activities} queue_activity
    where queue_activity.lead_id = ${leads.id}
      and queue_activity.type = 'call_no_answer'
      and queue_activity.created_at >= ${berlinDayStartSql}
  )`;

  const where = and(
    eq(leads.workspaceId, workspaceId),
    inArray(leads.ownerId, unique),
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
  );

  const rows = await getDb()
    .select({
      ownerId: leads.ownerId,
      total: sql<number>`count(*)::int`,
      callbacks: sql<number>`count(*) filter (where ${leads.nextAction} = 'callback')::int`,
      highPriority: sql<number>`count(*) filter (where ${leads.salesPriority} >= 75)::int`,
    })
    .from(leads)
    .where(where)
    .groupBy(leads.ownerId);

  return rows.flatMap((row) => row.ownerId ? [{
    ownerId: row.ownerId,
    total: Number(row.total || 0),
    callbacks: Number(row.callbacks || 0),
    highPriority: Number(row.highPriority || 0),
  }] : []);
}
export async function getDailyQueue(workspaceId: string, ownerId: string, limit = 40) {
  const db = getDb();
  const where = queueEligibility(workspaceId, ownerId);

  const rowsPromise = db
    .select({
      id: leads.id,
      slug: leads.slug,
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
      videoStatus: leads.videoStatus,
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

export type CallResult = "no_answer" | "info_requested" | "whatsapp_requested" | "callback" | "meeting" | "no_interest";

export async function ensureCallStarted(context: QueueContext) {
  const db = getDb();
  const since = new Date(Date.now() - 4 * 60 * 60_000);
  const [latestStarted, latestResult] = await Promise.all([
    db.select({ id: activities.id, createdAt: activities.createdAt })
      .from(activities)
      .where(and(
        eq(activities.workspaceId, context.workspaceId),
        eq(activities.leadId, context.leadId),
        eq(activities.userId, context.userId),
        eq(activities.type, "call_started"),
        gte(activities.createdAt, since),
      ))
      .orderBy(desc(activities.createdAt))
      .limit(1),
    db.select({ createdAt: activities.createdAt })
      .from(activities)
      .where(and(
        eq(activities.workspaceId, context.workspaceId),
        eq(activities.leadId, context.leadId),
        eq(activities.userId, context.userId),
        eq(activities.type, "call_result"),
        gte(activities.createdAt, since),
      ))
      .orderBy(desc(activities.createdAt))
      .limit(1),
  ]);

  if (latestStarted && (!latestResult || latestResult.createdAt < latestStarted.createdAt)) {
    return { created: false, startedAt: latestStarted.createdAt };
  }

  const [created] = await db.insert(activities).values({
    workspaceId: context.workspaceId,
    leadId: context.leadId,
    userId: context.userId,
    type: "call_started",
    title: "Call gestartet",
    detail: "Anruf aus der Tages-Queue gestartet.",
    metadata: { source: "daily_queue" },
  }).returning({ createdAt: activities.createdAt });

  return { created: true, startedAt: created.createdAt };
}

export async function recordCallResult(context: QueueContext, result: CallResult) {
  const db = getDb();
  const session = await ensureCallStarted(context);

  const [existing] = await db
    .select({ id: activities.id })
    .from(activities)
    .where(and(
      eq(activities.workspaceId, context.workspaceId),
      eq(activities.leadId, context.leadId),
      eq(activities.userId, context.userId),
      eq(activities.type, "call_result"),
      gte(activities.createdAt, session.startedAt),
    ))
    .orderBy(desc(activities.createdAt))
    .limit(1);

  if (existing) return { created: false };

  await db.insert(activities).values({
    workspaceId: context.workspaceId,
    leadId: context.leadId,
    userId: context.userId,
    type: "call_result",
    title: "Call-Ergebnis erfasst",
    detail: result,
    metadata: {
      source: "daily_queue",
      result,
      connected: result !== "no_answer",
    },
  });
  return { created: true };
}

async function getLead(context: QueueContext) {
  const [lead] = await getDb()
    .select({
      id: leads.id,
      ownerId: leads.ownerId,
      company: leads.company,
      email: leads.email,
      phone: leads.phone,
      contactLocked: leads.contactLocked,
      pipelineStage: leads.pipelineStage,
      nextAction: leads.nextAction,
      nextActionAt: leads.nextActionAt,
    })
    .from(leads)
    .where(and(eq(leads.workspaceId, context.workspaceId), eq(leads.id, context.leadId)))
    .limit(1);

  if (!lead) throw new Error("Lead nicht gefunden.");
  if (lead.contactLocked || lead.pipelineStage === "lost") throw new Error("Dieser Lead ist für weiteren Kontakt gesperrt.");
  return lead;
}

export async function assertLeadInDailyQueue(workspaceId: string, leadId: string) {
  const [lead] = await getDb()
    .select({ id: leads.id, ownerId: leads.ownerId })
    .from(leads)
    .where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId)))
    .limit(1);
  if (!lead?.ownerId) throw new Error("Dieser Lead gehört aktuell zu keiner Tages-Queue.");

  const [eligible] = await getDb()
    .select({ id: leads.id })
    .from(leads)
    .where(and(queueEligibility(workspaceId, lead.ownerId), eq(leads.id, leadId)))
    .limit(1);
  if (!eligible) throw new Error("Dieser Lead ist nicht mehr in der aktuellen Tages-Queue. Bitte die Queue neu laden.");
  return lead;
}

async function completeOpenCallbackTask(workspaceId: string, leadId: string) {
  await getDb()
    .update(tasks)
    .set({ status: "done", updatedAt: new Date() })
    .where(and(
      eq(tasks.workspaceId, workspaceId),
      eq(tasks.leadId, leadId),
      eq(tasks.type, "callback"),
      eq(tasks.status, "open"),
    ));
}

async function upsertFollowUpTask(args: {
  workspaceId: string;
  leadId: string;
  assigneeId: string;
  type: string;
  title: string;
  priority?: string;
}) {
  const db = getDb();
  const [existing] = await db
    .select({ id: tasks.id })
    .from(tasks)
    .where(and(
      eq(tasks.workspaceId, args.workspaceId),
      eq(tasks.leadId, args.leadId),
      eq(tasks.type, args.type),
      eq(tasks.status, "open"),
    ))
    .limit(1);

  if (existing) {
    await db.update(tasks).set({
      assigneeId: args.assigneeId,
      title: args.title,
      dueAt: new Date(),
      priority: args.priority || "high",
      updatedAt: new Date(),
    }).where(eq(tasks.id, existing.id));
    return;
  }

  await db.insert(tasks).values({
    workspaceId: args.workspaceId,
    leadId: args.leadId,
    assigneeId: args.assigneeId,
    title: args.title,
    dueAt: new Date(),
    status: "open",
    priority: args.priority || "high",
    type: args.type,
  });
}

export async function recordQueueOutcome(context: QueueContext, outcome: QueueOutcome, options: { email?: string } = {}) {
  const db = getDb();
  const lead = await getLead(context);
  const now = new Date();
  const suppliedEmail = options.email?.trim().toLowerCase() || "";
  const email = suppliedEmail || lead.email;

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
      ...(suppliedEmail ? { email: suppliedEmail } : {}),
      pipelineStage: "contacted",
      callStatus: "connected",
      emailStatus: email ? "ready" : "needs_email",
      nextAction: email ? "send_info" : "collect_email",
      nextActionAt: null,
      lastContactAt: now,
    });
    activity = {
      workspaceId: context.workspaceId,
      leadId: lead.id,
      userId: context.userId,
      type: "call_info_requested",
      title: "Info gewünscht",
      detail: email
        ? "Nächster Schritt: persönliche Info-Mail vorbereiten und senden."
        : "E-Mail-Adresse fehlt noch; zuerst Kontaktadresse ergänzen.",
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
  await completeOpenCallbackTask(context.workspaceId, lead.id);

  const assigneeId = lead.ownerId || context.userId;
  if (outcome === "info_requested") {
    await upsertFollowUpTask({
      workspaceId: context.workspaceId,
      leadId: lead.id,
      assigneeId,
      type: "send_info",
      title: email ? "Info-Mail senden: " + lead.company : "E-Mail erfragen + Info senden: " + lead.company,
    });
  }
  if (outcome === "whatsapp_requested") {
    await upsertFollowUpTask({
      workspaceId: context.workspaceId,
      leadId: lead.id,
      assigneeId,
      type: "whatsapp_followup",
      title: "WhatsApp senden: " + lead.company,
    });
  }

  return updated;
}
