import { z } from "zod";
import { draftReply } from "@/lib/whatsapp/ai";
import { getAgentConfig, saveAgentConfig, withLease } from "@/lib/whatsapp/config";
import { limitedJson, whatsappError, whatsappWorkspace } from "@/lib/whatsapp/http";
import { agentConfigSchema } from "@/lib/whatsapp/policy";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

export async function GET() {
  try { const { workspaceId } = await whatsappWorkspace(); return Response.json({ config: await getAgentConfig(workspaceId) }); }
  catch (error) { return whatsappError(error); }
}
export async function PUT(request: Request) {
  try { const { workspaceId } = await whatsappWorkspace(); return Response.json({ config: await saveAgentConfig(workspaceId, await limitedJson(request)) }); }
  catch (error) { return whatsappError(error); }
}
export async function POST(request: Request) {
  try {
    const { workspaceId } = await whatsappWorkspace();
    const input = z.object({ config: agentConfigSchema, history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().min(1).max(3_000) })).min(1).max(20) }).parse(await limitedJson(request));
    // Sandbox: no lead mutations, sends, bookings or scheduled work are executed.
    const decision = await withLease(workspaceId, "agent-test", () => draftReply({ workspaceId, config: input.config, history: input.history, lead: { company: "Testunternehmen", context: "Interner Testchat. Keine echten Aktionen ausführen." } }));
    return Response.json({ decision, simulation: true, configVersion: input.config.version });
  } catch (error) { return whatsappError(error); }
}
