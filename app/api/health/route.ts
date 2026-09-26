import { getSystemReadiness } from "@/lib/system-readiness";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(request: Request) {
  try {
    const workspace = await requirePermission("manage_settings");
    const url = new URL(request.url);
    const deep = url.searchParams.get("deep") === "1";
    const payload = await getSystemReadiness(workspace.workspaceId, deep);
    return Response.json(payload, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
