import { z } from "zod";
import { apiError, requirePermission } from "@/lib/workspace";
import { getLeadIntelligence, refreshLeadIntelligence } from "@/lib/acquisition-intelligence";

export const runtime = "nodejs";

const inputSchema = z.object({ leadId: z.string().uuid() });

export async function GET(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const leadId = new URL(request.url).searchParams.get("leadId");
    if (!leadId) return Response.json({ error: "Lead-ID fehlt." }, { status: 400 });
    return Response.json(await getLeadIntelligence({ workspaceId: workspace.workspaceId, leadId }));
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const input = inputSchema.parse(await request.json());
    return Response.json(await refreshLeadIntelligence({ workspaceId: workspace.workspaceId, leadId: input.leadId }));
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Intelligence-Anfrage." }, { status: 400 });
    return apiError(error);
  }
}
