import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { jobs, leads } from "@/db/schema";
import { apiError, requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const url = new URL(request.url);
    const status = url.searchParams.get("status") || "all";
    const limit = Math.min(Math.max(Number(url.searchParams.get("limit")) || 250, 1), 500);
    const filters = [eq(jobs.workspaceId, workspaceId)];
    if (status !== "all") filters.push(eq(jobs.status, status));

    const rows = await getDb()
      .select({
        id: jobs.id,
        leadId: jobs.leadId,
        company: leads.company,
        type: jobs.type,
        status: jobs.status,
        attempts: jobs.attempts,
        progress: jobs.progress,
        error: jobs.error,
        scheduledAt: jobs.scheduledAt,
        startedAt: jobs.startedAt,
        finishedAt: jobs.finishedAt,
        createdAt: jobs.createdAt,
        updatedAt: jobs.updatedAt,
      })
      .from(jobs)
      .leftJoin(leads, eq(jobs.leadId, leads.id))
      .where(and(...filters))
      .orderBy(desc(jobs.createdAt))
      .limit(limit);

    return Response.json({ logs: rows }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}
