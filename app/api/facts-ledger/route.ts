import { z } from "zod";
import { apiError, requirePermission } from "@/lib/workspace";
import { buildClaimContext, listFactsForLead, reviewFact } from "@/lib/facts-ledger";

export const runtime = "nodejs";

const reviewSchema = z.object({
  leadId: z.string().uuid(),
  factId: z.string().uuid(),
  action: z.enum(["approve", "reject", "toggle_lock"]),
});

export async function GET(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const leadId = new URL(request.url).searchParams.get("leadId");
    if (!leadId) return Response.json({ error: "Lead-ID fehlt." }, { status: 400 });
    const [facts, context] = await Promise.all([
      listFactsForLead(workspace.workspaceId, leadId),
      buildClaimContext(workspace.workspaceId, leadId),
    ]);
    return Response.json({ facts, context }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const input = reviewSchema.parse(await request.json());
    const fact = await reviewFact({
      workspace: workspace.workspaceId,
      leadId: input.leadId,
      factId: input.factId,
      action: input.action,
      reviewer: workspace.user.id,
    });
    return Response.json({ ok: true, fact });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Facts-Ledger-Anfrage." }, { status: 400 });
    return apiError(error);
  }
}
