import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { leads, settings, whatsappMessages, whatsappQueue, whatsappReservations, whatsappThreads } from "@/db/schema";
import { availableSlots, bookSlot, calendarConnected, localClock } from "@/lib/whatsapp/calendar";
import { getAgentConfig, withLease } from "@/lib/whatsapp/config";
import { limitedJson, whatsappError, whatsappWorkspace } from "@/lib/whatsapp/http";
import { modeSchema } from "@/lib/whatsapp/policy";
import { getBridgeStatus } from "@/lib/whatsapp/provider";
import { secureAccessConfigured } from "@/lib/whatsapp/access";
import { createReply, handoff, openThread, queueThread, reconcileMessage, reviewQueueItem, sendManual, threadMessages, threadRecord, updateThread } from "@/lib/whatsapp/service";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("open"), leadId: z.string().uuid(), phone: z.string().max(40).optional() }),
  z.object({ action: z.literal("update"), threadId: z.string().uuid(), patch: z.object({ mode: modeSchema.optional(), consent: z.enum(["unknown", "granted", "revoked"]).optional(), consentNote: z.string().max(2_000).optional(), status: z.enum(["open", "handoff", "closed"]).optional(), unread: z.boolean().optional() }) }),
  z.object({ action: z.literal("handoff"), threadId: z.string().uuid() }),
  z.object({ action: z.literal("queue"), threadId: z.string().uuid(), enabled: z.boolean() }),
  z.object({ action: z.literal("review"), queueId: z.string().uuid(), decision: z.enum(["approve", "reject"]) }),
  z.object({ action: z.literal("draft"), threadId: z.string().uuid() }),
  z.object({ action: z.literal("reconcile"), messageId: z.string().uuid() }),
  z.object({ action: z.literal("send"), threadId: z.string().uuid(), body: z.string().trim().max(4_000), key: z.string().uuid(), expectedVersion: z.number().int().nonnegative(), attachmentId: z.string().uuid().optional(), draftId: z.string().uuid().optional() }),
  z.object({ action: z.literal("slots"), threadId: z.string().uuid() }),
  z.object({ action: z.literal("book"), threadId: z.string().uuid(), slotId: z.string().min(1).max(100), expectedVersion: z.number().int().nonnegative() }),
]);

export async function GET(request: Request) {
  try {
    const workspace = await whatsappWorkspace();
    const threadId = new URL(request.url).searchParams.get("thread");
    if (threadId) {
      z.string().uuid().parse(threadId);
      const [record, messages, reservations] = await Promise.all([
        threadRecord(workspace.workspaceId, threadId), threadMessages(workspace.workspaceId, threadId),
        getDb().select().from(whatsappReservations).where(and(eq(whatsappReservations.workspaceId, workspace.workspaceId), eq(whatsappReservations.threadId, threadId))).orderBy(desc(whatsappReservations.createdAt)).limit(10),
      ]);
      return Response.json({ ...record, messages, reservations }, { headers: { "cache-control": "no-store" } });
    }
    const db = getDb();
    const [config, threads, leadRows, queue, connection, calendar, heartbeat] = await Promise.all([
      getAgentConfig(workspace.workspaceId),
      db.select({ thread: whatsappThreads, lead: { id: leads.id, company: leads.company, contact: leads.contact, phone: leads.phone, pipelineStage: leads.pipelineStage, summary: leads.summary, websiteUrl: leads.websiteUrl, salesPriority: leads.salesPriority } }).from(whatsappThreads).innerJoin(leads, and(eq(leads.id, whatsappThreads.leadId), eq(leads.workspaceId, whatsappThreads.workspaceId))).where(eq(whatsappThreads.workspaceId, workspace.workspaceId)).orderBy(desc(whatsappThreads.updatedAt)).limit(500),
      db.select({ id: leads.id, company: leads.company, contact: leads.contact, phone: leads.phone, summary: leads.summary, websiteUrl: leads.websiteUrl, salesPriority: leads.salesPriority }).from(leads).where(eq(leads.workspaceId, workspace.workspaceId)).orderBy(desc(leads.salesPriority)).limit(1_000),
      db.select({ id: whatsappQueue.id, threadId: whatsappQueue.threadId, status: whatsappQueue.status, error: whatsappQueue.error, messageId: whatsappQueue.messageId, sentAt: whatsappQueue.sentAt, createdAt: whatsappQueue.createdAt, updatedAt: whatsappQueue.updatedAt, body: whatsappMessages.body }).from(whatsappQueue).leftJoin(whatsappMessages, and(eq(whatsappMessages.workspaceId, whatsappQueue.workspaceId), eq(whatsappMessages.id, whatsappQueue.messageId))).where(eq(whatsappQueue.workspaceId, workspace.workspaceId)).orderBy(desc(whatsappQueue.updatedAt)).limit(1_000),
      getBridgeStatus(), calendarConnected(workspace.user.id),
      db.select().from(settings).where(and(eq(settings.workspaceId, workspace.workspaceId), eq(settings.key, "jj_whatsapp_last_tick"))).limit(1),
    ]);
    const today = localClock(new Date(), config.timezone).day;
    const sentToday = queue.filter((item) => item.status === "sent" && item.sentAt && localClock(item.sentAt, config.timezone).day === today).length;
    return Response.json({ config, threads, leads: leadRows, queue, connection, calendar, googleConfigured: Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET), secureAccess: secureAccessConfigured(), lastTick: heartbeat[0]?.value || null, sentToday, workspaceId: workspace.workspaceId }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return whatsappError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await whatsappWorkspace();
    const input = inputSchema.parse(await limitedJson(request, 12_000));
    const workspaceId = workspace.workspaceId;
    switch (input.action) {
      case "open": return Response.json({ thread: await openThread(workspaceId, input.leadId, input.phone) });
      case "update": return Response.json({ thread: await updateThread(workspaceId, input.threadId, input.patch) });
      case "handoff": await handoff(workspaceId, input.threadId, "Vom Team übernommen"); return Response.json({ ok: true });
      case "queue": await queueThread(workspaceId, input.threadId, input.enabled); return Response.json({ ok: true });
      case "review": return Response.json(await reviewQueueItem(workspaceId, input.queueId, input.decision));
      case "draft": return Response.json({ message: await createReply(workspaceId, input.threadId) });
      case "reconcile": return Response.json(await reconcileMessage(workspaceId, input.messageId));
      case "send":
        if (!input.body && !input.attachmentId) throw new Error("Bitte eine Nachricht oder einen Anhang auswählen.");
        return Response.json({ message: await sendManual({ ...input, workspaceId }) });
      case "slots": {
        await threadRecord(workspaceId, input.threadId);
        const config = await getAgentConfig(workspaceId);
        const slots = await availableSlots(workspace.user.id, workspaceId, config);
        // These times are visible only to the operator. Autopilot can select only sent offers.
        await getDb().update(whatsappThreads).set({ operatorSlots: slots, updatedAt: new Date() }).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, input.threadId)));
        return Response.json({ slots });
      }
      case "book": return Response.json(await withLease(workspaceId, `thread:${input.threadId}`, async () => {
        const { thread, lead } = await threadRecord(workspaceId, input.threadId);
        if (thread.version !== input.expectedVersion || thread.consent !== "granted" || thread.status === "closed") throw new Error("Bitte zuerst den aktuellen Kontaktstatus prüfen.");
        const slot = [...thread.operatorSlots, ...thread.offeredSlots].find((item) => item.id === input.slotId);
        if (!slot) throw new Error("Bitte zuerst aktuelle Terminvorschläge laden.");
        const config = await getAgentConfig(workspaceId);
        const result = await bookSlot({ userId: workspace.user.id, workspaceId, threadId: input.threadId, lead, config, slot, expectedVersion: input.expectedVersion });
        return { booking: result, confirmation: `Ihr Gespräch mit ${config.handoffName} ist für ${result.label} (${config.timezone}) gebucht.${result.joinUrl ? `\n\nZum Gespräch: ${result.joinUrl}` : ""}` };
      }));
    }
  } catch (error) { return whatsappError(error); }
}
