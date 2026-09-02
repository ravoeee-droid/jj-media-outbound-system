import { createHmac, timingSafeEqual } from "node:crypto";

export function verifyWebhook(raw: string, timestamp: string | null, signature: string | null, secret = process.env.WHATSAPP_WEBHOOK_SECRET) {
  if (!secret || secret.length < 32 || !timestamp || !signature || !/^\d+$/.test(timestamp)) return false;
  if (Math.abs(Date.now() - Number(timestamp)) > 5 * 60_000) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  if (!/^[a-f0-9]{64}$/i.test(signature)) return false;
  return timingSafeEqual(Buffer.from(expected, "hex"), Buffer.from(signature, "hex"));
}
