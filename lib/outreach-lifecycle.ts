import { and, eq, gt, gte, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads, outreach, tasks } from "@/db/schema";
import { extractMailReferenceIds } from "@/lib/outreach-policy";
import { getStratoMailStatus, listRecentStratoInboxMessages } from "@/lib/strato-mail";

export async function cancelPendingEmailFollowups(args: {
  workspaceId: string;
  leadId: string;
  reason: string;
  userId?: string | null;
}) {
  const db = getDb();
  const now = new Date();
  const [cancelledOutreach, cancelledTasks] = await Promise.all([
    db.update(outreach)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(
        eq(outreach.workspaceId, args.workspaceId),
        eq(outreach.leadId, args.leadId),
        gt(outreach.step, 1),
        inArray(outreach.status, ["scheduled", "ready"]),
      ))
      .returning({ id: outreach.id }),
    db.update(tasks)
      .set({ status: "cancelled", updatedAt: now })
      .where(and(
        eq(tasks.workspaceId, args.workspaceId),
        eq(tasks.leadId, args.leadId),
        eq(tasks.type, "follow_up"),
        eq(tasks.status, "open"),
      ))
      .returning({ id: tasks.id }),
  ]);

  if (cancelledOutreach.length || cancelledTasks.length) {
    await db.insert(activities).values({
      workspaceId: args.workspaceId,
      leadId: args.leadId,
      userId: args.userId || null,
      type: "email_followups_stopped",
      title: "E-Mail-Follow-ups gestoppt",
      detail: args.reason,
      metadata: {
        outreachCancelled: cancelledOutreach.length,
        tasksCancelled: cancelledTasks.length,
      },
    });
  }
  return { outreachCancelled: cancelledOutreach.length, tasksCancelled: cancelledTasks.length };
}

export async function syncInboundEmailReplies(workspaceId?: string) {
  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const db = getDb();

  const workspaceIds = workspaceId
    ? [workspaceId]
    : [...new Set((await db
        .select({ workspaceId: outreach.workspaceId })
        .from(outreach)
        .where(and(eq(outreach.status, "sent"), isNotNull(outreach.providerMessageId), gte(outreach.sentAt, since)))
        .limit(500))
      .map((row) => row.workspaceId))];

  let checked = 0;
  let matched = 0;
  let stopped = 0;

  for (const currentWorkspaceId of workspaceIds) {
    const status = await getStratoMailStatus(currentWorkspaceId);
    if (!status.configured) continue;

    const messages = await listRecentStratoInboxMessages(7, currentWorkspaceId);
    checked += messages.length;

    const referenceIds = new Set<string>();
    for (const message of messages) {
      for (const id of extractMailReferenceIds({ references: message.references, inReplyTo: message.inReplyTo })) {
        referenceIds.add(id);
      }
    }
    if (!referenceIds.size) continue;

    const sent = await db
      .select({ leadId: outreach.leadId, providerMessageId: outreach.providerMessageId })
      .from(outreach)
      .where(and(
        eq(outreach.workspaceId, currentWorkspaceId),
        eq(outreach.status, "sent"),
        isNotNull(outreach.providerMessageId),
        gte(outreach.sentAt, since),
      ))
      .limit(500);

    const leadIds = new Set<string>();
    for (const item of sent) {
      if (item.providerMessageId && referenceIds.has(item.providerMessageId)) leadIds.add(item.leadId);
    }
    matched += leadIds.size;

    for (const leadId of leadIds) {
      const [lead] = await db.select().from(leads)
        .where(and(eq(leads.workspaceId, currentWorkspaceId), eq(leads.id, leadId)))
        .limit(1);
      if (!lead) continue;

      const cancelled = await cancelPendingEmailFollowups({
        workspaceId: currentWorkspaceId,
        leadId,
        reason: "Antwort auf die persönliche Info-Mail erkannt.",
      });
      stopped += cancelled.outreachCancelled;

      if (lead.emailStatus !== "replied") {
        const terminal = ["call_booked", "won", "lost"].includes(lead.pipelineStage);
        await Promise.all([
          db.update(leads).set({
            emailStatus: "replied",
            pipelineStage: terminal ? lead.pipelineStage : "replied",
            nextAction: terminal ? lead.nextAction : "reply",
            nextActionAt: null,
            lastActivityAt: new Date(),
            updatedAt: new Date(),
          }).where(and(eq(leads.workspaceId, currentWorkspaceId), eq(leads.id, leadId))),
          db.insert(activities).values({
            workspaceId: currentWorkspaceId,
            leadId,
            type: "email_reply_detected",
            title: "Antwort auf Info-Mail erkannt",
            detail: "Automatische Follow-ups wurden gestoppt; persönliche Übernahme ist jetzt der nächste Schritt.",
          }),
        ]);
      }
    }
  }

  return { checked, matched, stopped };
}
