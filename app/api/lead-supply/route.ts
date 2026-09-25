import { z } from "zod";
import {
  getLeadSupplyConfig,
  getLeadSupplyLastRun,
  listAssignableCallers,
  normalizeLeadSupplyConfig,
  runLeadSupply,
  saveLeadSupplyConfig,
} from "@/lib/lead-supply";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const configSchema = z.object({
  enabled: z.boolean(),
  queueTarget: z.number().int().min(10).max(60),
  assigneeIds: z.array(z.string().uuid()).max(20),
});

export async function GET() {
  try {
    const workspace = await requirePermission("manage_leads");
    const [config, callers, lastRun] = await Promise.all([
      getLeadSupplyConfig(workspace.workspaceId),
      listAssignableCallers(workspace.workspaceId),
      getLeadSupplyLastRun(workspace.workspaceId),
    ]);
    return Response.json({ config, callers, lastRun }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const input = configSchema.parse(await request.json());
    const callers = await listAssignableCallers(workspace.workspaceId);
    const allowed = new Set(callers.map((caller) => caller.userId));
    const invalid = input.assigneeIds.filter((id) => !allowed.has(id));
    if (invalid.length) {
      return Response.json({ error: "Mindestens ein ausgewählter Mitarbeiter ist nicht für Call-Queues freigegeben." }, { status: 409 });
    }
    if (input.enabled && !input.assigneeIds.length) {
      return Response.json({ error: "Bitte mindestens einen Mitarbeiter für den Auto-Nachschub auswählen." }, { status: 400 });
    }
    const config = await saveLeadSupplyConfig(workspace.workspaceId, normalizeLeadSupplyConfig(input));
    return Response.json({ ok: true, config });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Auto-Nachschub-Einstellungen sind ungültig.", issues: error.issues }, { status: 400 });
    }
    return apiError(error);
  }
}

export async function POST() {
  try {
    const workspace = await requirePermission("manage_leads");
    const config = await getLeadSupplyConfig(workspace.workspaceId);
    if (!config.assigneeIds.length) {
      return Response.json({ error: "Bitte zuerst mindestens einen Mitarbeiter auswählen." }, { status: 409 });
    }
    const result = await runLeadSupply(workspace.workspaceId, { enabled: true });
    return Response.json(result);
  } catch (error) {
    return apiError(error);
  }
}
