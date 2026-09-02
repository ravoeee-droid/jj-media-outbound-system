import { z } from "zod";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { workspaces } from "@/db/schema";
import { verifyWebhook } from "@/lib/whatsapp/provider";
import { receiveMessage, receiveReceipt, runWhatsappTick } from "@/lib/whatsapp/service";

export const runtime = "nodejs";
export const maxDuration = 120;

const eventSchema = z.discriminatedUnion("event", [
  z.object({ event: z.literal("message"), workspaceId: z.string().uuid(), id: z.string().min(1).max(200), phone: z.string().max(40), body: z.string().max(8_000), kind: z.enum(["text", "image", "audio", "document", "video", "other"]), timestamp: z.string().datetime(), fromMe: z.boolean().optional() }),
  z.object({ event: z.literal("receipt"), workspaceId: z.string().uuid(), providerId: z.string().min(1).max(200), status: z.enum(["sent", "delivered", "read"]) }),
  z.object({ event: z.literal("tick"), workspaceId: z.string().uuid() }),
]);

export async function POST(request: Request) {
  if (Number(request.headers.get("content-length") || 0) > 24_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
  const raw = await request.text();
  if (raw.length > 24_000) return Response.json({ error: "payload_too_large" }, { status: 413 });
  if (!verifyWebhook(raw, request.headers.get("x-jj-timestamp"), request.headers.get("x-jj-signature"))) return Response.json({ error: "unauthorized" }, { status: 401 });
  let input: z.infer<typeof eventSchema>;
  try { input = eventSchema.parse(JSON.parse(raw)); } catch { return Response.json({ error: "invalid_event" }, { status: 400 }); }
  // A bridge may only address the configured JJ workspace.
  if (!process.env.WHATSAPP_WORKSPACE_ID || input.workspaceId !== process.env.WHATSAPP_WORKSPACE_ID) return Response.json({ error: "workspace_mismatch" }, { status: 403 });
  try {
    const [workspace] = await getDb().select({ id: workspaces.id }).from(workspaces).where(eq(workspaces.id, input.workspaceId)).limit(1);
    if (!workspace) return Response.json({ error: "not_found" }, { status: 404 });
    if (input.event === "receipt") { await receiveReceipt(input.workspaceId, input.providerId, input.status); return Response.json({ ok: true }); }
    if (input.event === "tick") return Response.json(await runWhatsappTick(input.workspaceId));
    return Response.json(await receiveMessage(input.workspaceId, input));
  } catch { return Response.json({ error: "processing_failed" }, { status: 503 }); }
}
