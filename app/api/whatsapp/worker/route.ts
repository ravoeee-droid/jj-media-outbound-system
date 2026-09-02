import { get as getBlob } from "@vercel/blob";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, assets, leads, settings, whatsappMessages, whatsappQueue, whatsappThreads } from "@/db/schema";
import { getAgentConfig } from "@/lib/whatsapp/config";
import { limitedJson, whatsappError, whatsappWorkspace } from "@/lib/whatsapp/http";
import { effectiveMode, isSuppressed } from "@/lib/whatsapp/policy";
import { receiveMessage, receiveReceipt, runWhatsappTick } from "@/lib/whatsapp/service";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const STATUS_KEY = "jj_whatsapp_worker_status";
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status"), workerId: z.string().uuid(), connected: z.boolean(), phone: z.string().max(40).default(""), qr: z.string().max(120_000).default(""), version: z.string().max(80).default("") }),
  z.object({ action: z.literal("tick"), workerId: z.string().uuid() }),
  z.object({ action: z.literal("pull"), workerId: z.string().uuid() }),
  z.object({ action: z.literal("ack"), workerId: z.string().uuid(), messageId: z.string().uuid(), status: z.enum(["sent", "unknown"]), providerId: z.string().min(1).max(200).optional(), error: z.string().max(1_000).optional() }),
  z.object({ action: z.literal("event"), workerId: z.string().uuid(), id: z.string().min(1).max(200), phone: z.string().max(40), body: z.string().max(8_000), kind: z.enum(["text", "image", "audio", "document", "video", "other"]), timestamp: z.string().datetime(), fromMe: z.boolean().optional() }),
  z.object({ action: z.literal("receipt"), workerId: z.string().uuid(), providerId: z.string().min(1).max(200), status: z.enum(["sent", "delivered", "read"]) }),
]);

function stoppedReason(actor: string, thread: typeof whatsappThreads.$inferSelect, lead: typeof leads.$inferSelect, config: Awaited<ReturnType<typeof getAgentConfig>>, metadata: Record<string, unknown>) {
  if (thread.consent !== "granted" || thread.status === "closed" || lead.pipelineStage === "lost" || isSuppressed(lead.tags)) return "Kontakt wurde vor dem Versand gestoppt";
  const version = Number(metadata.configVersion);
  if (actor === "outreach" && (!config.enabled || !config.dailyOutreachEnabled || version !== config.version)) return "Tageslauf oder Regeln wurden vor dem Versand geändert";
  if (actor === "agent" && (!config.enabled || effectiveMode(config, thread.mode) !== "autopilot" || version !== config.version)) return "Autopilot oder Regeln wurden vor dem Versand geändert";
  return "";
}

async function markUnknown(workspaceId: string, messageId: string, error: string) {
  const db = getDb();
  const [message] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.id, messageId))).limit(1);
  if (!message || ["sent", "delivered", "read"].includes(message.status)) return;
  await db.update(whatsappMessages).set({ status: "unknown", metadata: { ...message.metadata, error }, updatedAt: new Date() }).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.id, messageId)));
  await db.update(whatsappQueue).set({ status: "unknown", error, updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.messageId, messageId)));
}

async function pull(workspaceId: string, workerId: string) {
  const db = getDb();
  const [row] = await db.select({ message: whatsappMessages, thread: whatsappThreads, lead: leads }).from(whatsappMessages)
    .innerJoin(whatsappThreads, and(eq(whatsappThreads.workspaceId, whatsappMessages.workspaceId), eq(whatsappThreads.id, whatsappMessages.threadId)))
    .innerJoin(leads, and(eq(leads.workspaceId, whatsappThreads.workspaceId), eq(leads.id, whatsappThreads.leadId)))
    .where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.direction, "outbound"), eq(whatsappMessages.status, "sending")))
    .orderBy(asc(whatsappMessages.updatedAt)).limit(1);
  if (!row) return { message: null };

  const metadata = row.message.metadata || {};
  const assigned = typeof metadata.workerId === "string" ? metadata.workerId : "";
  const pulledAt = typeof metadata.workerPulledAt === "string" ? Date.parse(metadata.workerPulledAt) : 0;
  if (assigned && assigned !== workerId) {
    if (Number.isFinite(pulledAt) && Date.now() - pulledAt < 5 * 60_000) return { message: null };
    await markUnknown(workspaceId, row.message.id, "Ein anderer WhatsApp-Laptop hatte den Auftrag bereits übernommen. Kein automatischer Neuversand.");
    return { message: null };
  }

  const config = await getAgentConfig(workspaceId);
  const actor = typeof metadata.actor === "string" ? metadata.actor : "human";
  const stop = stoppedReason(actor, row.thread, row.lead, config, metadata);
  if (stop) {
    await markUnknown(workspaceId, row.message.id, stop);
    return { message: null };
  }

  const now = new Date().toISOString();
  const nextMetadata = { ...metadata, workerId, workerPulledAt: now };
  const [claimed] = await db.update(whatsappMessages).set({ metadata: nextMetadata, updatedAt: new Date() }).where(and(
    eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.id, row.message.id), eq(whatsappMessages.status, "sending"),
    sql`coalesce(${whatsappMessages.metadata}->>'workerId', '') in ('', ${workerId})`,
  )).returning();
  if (!claimed) return { message: null };

  let attachment: { dataUrl: string; filename: string; mime: string } | undefined;
  if (typeof metadata.attachmentId === "string") {
    const [asset] = await db.select().from(assets).where(and(eq(assets.workspaceId, workspaceId), eq(assets.id, metadata.attachmentId), inArray(assets.kind, ["whatsapp_image", "whatsapp_document", "whatsapp_audio"]))).limit(1);
    if (!asset || asset.size > 3 * 1024 * 1024) {
      await markUnknown(workspaceId, row.message.id, "Anhang ist nicht mehr verfügbar");
      return { message: null };
    }
    const file = await getBlob(asset.blobUrl, { access: "private" });
    if (!file?.stream) {
      await markUnknown(workspaceId, row.message.id, "Anhang konnte nicht geladen werden");
      return { message: null };
    }
    const buffer = Buffer.from(await new Response(file.stream).arrayBuffer());
    if (buffer.length > 3 * 1024 * 1024) {
      await markUnknown(workspaceId, row.message.id, "Anhang überschreitet 3 MB");
      return { message: null };
    }
    attachment = { dataUrl: `data:${asset.contentType};base64,${buffer.toString("base64")}`, filename: asset.filename, mime: asset.contentType };
  }
  return { message: { id: row.message.id, to: row.thread.phone, body: row.message.body, attachment } };
}

async function ack(workspaceId: string, input: Extract<z.infer<typeof inputSchema>, { action: "ack" }>) {
  const db = getDb();
  const [row] = await db.select({ message: whatsappMessages, thread: whatsappThreads, lead: leads }).from(whatsappMessages)
    .innerJoin(whatsappThreads, and(eq(whatsappThreads.workspaceId, whatsappMessages.workspaceId), eq(whatsappThreads.id, whatsappMessages.threadId)))
    .innerJoin(leads, and(eq(leads.workspaceId, whatsappThreads.workspaceId), eq(leads.id, whatsappThreads.leadId)))
    .where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.id, input.messageId), eq(whatsappMessages.direction, "outbound"))).limit(1);
  if (!row) throw new Error("Versandauftrag nicht gefunden.");
  const assigned = typeof row.message.metadata.workerId === "string" ? row.message.metadata.workerId : "";
  if (assigned && assigned !== input.workerId) throw new Error("Dieser Versandauftrag gehört zu einem anderen WhatsApp-Laptop.");
  if (["sent", "delivered", "read"].includes(row.message.status)) return { status: row.message.status };
  if (input.status === "unknown") {
    await markUnknown(workspaceId, row.message.id, input.error || "WhatsApp konnte den Versand nicht eindeutig bestätigen");
    return { status: "unknown" };
  }
  if (!input.providerId) throw new Error("WhatsApp-Nachrichten-ID fehlt.");
  const sentAt = new Date();
  const [sent] = await db.update(whatsappMessages).set({ status: "sent", providerId: input.providerId, sentAt, metadata: { ...row.message.metadata, workerAckAt: sentAt.toISOString(), error: undefined }, updatedAt: sentAt }).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.id, row.message.id), inArray(whatsappMessages.status, ["sending", "unknown"]))).returning();
  if (!sent) return { status: row.message.status };
  await db.update(whatsappQueue).set({ status: "sent", sentAt, error: "", updatedAt: sentAt }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.messageId, row.message.id)));
  const actor = typeof row.message.metadata.actor === "string" ? row.message.metadata.actor : "human";
  const slots = Array.isArray(row.message.metadata.slots) ? row.message.metadata.slots : undefined;
  await db.update(whatsappThreads).set({ lastMessageAt: sentAt, version: sql`${whatsappThreads.version} + 1`, ...(actor === "human" ? { mode: "manual" as const } : {}), ...(slots ? { offeredSlots: slots } : {}), updatedAt: sentAt }).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, row.thread.id)));
  await db.update(leads).set({ lastContactAt: sentAt, lastActivityAt: sentAt, updatedAt: sentAt, ...(row.lead.pipelineStage === "new" ? { pipelineStage: "contacted" } : {}) }).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, row.lead.id)));
  await db.insert(activities).values({ workspaceId, leadId: row.lead.id, type: "whatsapp", title: "WhatsApp gesendet", detail: row.message.body, metadata: { messageId: row.message.id, providerId: input.providerId, actor } });
  return { status: "sent" };
}

export async function POST(request: Request) {
  try {
    const workspace = await whatsappWorkspace();
    const input = inputSchema.parse(await limitedJson(request, 160_000));
    const workspaceId = workspace.workspaceId;
    if (input.action === "status") {
      const value = JSON.stringify({ connected: input.connected, phone: input.phone, qr: input.qr, workerId: input.workerId, version: input.version, updatedAt: new Date().toISOString() });
      await getDb().insert(settings).values({ workspaceId, key: STATUS_KEY, value }).onConflictDoUpdate({ target: [settings.workspaceId, settings.key], set: { value, updatedAt: new Date() } });
      return Response.json({ ok: true });
    }
    if (input.action === "tick") return Response.json(await runWhatsappTick(workspaceId));
    if (input.action === "pull") return Response.json(await pull(workspaceId, input.workerId));
    if (input.action === "ack") return Response.json(await ack(workspaceId, input));
    if (input.action === "receipt") { await receiveReceipt(workspaceId, input.providerId, input.status); return Response.json({ ok: true }); }
    return Response.json(await receiveMessage(workspaceId, input));
  } catch (error) { return whatsappError(error); }
}
