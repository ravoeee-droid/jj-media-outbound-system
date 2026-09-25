import { and, eq, gt, gte, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads, outreach, tasks } from "@/db/schema";
import { extractMailReferenceIds } from "@/lib/outreach-policy";
import { listRecentStratoInboxMessages, stratoMailStatus } from "@/lib/strato-mail";

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

export async function syncInboundEmailReplies() {
  if (!stratoMailStatus().configured) return { checked: 0, matched: 0, stopped: 0 };
  const messages = await listRecentStratoInboxMessages(7);
  const referenceIds = new Set<string>();
  for (const message of messages) {
    for (const id of extractMailReferenceIds({ references: message.references, inReplyTo: message.inReplyTo })) {
      referenceIds.add(id);
    }
  }
  if (!referenceIds.size) return { checked: messages.length, matched: 0, stopped: 0 };

  const since = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
  const sent = await getDb()
    .select({ workspaceId: outreach.workspaceId, leadId: outreach.leadId, providerMessageId: outreach.providerMessageId })
    .from(outreach)
    .where(and(eq(outreach.status, "sent"), isNotNull(outreach.providerMessageId), gte(outreach.sentAt, since)))
    .limit(500);

  const matches = new Map<string, { workspaceId: string; leadId: string }>();
  for (const item of sent) {
    if (item.providerMessageId && referenceIds.has(item.providerMessageId)) {
      matches.set(item.leadId, { workspaceId: item.workspaceId, leadId: item.leadId });
    }
  }

  let stopped = 0;
  const db = getDb();
  for (const match of matches.values()) {
    const [lead] = await db.select().from(leads)
      .where(and(eq(leads.workspaceId, match.workspaceId), eq(leads.id, match.leadId)))
      .limit(1);
    if (!lead) continue;

    const cancelled = await cancelPendingEmailFollowups({
      workspaceId: match.workspaceId,
      leadId: match.leadId,
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
        }).where(and(eq(leads.workspaceId, match.workspaceId), eq(leads.id, match.leadId))),
        db.insert(activities).values({
          workspaceId: match.workspaceId,
          leadId: match.leadId,
          type: "email_reply_detected",
          title: "Antwort auf Info-Mail erkannt",
          detail: "Automatische Follow-ups wurden gestoppt; persönliche Übernahme ist jetzt der nächste Schritt.",
        }),
      ]);
    }
  }
  return { checked: messages.length, matched: matches.size, stopped };
}
