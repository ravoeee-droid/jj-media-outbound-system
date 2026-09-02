import { createHmac, timingSafeEqual } from "node:crypto";

export function bridgeConfigured() {
  return Boolean(process.env.WHATSAPP_BRIDGE_URL && (process.env.WHATSAPP_BRIDGE_KEY?.length ?? 0) >= 32 && (process.env.WHATSAPP_WEBHOOK_SECRET?.length ?? 0) >= 32 && process.env.WHATSAPP_WORKSPACE_ID);
}

async function bridge<T>(path: string, body?: unknown): Promise<T> {
  const base = process.env.WHATSAPP_BRIDGE_URL;
  const key = process.env.WHATSAPP_BRIDGE_KEY;
  if (!base || !key) throw new Error("WhatsApp ist noch nicht verbunden. Bitte zuerst die Verbindung einrichten.");
  const url = new URL(base);
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && url.hostname === "localhost")) throw new Error("Die WhatsApp-Verbindung benötigt HTTPS.");
  const response = await fetch(`${base.replace(/\/$/, "")}${path}`, {
    method: body ? "POST" : "GET",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store", signal: AbortSignal.timeout(body ? 25_000 : 8_000), redirect: "error",
  });
  if (!response.ok) throw new Error(`WhatsApp-Verbindung meldet einen Fehler (${response.status}). Versandstatus bitte prüfen.`);
  return response.json() as Promise<T>;
}

export async function getBridgeStatus() {
  if (!bridgeConfigured()) return { configured: false, connected: false, message: "WhatsApp-Verbindung einrichten", phone: "", qr: "" };
  try {
    const status = await bridge<{ connected: boolean; phone?: string; qr?: string; message?: string }>("/health");
    return { configured: true, connected: status.connected === true, phone: status.phone ?? "", qr: status.qr ?? "", message: status.connected ? "WhatsApp verbunden" : "WhatsApp am Smartphone verbinden" };
  } catch (error) { return { configured: true, connected: false, phone: "", qr: "", message: error instanceof Error ? error.message : "WhatsApp nicht erreichbar" }; }
}

export async function sendThroughBridge(input: { id: string; to: string; body: string; attachment?: { dataUrl: string; filename: string; mime: string } }) {
  const result = await bridge<{ providerId?: string; status?: string }>("/send", input);
  if (!result.providerId || result.status !== "sent") throw new Error("WhatsApp hat den Versand noch nicht eindeutig bestätigt. Bitte den Status prüfen, bevor Sie erneut senden.");
  return result.providerId;
}

export async function deliveryStatus(id: string) {
  return bridge<{ status: "sent" | "sending" | "unknown" | "not_found"; providerId?: string }>(`/status?id=${encodeURIComponent(id)}`);
}

export function verifyWebhook(raw: string, timestamp: string | null, signature: string | null, secret = process.env.WHATSAPP_WEBHOOK_SECRET) {
  if (!secret || secret.length < 32 || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}
