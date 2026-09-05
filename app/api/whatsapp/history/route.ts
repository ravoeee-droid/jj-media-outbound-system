import { z } from "zod";
import { historyMessageSchema, historyOverview, ingestHistoryBatch, sweepHistoryIntelligence } from "@/lib/whatsapp/history";
import { limitedJson, whatsappError, whatsappWorkspace } from "@/lib/whatsapp/http";

export const runtime = "nodejs";
export const maxDuration = 120;
export const dynamic = "force-dynamic";

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("batch"), workerId: z.string().uuid(), messages: z.array(historyMessageSchema).max(200) }),
  z.object({ action: z.literal("sweep"), workerId: z.string().uuid().optional() }),
]);

export async function GET() {
  try {
    const workspace = await whatsappWorkspace();
    return Response.json(await historyOverview(workspace.workspaceId), { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return whatsappError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await whatsappWorkspace();
    const input = inputSchema.parse(await limitedJson(request, 1_800_000));
    if (input.action === "batch") {
      const result = await ingestHistoryBatch(workspace.workspaceId, input.messages);
      return Response.json({ ok: true, ...result });
    }
    return Response.json({ ok: true, ...(await sweepHistoryIntelligence(workspace.workspaceId)) });
  } catch (error) {
    return whatsappError(error);
  }
}
