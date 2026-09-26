import { and, eq, lt, lte } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads, outreach, settings, tasks } from "@/db/schema";
import { sendStratoMessage } from "@/lib/strato-mail";
import { cancelPendingEmailFollowups, syncInboundEmailReplies } from "@/lib/outreach-lifecycle";
import { shouldStopEmailFollowups } from "@/lib/outreach-policy";

export const runtime = "nodejs";
export const maxDuration = 300;

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const db = getDb();
  const replySync = await syncInboundEmailReplies().catch((error) => {
    console.error("STRATO Reply-Sync fehlgeschlagen", error);
    return { checked: 0, matched: 0, stopped: 0 };
  });
  const staleBefore = new Date(Date.now() - 15 * 60 * 1000);
  await db
    .update(outreach)
    .set({ status: "scheduled", updatedAt: new Date() })
    .where(and(eq(outreach.status, "sending"), lt(outreach.updatedAt, staleBefore)));
  const due = await db
    .select({ item: outreach, lead: leads })
    .from(outreach)
    .innerJoin(leads, eq(leads.id, outreach.leadId))
    .where(and(eq(outreach.status, "scheduled"), lte(outreach.scheduledAt, new Date())))
    .limit(50);

  let sent = 0;
  let ready = 0;
  let failed = 0;
  for (const row of due) {
    const blocked = shouldStopEmailFollowups(row.lead);
    if (blocked) {
      await cancelPendingEmailFollowups({
        workspaceId: row.item.workspaceId,
        leadId: row.lead.id,
        reason: "Lead hat geantwortet, einen Termin gebucht, abgesagt oder ist für Kontakt gesperrt.",
      });
      continue;
    }

    const [autoSetting] = await db
      .select()
      .from(settings)
      .where(and(eq(settings.workspaceId, row.item.workspaceId), eq(settings.key, "auto_followups")))
      .limit(1);
    if (autoSetting?.value !== "true") {
      await db.update(outreach).set({ status: "ready", updatedAt: new Date() }).where(eq(outreach.id, row.item.id));
      ready += 1;
      continue;
    }

    try {
      const [claimed] = await db
        .update(outreach)
        .set({ status: "sending", updatedAt: new Date() })
        .where(and(eq(outreach.id, row.item.id), eq(outreach.status, "scheduled")))
        .returning({ id: outreach.id });
      if (!claimed) continue;
      const message = await sendStratoMessage({
        to: row.lead.email,
        subject: row.item.subject,
        body: row.item.body,
        threadId: row.item.providerThreadId,
      }, row.item.workspaceId);
      const taskTitle = `Follow-up ${row.item.step - 1}: ${row.lead.company}`;
      await Promise.all([
        db
          .update(outreach)
          .set({
            status: "sent",
            sentAt: new Date(),
            providerMessageId: message.id,
            providerThreadId: message.threadId,
            updatedAt: new Date(),
          })
          .where(and(eq(outreach.id, row.item.id), eq(outreach.status, "sending"))),
        db
          .update(tasks)
          .set({ status: "done", updatedAt: new Date() })
          .where(and(
            eq(tasks.leadId, row.lead.id),
            eq(tasks.type, "follow_up"),
            eq(tasks.title, taskTitle),
            eq(tasks.status, "open"),
          )),
        db.insert(activities).values({
          workspaceId: row.item.workspaceId,
          leadId: row.lead.id,
          type: "followup_sent",
          title: `Automatisches Follow-up ${row.item.step - 1}`,
          detail: row.item.subject,
        }),
      ]);
      sent += 1;
    } catch (error) {
      await db
        .update(outreach)
        .set({ status: "failed", updatedAt: new Date() })
        .where(and(eq(outreach.id, row.item.id), eq(outreach.status, "sending")));
      failed += 1;
      console.error("Automatisches Follow-up fehlgeschlagen", error);
    }
  }
  return Response.json({
    ok: true,
    enrichment: { mode: "manual", processed: 0 },
    outreach: { processed: due.length, sent, ready, failed, replySync },
  });
}
