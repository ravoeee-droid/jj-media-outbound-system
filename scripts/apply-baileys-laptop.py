from pathlib import Path
import re

ROOT = Path('.')

def write(path: str, content: str):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content, encoding='utf-8')

def replace_once(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'Expected text not found in {path}: {old[:120]!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

def regex_once(path: str, pattern: str, repl: str):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    next_text, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'Expected one regex match in {path}, got {count}: {pattern[:100]}')
    p.write_text(next_text, encoding='utf-8')

# ---------------------------------------------------------------------------
# App provider: laptop worker status lives in the existing DB, not on a VPS.
# ---------------------------------------------------------------------------
write('lib/whatsapp/provider.ts', r'''import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { settings } from "@/db/schema";

const STATUS_KEY = "jj_whatsapp_worker_status";
const HEARTBEAT_MAX_AGE_MS = 75_000;

type WorkerStatus = {
  connected?: boolean;
  phone?: string;
  qr?: string;
  workerId?: string;
  version?: string;
  updatedAt?: string;
};

export async function getBridgeStatus(workspaceId: string) {
  const [row] = await getDb().select({ value: settings.value, updatedAt: settings.updatedAt }).from(settings).where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, STATUS_KEY))).limit(1);
  if (!row) return { configured: false, connected: false, message: "WhatsApp-Laptop noch nicht eingerichtet", phone: "", qr: "" };
  let value: WorkerStatus = {};
  try { value = JSON.parse(row.value) as WorkerStatus; } catch { /* bad status is treated as offline */ }
  const stamp = Date.parse(value.updatedAt || row.updatedAt.toISOString());
  const fresh = Number.isFinite(stamp) && Date.now() - stamp < HEARTBEAT_MAX_AGE_MS;
  const connected = fresh && value.connected === true;
  return {
    configured: true,
    connected,
    phone: value.phone || "",
    qr: fresh && typeof value.qr === "string" ? value.qr : "",
    message: connected ? "WhatsApp über den lokalen Laptop verbunden" : fresh && value.qr ? "QR-Code mit WhatsApp scannen" : "WhatsApp-Laptop starten",
  };
}

// Kept for the legacy signed webhook route. The Windows worker itself uses the
// authenticated /api/whatsapp/worker endpoint and needs no public webhook.
export function verifyWebhook(raw: string, timestamp: string | null, signature: string | null, secret = process.env.WHATSAPP_WEBHOOK_SECRET) {
  if (!secret || secret.length < 32 || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}
''')

# Existing WhatsApp screen should query status for its own workspace.
replace_once('app/api/whatsapp/route.ts', '      getBridgeStatus(), calendarConnected(workspace.user.id),', '      getBridgeStatus(workspace.workspaceId), calendarConnected(workspace.user.id),')

# ---------------------------------------------------------------------------
# Service: Vercel queues validated sends; the laptop pulls and ACKs them.
# ---------------------------------------------------------------------------
replace_once('lib/whatsapp/service.ts', 'import { get as getBlob } from "@vercel/blob";\n', '')
replace_once('lib/whatsapp/service.ts', 'import { bridgeConfigured, deliveryStatus, sendThroughBridge } from "./provider";\n', '')

regex_once(
    'lib/whatsapp/service.ts',
    r'  if \(!bridgeConfigured\(\)\) throw new Error\("WhatsApp ist noch nicht verbunden\."\);\n  let attachment: \{ dataUrl: string; filename: string; mime: string \} \| undefined;\n  if \(typeof message\.metadata\.attachmentId === "string"\) \{.*?\n  \}\n  // Recheck the stop switch',
    '  // Recheck the stop switch'
)

regex_once(
    'lib/whatsapp/service.ts',
    r'  const \[claimed\] = await db\.update\(whatsappMessages\)\.set\(\{ status: "sending", updatedAt: new Date\(\) \}\)\.where\(and\(eq\(whatsappMessages\.id, message\.id\), eq\(whatsappMessages\.workspaceId, args\.workspaceId\), eq\(whatsappMessages\.status, "draft"\)\)\)\.returning\(\);\n  if \(!claimed\) throw new Error\("Diese Nachricht wird bereits verarbeitet\."\);\n  let providerId: string;\n  try \{.*?\n  return sent;\n\}',
    r'''  const queuedAt = new Date().toISOString();
  const [claimed] = await db.update(whatsappMessages).set({ status: "sending", metadata: { ...message.metadata, workerQueuedAt: queuedAt }, updatedAt: new Date() }).where(and(eq(whatsappMessages.id, message.id), eq(whatsappMessages.workspaceId, args.workspaceId), eq(whatsappMessages.status, "draft"))).returning();
  if (!claimed) throw new Error("Diese Nachricht wird bereits verarbeitet.");
  await db.update(whatsappQueue).set({ status: "sending", error: "Wartet auf WhatsApp-Laptop", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, args.workspaceId), eq(whatsappQueue.messageId, message.id)));
  return claimed;
}'''
)

replace_once(
    'lib/whatsapp/service.ts',
    '      if (["sent", "delivered", "read"].includes(existing[0].status)) return existing[0];\n      return deliver({ ...args, messageId: existing[0].id, actor: "human" });',
    '      if (["sending", "unknown", "sent", "delivered", "read"].includes(existing[0].status)) return existing[0];\n      return deliver({ ...args, messageId: existing[0].id, actor: "human" });'
)

regex_once(
    'lib/whatsapp/service.ts',
    r'export async function reconcileMessage\(workspaceId: string, messageId: string\) \{.*?\n\}\n\nasync function followUp',
    r'''export async function reconcileMessage(workspaceId: string, messageId: string) {
  const [message] = await getDb().select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.id, messageId), eq(whatsappMessages.direction, "outbound"))).limit(1);
  if (!message || !["unknown", "sending"].includes(message.status)) throw new Error("Für diese Nachricht ist keine Statusprüfung erforderlich.");
  if (message.status === "sending") return { status: "sending", message: "Die Nachricht wartet auf den verbundenen WhatsApp-Laptop. Sie wird nicht doppelt versendet." };
  return { status: "unknown", message: "Der Versandstatus ist unklar. Bitte direkt in WhatsApp prüfen; die Nachricht wird aus Sicherheitsgründen nicht automatisch erneut gesendet." };
}

async function followUp'''
)

regex_once(
    'lib/whatsapp/service.ts',
    r'export async function receiveMessage\(workspaceId: string, input: \{ id: string; phone: string; body: string; kind: string; timestamp: string; fromMe\?: boolean \}\) \{.*?\n\}\n\nexport async function receiveReceipt',
    r'''export async function receiveMessage(workspaceId: string, input: { id: string; phone: string; body: string; kind: string; timestamp: string; fromMe?: boolean }) {
  const phone = normalizePhone(input.phone);
  if (!phone) return { ignored: true };
  const db = getDb();
  const [thread] = await db.select().from(whatsappThreads).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.phone, phone))).limit(1);
  // Never ingest private chats, groups or contacts outside the selected CRM contacts.
  if (!thread) return { ignored: true };
  const [known] = await db.select({ id: whatsappMessages.id }).from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.providerId, input.id))).limit(1);
  if (known) return { received: true, duplicate: true };

  if (input.fromMe) {
    const [message] = await db.insert(whatsappMessages).values({ workspaceId, threadId: thread.id, direction: "outbound", status: "sent", body: input.body, kind: input.kind, providerId: input.id, idempotencyKey: `phone:${input.id}`, metadata: { actor: "phone", providerTimestamp: input.timestamp }, sentAt: new Date(input.timestamp) }).onConflictDoNothing().returning();
    if (message) {
      await db.update(whatsappThreads).set({ lastMessageAt: new Date(), mode: "manual", version: sql`${whatsappThreads.version} + 1`, updatedAt: new Date() }).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, thread.id)));
      const { lead } = await threadRecord(workspaceId, thread.id);
      await db.update(leads).set({ lastContactAt: new Date(), lastActivityAt: new Date(), updatedAt: new Date(), ...(lead.pipelineStage === "new" ? { pipelineStage: "contacted" } : {}) }).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, lead.id)));
      await activity(workspaceId, thread.leadId, "WhatsApp vom Handy gesendet", input.body, { messageId: message.id, providerId: input.id });
    }
    return { received: true, fromMe: true, duplicate: !message };
  }

  const [message] = await db.insert(whatsappMessages).values({ workspaceId, threadId: thread.id, direction: "inbound", status: "received", body: input.body, kind: input.kind, providerId: input.id, idempotencyKey: `inbound:${input.id}`, metadata: { providerTimestamp: input.timestamp } }).onConflictDoNothing().returning();
  if (message) {
    await db.update(whatsappThreads).set({ lastInboundId: message.id, lastMessageAt: new Date(), unread: true, version: sql`${whatsappThreads.version} + 1`, updatedAt: new Date() }).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, thread.id)));
    await db.update(whatsappQueue).set({ status: "cancelled", error: "Kontakt hat geantwortet", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.threadId, thread.id), inArray(whatsappQueue.status, ["review", "queued"])));
    await activity(workspaceId, thread.leadId, "WhatsApp-Antwort erhalten", input.body, { messageId: message.id });
  }
  if (isOptOut(input.body)) {
    await updateThread(workspaceId, thread.id, { consent: "revoked", consentNote: input.body });
    const { lead } = await threadRecord(workspaceId, thread.id);
    await db.update(leads).set({ tags: [...new Set([...lead.tags, "opt-out"])], updatedAt: new Date() }).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, lead.id)));
    return { stopped: true };
  }
  if (requiresHuman(input.body)) { await handoff(workspaceId, thread.id, "Der Kontakt möchte eine persönliche Bearbeitung oder verhandeln."); return { handoff: true }; }
  try { await createReply(workspaceId, thread.id, true); }
  catch (error) {
    if (!(error instanceof Error && error.message.includes("gerade verarbeitet"))) await handoff(workspaceId, thread.id, error instanceof Error ? error.message : "KI-Antwort bitte prüfen");
  }
  return { received: true, duplicate: !message };
}

export async function receiveReceipt'''
)

replace_once(
    'lib/whatsapp/service.ts',
    '    if (!config.enabled || !config.dailyOutreachEnabled || !bridgeConfigured()) return { sent: 0, reason: "paused" };',
    '    if (!config.enabled || !config.dailyOutreachEnabled) return { sent: 0, reason: "paused" };'
)
replace_once(
    'lib/whatsapp/service.ts',
    '        await deliver({ workspaceId, threadId: thread.id, messageId: message.id, actor: "outreach", expectedVersion: Number(message.metadata.threadVersion), configVersion: Number(message.metadata.configVersion) });\n        await db.update(whatsappQueue).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(whatsappQueue.id, queued.id));\n        return { sent: 1, reason: "sent" };',
    '        await deliver({ workspaceId, threadId: thread.id, messageId: message.id, actor: "outreach", expectedVersion: Number(message.metadata.threadVersion), configVersion: Number(message.metadata.configVersion) });\n        return { sent: 0, queued: 1, reason: "queued_to_laptop" };'
)

# ---------------------------------------------------------------------------
# Authenticated worker API. The laptop always calls outward to Vercel.
# ---------------------------------------------------------------------------
write('app/api/whatsapp/worker/route.ts', r'''import { get as getBlob } from "@vercel/blob";
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
''')

# ---------------------------------------------------------------------------
# Connection UI: no VPS, OpenWA or ENV-key instructions.
# ---------------------------------------------------------------------------
ui_path = ROOT / 'app/dashboard/whatsapp/WhatsAppWorkspace.tsx'
ui = ui_path.read_text(encoding='utf-8')
old = '''{!data.connection.configured && <><p>OpenWA benötigt einen dauerhaft laufenden Verbindungsserver. Danach kannst du die JJ-Media-Nummer hier per QR-Code koppeln.</p><details><summary>Einrichtungsdaten</summary><dl><dt>Webhook-Adresse</dt><dd>{typeof window !== "undefined" ? window.location.origin : ""}/admin/api/whatsapp/webhook</dd><dt>Workspace</dt><dd>{data.workspaceId}</dd></dl><p>Auf dem App-Server hinterlegen: WHATSAPP_BRIDGE_URL, WHATSAPP_BRIDGE_KEY, WHATSAPP_WEBHOOK_SECRET und WHATSAPP_WORKSPACE_ID. Die Anleitung und der startfertige Dienst liegen im Projekt unter services/whatsapp-bridge.</p></details></>}'''
new = '''{!data.connection.configured && <><p>Starte den JJ-Media WhatsApp-Dienst auf Jessys Windows-Laptop. Der Laptop verbindet sich selbst mit dem Outbound Tool – ohne VPS, Tunnel, Chromium oder offene Ports.</p><details><summary>Einrichtung auf dem Laptop</summary><p>Einmal <strong>INSTALL-WHATSAPP.bat</strong> ausführen und den Outbound-Tool-Zugang bestätigen. Danach startet der Dienst automatisch mit Windows. Falls er einmal nicht läuft, genügt ein Doppelklick auf <strong>START-WHATSAPP.bat</strong>.</p></details></>}'''
if old not in ui:
    raise SystemExit('Connection UI setup block not found')
ui = ui.replace(old, new, 1)
ui = ui.replace('<dt>Verbindungsserver</dt><dd>{heartbeatLive ? "Erreichbar" : "Kein aktuelles Signal"}</dd>', '<dt>WhatsApp-Laptop</dt><dd>{heartbeatLive ? "Verbunden" : "Kein aktuelles Signal"}</dd>', 1)
ui_path.write_text(ui, encoding='utf-8')

# Make user-facing auth errors say Outbound Tool instead of the old internal name.
http_path = ROOT / 'lib/whatsapp/http.ts'
http = http_path.read_text(encoding='utf-8').replace('Bitte am Cockpit anmelden.', 'Bitte am Outbound Tool anmelden.')
http_path.write_text(http, encoding='utf-8')
access_path = ROOT / 'lib/whatsapp/access.ts'
access = access_path.read_text(encoding='utf-8').replace('einen eigenen Cockpit-Zugang einrichten', 'einen eigenen Outbound-Tool-Zugang einrichten')
access_path.write_text(access, encoding='utf-8')

# ---------------------------------------------------------------------------
# Local Windows worker, pinned to a stable Baileys 6.x package. No Chromium.
# ---------------------------------------------------------------------------
service = ROOT / 'services/whatsapp-bridge'
service.mkdir(parents=True, exist_ok=True)
for name in ['Dockerfile', 'bridge.env.example', 'compose.yaml', 'core.mjs', 'core.test.mjs', 'package-lock.json']:
    (service / name).unlink(missing_ok=True)

write('services/whatsapp-bridge/package.json', r'''{
  "name": "jj-media-whatsapp-laptop",
  "private": true,
  "type": "module",
  "engines": { "node": ">=20" },
  "scripts": {
    "start": "node server.mjs",
    "setup": "node setup.mjs",
    "test": "node --check server.mjs && node --check setup.mjs"
  },
  "dependencies": {
    "@whiskeysockets/baileys": "6.7.24",
    "pino": "^9.6.0",
    "qrcode": "^1.5.4",
    "qrcode-terminal": "^0.12.0"
  }
}
''')

write('services/whatsapp-bridge/setup.mjs', r'''import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import readline from "node:readline/promises";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");
const configPath = join(dataDir, "config.json");
mkdirSync(dataDir, { recursive: true });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function normalizeBase(value) {
  const text = String(value || "").trim() || "https://jj-media-social-outbound.vercel.app";
  const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Bitte die HTTPS-Adresse des Outbound Tools verwenden.");
  return url.origin;
}

async function hiddenQuestion(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") return rl.question(label);
  process.stdout.write(label);
  readline.emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  let value = "";
  return new Promise((resolve, reject) => {
    const onKey = (chunk, key = {}) => {
      if (key.ctrl && key.name === "c") { cleanup(); reject(new Error("Abgebrochen.")); return; }
      if (key.name === "return" || key.name === "enter") { cleanup(); process.stdout.write("\n"); resolve(value); return; }
      if (key.name === "backspace") { if (value.length) { value = value.slice(0, -1); process.stdout.write("\b \b"); } return; }
      if (chunk && !key.ctrl && !key.meta && chunk >= " ") { value += chunk; process.stdout.write("*"); }
    };
    const cleanup = () => { process.stdin.off("keypress", onKey); process.stdin.setRawMode(false); };
    process.stdin.on("keypress", onKey);
  });
}

async function login(baseUrl, password) {
  const response = await fetch(`${baseUrl}/admin/api/cockpit/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }), redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(response.status === 401 ? "Das Outbound-Tool-Passwort ist nicht korrekt." : `Anmeldung fehlgeschlagen (${response.status}).`);
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  const joined = cookies.join(";");
  const match = joined.match(/(?:^|[;,]\s*)dg_cockpit=([^;]+)/);
  if (!match) throw new Error("Die Anmeldung war erfolgreich, aber das lokale Sitzungstoken fehlt.");
  return match[1];
}

try {
  console.log("\nJJ-Media WhatsApp – einmalige Einrichtung\n");
  let previous = {};
  try { previous = JSON.parse(readFileSync(configPath, "utf8")); } catch { /* first setup */ }
  const baseInput = await rl.question(`Outbound-Tool-Adresse [${previous.baseUrl || "https://jj-media-social-outbound.vercel.app"}]: `);
  const baseUrl = normalizeBase(baseInput || previous.baseUrl);
  const password = await hiddenQuestion("Outbound-Tool-Passwort: ");
  const cookie = await login(baseUrl, password);
  const config = { baseUrl, cookie, workerId: previous.workerId || randomUUID(), createdAt: previous.createdAt || new Date().toISOString() };
  writeFileSync(configPath, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  const status = await fetch(`${baseUrl}/admin/api/whatsapp/worker`, { method: "POST", headers: { "content-type": "application/json", cookie: `dg_cockpit=${cookie}` }, body: JSON.stringify({ action: "status", workerId: config.workerId, connected: false, phone: "", qr: "", version: "baileys-6.7.24" }), signal: AbortSignal.timeout(20_000) });
  if (!status.ok) throw new Error(`Der WhatsApp-Bereich des Outbound Tools antwortet noch nicht korrekt (${status.status}).`);
  console.log("\n✓ Laptop mit dem JJ-Media Outbound Tool gekoppelt.");
  console.log("✓ Das Passwort wurde NICHT gespeichert.");
  console.log("\nAls Nächstes startet WhatsApp automatisch. Beim ersten Start QR-Code scannen.\n");
} finally {
  rl.close();
}
''')

write('services/whatsapp-bridge/server.mjs', r'''import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");
const authDir = join(dataDir, "auth");
const configPath = join(dataDir, "config.json");
const ledgerPath = join(dataDir, "send-ledger.json");
const pidPath = join(dataDir, "worker.pid");
mkdirSync(dataDir, { recursive: true });
mkdirSync(authDir, { recursive: true });

if (!existsSync(configPath)) {
  console.error("Noch nicht eingerichtet. Bitte zuerst INSTALL-WHATSAPP.bat ausführen.");
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (!config.baseUrl || !config.cookie || !config.workerId) throw new Error("Lokale Konfiguration unvollständig. INSTALL-WHATSAPP.bat erneut ausführen.");

function acquirePid() {
  if (existsSync(pidPath)) {
    const old = Number(readFileSync(pidPath, "utf8"));
    if (Number.isInteger(old) && old > 0) {
      try { process.kill(old, 0); console.error("JJ-Media WhatsApp läuft bereits."); process.exit(0); } catch { /* stale pid */ }
    }
  }
  writeFileSync(pidPath, String(process.pid));
}
acquirePid();

let ledger = {};
try { ledger = JSON.parse(readFileSync(ledgerPath, "utf8")); } catch { ledger = {}; }
function saveLedger() {
  const entries = Object.entries(ledger).sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || ""))).slice(0, 2000);
  ledger = Object.fromEntries(entries);
  const tmp = `${ledgerPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), { encoding: "utf8", mode: 0o600 });
  rmSync(ledgerPath, { force: true });
  writeFileSync(ledgerPath, readFileSync(tmp));
  rmSync(tmp, { force: true });
}

async function api(payload, timeout = 30_000) {
  const response = await fetch(`${config.baseUrl}/admin/api/whatsapp/worker`, { method: "POST", headers: { "content-type": "application/json", cookie: `dg_cockpit=${config.cookie}` }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(timeout) });
  if (response.status === 401) throw new Error("Laptop-Anmeldung abgelaufen oder geändert. INSTALL-WHATSAPP.bat erneut ausführen.");
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || `Outbound Tool meldet HTTP ${response.status}`);
  return value;
}

function digitsFromJid(jid) {
  if (typeof jid !== "string" || !jid.endsWith("@s.whatsapp.net")) return "";
  return jid.slice(0, -"@s.whatsapp.net".length).split(":")[0].replace(/\D/g, "");
}
function phoneFromKey(key) {
  const alt = digitsFromJid(key?.remoteJidAlt);
  return alt || digitsFromJid(key?.remoteJid);
}
function unwrap(input) {
  let msg = input || {};
  for (let i = 0; i < 4; i += 1) {
    if (msg.ephemeralMessage?.message) { msg = msg.ephemeralMessage.message; continue; }
    if (msg.viewOnceMessage?.message) { msg = msg.viewOnceMessage.message; continue; }
    if (msg.viewOnceMessageV2?.message) { msg = msg.viewOnceMessageV2.message; continue; }
    if (msg.documentWithCaptionMessage?.message) { msg = msg.documentWithCaptionMessage.message; continue; }
    break;
  }
  return msg;
}
function messageContent(input) {
  const msg = unwrap(input);
  if (typeof msg.conversation === "string") return { kind: "text", body: msg.conversation };
  if (typeof msg.extendedTextMessage?.text === "string") return { kind: "text", body: msg.extendedTextMessage.text };
  if (msg.imageMessage) return { kind: "image", body: msg.imageMessage.caption || "" };
  if (msg.audioMessage) return { kind: "audio", body: "" };
  if (msg.videoMessage) return { kind: "video", body: msg.videoMessage.caption || "" };
  if (msg.documentMessage) return { kind: "document", body: msg.documentMessage.caption || "" };
  return { kind: "other", body: "" };
}
function receiptStatus(value) {
  const n = Number(value);
  if (n >= 4) return "read";
  if (n >= 3) return "delivered";
  if (n >= 2) return "sent";
  return "";
}
function dataUrlBuffer(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Ungültiger Anhang vom Outbound Tool.");
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

let sock = null;
let connected = false;
let phone = "";
let qrData = "";
let stopping = false;
let pumpBusy = false;
const inFlight = new Map();
const logger = pino({ level: "silent" });

async function statusHeartbeat() {
  try { await api({ action: "status", workerId: config.workerId, connected, phone, qr: connected ? "" : qrData, version: "baileys-6.7.24" }, 20_000); }
  catch (error) { console.warn(`Status: ${error.message}`); }
}

function contentForSend(message) {
  if (!message.attachment) return { text: message.body || "" };
  const decoded = dataUrlBuffer(message.attachment.dataUrl);
  const mime = message.attachment.mime || decoded.mime;
  if (mime.startsWith("image/")) return { image: decoded.buffer, caption: message.body || undefined, mimetype: mime };
  if (mime.startsWith("audio/")) return { audio: decoded.buffer, mimetype: mime, ptt: false };
  return { document: decoded.buffer, mimetype: mime, fileName: message.attachment.filename || "Dokument", caption: message.body || undefined };
}

async function sendPulled(message) {
  const previous = ledger[message.id];
  if (previous?.status === "sent" && previous.providerId) {
    await api({ action: "ack", workerId: config.workerId, messageId: message.id, status: "sent", providerId: previous.providerId });
    return;
  }
  if (previous && ["sending", "unknown"].includes(previous.status)) {
    await api({ action: "ack", workerId: config.workerId, messageId: message.id, status: "unknown", error: "Lokaler Versand war nach einem Neustart nicht eindeutig bestätigt; kein automatischer Neuversand." });
    return;
  }
  ledger[message.id] = { status: "sending", to: message.to, body: message.body, updatedAt: new Date().toISOString() };
  saveLedger();
  inFlight.set(message.id, { to: message.to, body: message.body || "" });
  try {
    const jid = `${String(message.to).replace(/\D/g, "")}@s.whatsapp.net`;
    const result = await sock.sendMessage(jid, contentForSend(message));
    const providerId = result?.key?.id;
    if (!providerId) throw new Error("WhatsApp lieferte keine Nachrichten-ID.");
    ledger[message.id] = { status: "sent", providerId, to: message.to, body: message.body, updatedAt: new Date().toISOString() };
    saveLedger();
    await api({ action: "ack", workerId: config.workerId, messageId: message.id, status: "sent", providerId });
  } catch (error) {
    ledger[message.id] = { status: "unknown", to: message.to, body: message.body, error: error.message, updatedAt: new Date().toISOString() };
    saveLedger();
    try { await api({ action: "ack", workerId: config.workerId, messageId: message.id, status: "unknown", error: error.message || "Versandstatus unklar" }); } catch { /* surfaced on next UI refresh */ }
    throw error;
  } finally {
    inFlight.delete(message.id);
  }
}

async function pump() {
  if (!connected || !sock || pumpBusy || stopping) return;
  pumpBusy = true;
  try {
    const result = await api({ action: "pull", workerId: config.workerId }, 35_000);
    if (result.message) await sendPulled(result.message);
  } catch (error) {
    console.warn(`Versand: ${error.message}`);
  } finally { pumpBusy = false; }
}

async function handleMessage(entry) {
  const key = entry?.key || {};
  const jid = key.remoteJid || "";
  if (jid === "status@broadcast" || jid.endsWith("@g.us") || jid.endsWith("@newsletter")) return;
  const phoneNumber = phoneFromKey(key);
  if (!phoneNumber || !key.id) return;
  const content = messageContent(entry.message);
  if (content.kind === "other") return;
  if (key.fromMe && [...inFlight.values()].some((row) => row.to === phoneNumber && row.body === content.body)) return;
  if (key.fromMe && Object.values(ledger).some((row) => row?.providerId === key.id)) return;
  try {
    await api({ action: "event", workerId: config.workerId, id: key.id, phone: phoneNumber, body: content.body, kind: content.kind, timestamp: new Date(Number(entry.messageTimestamp || Date.now() / 1000) * 1000).toISOString(), fromMe: key.fromMe === true }, 40_000);
  } catch (error) { console.warn(`Chat-Sync: ${error.message}`); }
}

async function connect() {
  if (stopping) return;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  sock = makeWASocket({ auth: state, logger, markOnlineOnConnect: false, syncFullHistory: false, browser: ["JJ Media Outbound", "Chrome", "1.0.0"], generateHighQualityLinkPreview: false });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const entry of messages || []) void handleMessage(entry);
  });
  sock.ev.on("messages.update", (updates) => {
    for (const row of updates || []) {
      const providerId = row?.key?.id;
      const status = receiptStatus(row?.update?.status);
      if (providerId && status) void api({ action: "receipt", workerId: config.workerId, providerId, status }).catch(() => undefined);
    }
  });
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      connected = false;
      qrData = await QRCode.toDataURL(qr, { margin: 1, width: 360 });
      console.log("\nWhatsApp verbinden: QR-Code scannen\n");
      qrcodeTerminal.generate(qr, { small: true });
      console.log("Alternativ: Outbound Tool → WhatsApp → Verbindungen.\n");
      await statusHeartbeat();
    }
    if (connection === "open") {
      connected = true;
      phone = digitsFromJid(sock.user?.id || "");
      qrData = "";
      console.log(`✓ WhatsApp verbunden${phone ? ` (+${phone})` : ""}. Outbound Tool ist bereit.`);
      await statusHeartbeat();
      void api({ action: "tick", workerId: config.workerId }).catch(() => undefined);
    }
    if (connection === "close") {
      connected = false;
      const error = lastDisconnect?.error;
      const code = Number(error?.output?.statusCode || error?.statusCode || error?.data?.statusCode || 0);
      if (code === Number(DisconnectReason.loggedOut)) {
        console.warn("WhatsApp wurde abgemeldet. Die lokale Kopplung wird zurückgesetzt.");
        rmSync(authDir, { recursive: true, force: true });
        mkdirSync(authDir, { recursive: true });
      } else console.warn("WhatsApp-Verbindung getrennt – verbinde erneut …");
      await statusHeartbeat();
      if (!stopping) setTimeout(() => void connect().catch((err) => console.warn(err.message)), 2_500);
    }
  });
}

const statusTimer = setInterval(() => void statusHeartbeat(), 20_000);
const pumpTimer = setInterval(() => void pump(), 2_500);
const tickTimer = setInterval(() => { if (connected && !stopping) void api({ action: "tick", workerId: config.workerId }, 110_000).catch((error) => console.warn(`Automatik: ${error.message}`)); }, 60_000);

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(statusTimer); clearInterval(pumpTimer); clearInterval(tickTimer);
  connected = false; qrData = "";
  try { await statusHeartbeat(); } catch { /* best effort */ }
  try { unlinkSync(pidPath); } catch { /* best effort */ }
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("exit", () => { try { unlinkSync(pidPath); } catch { /* best effort */ } });

console.log("JJ-Media WhatsApp startet – kein Chromium, kein VPS, kein Tunnel.");
connect().catch((error) => { console.error(error); shutdown(); });
''')

write('services/whatsapp-bridge/INSTALL-WHATSAPP.bat', r'''@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title JJ-Media WhatsApp - Installation
color 0A

echo.
echo ============================================
echo   JJ-MEDIA WHATSAPP - EINMALIGE INSTALLATION
echo ============================================
echo.

where node >nul 2>&1
if errorlevel 1 goto install_node
for /f "tokens=1 delims=." %%V in ('node -p "process.versions.node"') do set NODE_MAJOR=%%V
if %NODE_MAJOR% LSS 20 goto install_node
goto install_deps

:install_node
echo Node.js 20+ wird benoetigt. Installation wird versucht ...
where winget >nul 2>&1
if errorlevel 1 goto no_winget
winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"
where node >nul 2>&1
if errorlevel 1 goto node_failed
goto install_deps

:no_winget
echo.
echo Bitte zuerst Node.js LTS von nodejs.org installieren und diese Datei erneut starten.
pause
exit /b 1

:node_failed
echo.
echo Node.js wurde installiert, Windows kennt den neuen Pfad aber noch nicht.
echo Bitte dieses Fenster schliessen und INSTALL-WHATSAPP.bat erneut doppelklicken.
pause
exit /b 1

:install_deps
echo [1/3] Schlanken WhatsApp-Dienst installieren ...
call npm install --omit=dev
if errorlevel 1 goto failed

echo.
echo [2/3] Mit dem JJ-Media Outbound Tool verbinden ...
node setup.mjs
if errorlevel 1 goto failed

echo.
echo [3/3] Autostart in Windows einrichten ...
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0install-autostart.ps1"
if errorlevel 1 goto failed

echo.
echo ============================================
echo   FERTIG - WHATSAPP WIRD JETZT GESTARTET
echo ============================================
echo.
echo Beim ersten Mal QR-Code mit WhatsApp scannen.
echo Danach startet der Dienst automatisch mit Windows.
echo.
start "JJ-Media WhatsApp" "%~dp0START-WHATSAPP.bat"
timeout /t 2 >nul
exit /b 0

:failed
echo.
echo Installation nicht abgeschlossen. Die Fehlermeldung steht direkt darueber.
pause
exit /b 1
''')

write('services/whatsapp-bridge/START-WHATSAPP.bat', r'''@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title JJ-Media WhatsApp
color 0A
where node >nul 2>&1
if errorlevel 1 (
  echo Node.js fehlt. Bitte zuerst INSTALL-WHATSAPP.bat starten.
  pause
  exit /b 1
)
if not exist "node_modules\@whiskeysockets\baileys" (
  echo WhatsApp-Dienst wird vervollstaendigt ...
  call npm install --omit=dev
  if errorlevel 1 pause & exit /b 1
)
node server.mjs
if errorlevel 1 (
  echo.
  echo Der Dienst wurde mit einem Fehler beendet. Bitte die Meldung oben pruefen.
  pause
)
''')

write('services/whatsapp-bridge/STOP-WHATSAPP.bat', r'''@echo off
setlocal
cd /d "%~dp0"
if not exist "data\worker.pid" (
  echo JJ-Media WhatsApp laeuft laut Status nicht.
  pause
  exit /b 0
)
set /p PID=<"data\worker.pid"
taskkill /PID %PID% /T >nul 2>&1
if errorlevel 1 (
  echo Prozess war bereits beendet.
) else (
  echo JJ-Media WhatsApp wurde gestoppt.
)
del /q "data\worker.pid" >nul 2>&1
pause
''')

write('services/whatsapp-bridge/START-WHATSAPP-SILENT.vbs', r'''Set shell = CreateObject("WScript.Shell")
Set fso = CreateObject("Scripting.FileSystemObject")
folder = fso.GetParentFolderName(WScript.ScriptFullName)
shell.CurrentDirectory = folder
shell.Run "cmd.exe /c " & Chr(34) & Chr(34) & folder & "\START-WHATSAPP.bat" & Chr(34) & Chr(34), 0, False
''')

write('services/whatsapp-bridge/install-autostart.ps1', r'''$ErrorActionPreference = "Stop"
$startup = [Environment]::GetFolderPath("Startup")
$shortcutPath = Join-Path $startup "JJ-Media WhatsApp.lnk"
$wsh = New-Object -ComObject WScript.Shell
$shortcut = $wsh.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:WINDIR "System32\wscript.exe"
$shortcut.Arguments = '"' + (Join-Path $PSScriptRoot "START-WHATSAPP-SILENT.vbs") + '"'
$shortcut.WorkingDirectory = $PSScriptRoot
$shortcut.Description = "JJ-Media WhatsApp automatisch starten"
$shortcut.Save()
Write-Host "Autostart eingerichtet:" $shortcutPath
''')

write('services/whatsapp-bridge/README-WINDOWS.md', r'''# JJ-Media WhatsApp auf Windows

## Einmalig

1. Ordner auf Jessys Laptop entpacken.
2. `INSTALL-WHATSAPP.bat` doppelklicken.
3. Die Adresse des Outbound Tools einfach mit Enter bestätigen.
4. Das Passwort des JJ-Media Outbound Tools eingeben. Das Passwort wird **nicht** lokal gespeichert; nur das daraus ausgestellte Sitzungstoken wird gespeichert.
5. Nach dem Start den QR-Code mit WhatsApp unter **Einstellungen → Verknüpfte Geräte → Gerät hinzufügen** scannen.
6. Im Outbound Tool unter **WhatsApp → Verbindungen** erscheint anschließend `Verbunden`.

## Danach

Der Dienst startet automatisch, sobald sich Jessy bei Windows anmeldet. Falls er einmal nicht läuft, `START-WHATSAPP.bat` doppelklicken. Zum bewussten Stoppen `STOP-WHATSAPP.bat` verwenden.

## Technik

Der Laptop hält die WhatsApp-WebSocket-Verbindung mit Baileys. Er baut ausschließlich ausgehende HTTPS-Verbindungen zum vorhandenen JJ-Media Outbound Tool auf. Es gibt keinen VPS, keinen Tunnel, keine offenen Router-Ports und keinen Chromium-Prozess.

Die Sitzung liegt nur lokal in `data/auth`. `data/` niemals teilen oder in Git hochladen. Bei Passwortänderung im Outbound Tool `INSTALL-WHATSAPP.bat` erneut ausführen. Bei einer WhatsApp-Abmeldung wird automatisch eine neue QR-Kopplung verlangt.

Baileys ist eine inoffizielle WhatsApp-Web-Anbindung. Ein Konto kann deshalb nie technisch gegen Einschränkungen garantiert werden. Das Outbound Tool behält deshalb Zustimmung/Opt-out, manuelle Freigabe, Tageslimits, Abstände und Stop-Schalter als Sicherheitsgrenzen bei.
''')

# Local auth/session data must never enter Git.
gitignore = (ROOT / '.gitignore').read_text(encoding='utf-8')
entry = 'services/whatsapp-bridge/data/'
if entry not in gitignore:
    if not gitignore.endswith('\n'): gitignore += '\n'
    gitignore += f'\n# Local WhatsApp laptop session and tokens\n{entry}\n'
    (ROOT / '.gitignore').write_text(gitignore, encoding='utf-8')

# Updated operational documentation.
write('docs/whatsapp-workspace.md', r'''# WhatsApp im JJ-Media Outbound Tool

Unter `/admin/dashboard/whatsapp` liegen Inbox, Tageslauf, KI-Wissen und Verbindungen im bestehenden JJ-Media Outbound Tool.

## Ablauf

1. Leads werden zuerst geprüft und angereichert.
2. Erstkontakte landen vor dem Versand in der manuellen Freigabe. Der feste Einstieg lautet `Hallo, bin ich da bei <Unternehmensname> gelandet?`.
3. Nur freigegebene Kontakte mit dokumentierter WhatsApp-Zustimmung können in den Tageslauf gehen.
4. Der Tageslauf verschickt höchstens das eingestellte Tageslimit und mindestens drei Minuten auseinander. Antworten stoppen den offenen Erstkontakt.
5. Nach einer Antwort folgt die Verkaufslogik Situation → Problem → Auswirkung → Priorität/Ziel → bisherige Versuche → Erlaubnis für Lösung. Pro Nachricht höchstens eine Frage.
6. Opt-out, geschlossene Chats, Sperr-Tags oder menschliche Übernahme stoppen die Automatik.

## Kostenloser Windows-Betrieb

Der WhatsApp-Teil läuft auf Jessys Windows-Laptop mit `@whiskeysockets/baileys` 6.7.24. Baileys hält direkt eine WebSocket-Verbindung zu WhatsApp und benötigt keinen Browser/Chromium.

Architektur:

`WhatsApp ↔ Baileys auf Jessys Laptop → HTTPS → JJ-Media Outbound Tool auf Vercel → Datenbank/KI/CRM`

Der Laptop öffnet keine Ports und benötigt weder VPS noch Cloudflare Tunnel. Das Outbound Tool versucht niemals, den Laptop direkt zu erreichen.

### Einmalige Einrichtung

Im Ordner `services/whatsapp-bridge`:

1. `INSTALL-WHATSAPP.bat` doppelklicken.
2. Die vorgeschlagene Outbound-Tool-Adresse bestätigen.
3. Das Outbound-Tool-Passwort eingeben. Das Klartextpasswort wird nicht gespeichert.
4. Der Installer richtet Node.js bei Bedarf, die Abhängigkeiten und den Windows-Autostart ein.
5. Danach WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät hinzufügen und den QR-Code scannen. Der QR erscheint sowohl im lokalen Fenster als auch unter **WhatsApp → Verbindungen** im Outbound Tool.

Danach startet der Dienst automatisch bei der Windows-Anmeldung. Manuell kann er über `START-WHATSAPP.bat` gestartet und über `STOP-WHATSAPP.bat` gestoppt werden.

Lokale Sitzungsdaten und das Versandjournal liegen unter `services/whatsapp-bridge/data/` und sind von Git ausgeschlossen. Sie dürfen nicht geteilt werden.

## Versand-Sicherheit

Vercel validiert Kontaktstatus, Zustimmung, KI-Regeln und Stop-Schalter, bevor eine Nachricht auf `sending` gesetzt wird. Der Laptop zieht nur solche validierten Aufträge. Vor dem tatsächlichen Senden prüft der Server den Kontaktstatus erneut. Der lokale Worker führt zusätzlich ein dauerhaftes Versandjournal. Ein Vorgang, dessen Zustand nach einem Absturz unklar ist, wird **nicht** automatisch wiederholt.

Manuell vom verknüpften WhatsApp-Handy gesendete Nachrichten werden für bereits im CRM zugeordnete 1:1-Kontakte in die gemeinsame Timeline gespiegelt. Gruppen, Broadcasts, Newsletter und fremde private Chats werden ignoriert. Beim ersten Verbinden wird bewusst keine alte Chat-Historie automatisch importiert, damit historische Nachrichten keine neue KI-Antwort auslösen.

Baileys ist eine inoffizielle WhatsApp-Web-Anbindung. Deshalb gibt es keine technische Garantie gegen Kontoeinschränkungen. Das System enthält keine Tricks zur Umgehung von Spam-Erkennung; die Schutzschicht besteht aus Zustimmung, manueller Freigabe, Limits, Abstand, Opt-out und Kill-Switch. Für größere Volumen sollte die offizielle WhatsApp Business Platform verwendet werden.

## Verifikation

Root-Anwendung:

```sh
npm run typecheck
npm run test:whatsapp
```

Windows-Worker:

```sh
cd services/whatsapp-bridge
npm install
npm test
```
''')

# Sanity checks so the workflow fails instead of committing half a migration.
service_text = (ROOT / 'lib/whatsapp/service.ts').read_text(encoding='utf-8')
if 'bridgeConfigured' in service_text or 'sendThroughBridge' in service_text or 'deliveryStatus(' in service_text:
    raise SystemExit('Legacy external bridge calls remain in service.ts')
if '@open-wa/wa-automate' in (service / 'package.json').read_text(encoding='utf-8'):
    raise SystemExit('OpenWA dependency still present')
print('Baileys Windows laptop upgrade applied.')
