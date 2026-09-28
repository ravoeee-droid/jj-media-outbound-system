import { z } from "zod";
import { apiError, requirePermission } from "@/lib/workspace";
import { generatePersonalization, getPersonalization, updatePersonalization } from "@/lib/personalization-engine";

const updateSchema = z.object({
  leadId: z.string().uuid(),
  action: z.enum(["generate","update","toggle_lock","approve"]),
  field: z.string().optional(),
  value: z.string().optional(),
});

export async function GET(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const leadId = new URL(request.url).searchParams.get("leadId");
    if (!leadId) return Response.json({ error: "Lead-ID fehlt." }, { status: 400 });
    return Response.json({ personalization: await getPersonalization(workspace.workspaceId, leadId) });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const input = updateSchema.parse(await request.json());
    if (input.action === "generate") {
      return Response.json({ personalization: await generatePersonalization(workspace.workspaceId, input.leadId) });
    }
    const current = await getPersonalization(workspace.workspaceId, input.leadId) || await generatePersonalization(workspace.workspaceId, input.leadId);
    if (input.action === "approve") {
      return Response.json({ personalization: await updatePersonalization(workspace.workspaceId, input.leadId, { status: "approved" }) });
    }
    if (input.action === "toggle_lock" && input.field) {
      const locked = new Set(current.lockedFields);
      locked.has(input.field) ? locked.delete(input.field) : locked.add(input.field);
      return Response.json({ personalization: await updatePersonalization(workspace.workspaceId, input.leadId, { lockedFields: [...locked] }) });
    }
    if (input.action === "update" && input.field && typeof input.value === "string") {
      if (!["angle","hook","subject","emailBody","landingEyebrow","landingHeadline","landingSubheadline","videoHook","cta"].includes(input.field)) {
        return Response.json({ error: "Feld nicht bearbeitbar." }, { status: 400 });
      }
      return Response.json({ personalization: await updatePersonalization(workspace.workspaceId, input.leadId, { [input.field]: input.value }) });
    }
    return Response.json({ error: "Aktion unvollständig." }, { status: 400 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Personalisierungs-Anfrage." }, { status: 400 });
    return apiError(error);
  }
}
