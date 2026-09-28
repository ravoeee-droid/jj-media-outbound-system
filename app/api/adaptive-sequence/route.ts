import { z } from "zod";
import { apiError, requirePermission } from "@/lib/workspace";
import { getSequence, refreshSequence, sequenceAction, startSequence } from "@/lib/adaptive-sequence";

const schema = z.object({
  leadId: z.string().uuid(),
  action: z.enum(["start","refresh","pause","resume","cancel","complete_step"]),
  stepId: z.string().uuid().optional(),
});

export async function GET(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const leadId = new URL(request.url).searchParams.get("leadId");
    if (!leadId) return Response.json({ error: "Lead-ID fehlt." }, { status: 400 });
    return Response.json(await getSequence(workspace.workspaceId, leadId), { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const input = schema.parse(await request.json());
    if (input.action === "start") return Response.json(await startSequence(workspace.workspaceId, input.leadId));
    if (input.action === "refresh") return Response.json(await refreshSequence(workspace.workspaceId, input.leadId));
    return Response.json(await sequenceAction(workspace.workspaceId, input.leadId, input.action, input.stepId));
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Sequence-Anfrage." }, { status: 400 });
    return apiError(error);
  }
}
