import { z } from "zod";
import { getManagerDashboard } from "@/lib/manager-dashboard";
import { apiError, requireWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const rangeSchema = z.coerce.number().pipe(z.union([z.literal(1), z.literal(7), z.literal(30)])).catch(1);

export async function GET(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const url = new URL(request.url);
    const range = rangeSchema.parse(url.searchParams.get("range") || "1");
    const data = await getManagerDashboard({
      workspaceId: workspace.workspaceId,
      currentUserId: workspace.user.id,
      role: workspace.role,
      permissions: workspace.permissions,
      range,
    });
    return Response.json(data, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
