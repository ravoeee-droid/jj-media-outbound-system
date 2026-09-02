import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { settings } from "@/db/schema";

const STATUS_KEY = "jj_whatsapp_worker_status";
const HEARTBEAT_MAX_AGE_MS = 75_000;

type WorkerStatus = { connected?: boolean; phone?: string; qr?: string; workerId?: string; version?: string; updatedAt?: string };

export async function getBridgeStatus(workspaceId: string) {
  const [row] = await getDb().select({ value: settings.value, updatedAt: settings.updatedAt }).from(settings).where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, STATUS_KEY))).limit(1);
  if (!row) return { configured: false, connected: false, message: "WhatsApp-Laptop noch nicht eingerichtet", phone: "", qr: "" };
  let value: WorkerStatus = {};
  try { value = JSON.parse(row.value) as WorkerStatus; } catch { /* malformed status is offline */ }
  const stamp = Date.parse(value.updatedAt || row.updatedAt.toISOString());
  const fresh = Number.isFinite(stamp) && Date.now() - stamp < HEARTBEAT_MAX_AGE_MS;
  const connected = fresh && value.connected === true;
  return { configured: true, connected, phone: value.phone || "", qr: fresh && typeof value.qr === "string" ? value.qr : "", message: connected ? "WhatsApp über den lokalen Laptop verbunden" : fresh && value.qr ? "QR-Code mit WhatsApp scannen" : "WhatsApp-Laptop starten" };
}
