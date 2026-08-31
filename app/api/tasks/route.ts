import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { leads, tasks } from "@/db/schema";
import { apiError, requireWorkspace } from "@/lib/workspace";

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();
    const rows = await getDb()
      .select({
        id: tasks.id,
        leadId: tasks.leadId,
        title: tasks.title,
        dueAt: tasks.dueAt,
        status: tasks.status,
        priority: tasks.priority,
        type: tasks.type,
        company: leads.company,
      })
      .from(tasks)
      .leftJoin(leads, eq(tasks.leadId, leads.id))
      .where(eq(tasks.workspaceId, workspaceId))
      .orderBy(asc(tasks.dueAt))
      .limit(500);
    return Response.json({ tasks: rows });
  } catch (error) {
    return apiError(error);
  }
}

const taskUpdate = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "done", "dismissed"]),
});

export async function PUT(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = taskUpdate.parse(await request.json());
    const [task] = await getDb()
      .update(tasks)
      .set({ status: input.status, updatedAt: new Date() })
      .where(and(eq(tasks.id, input.id), eq(tasks.workspaceId, workspaceId)))
      .returning();
    if (!task) return Response.json({ error: "Aufgabe nicht gefunden." }, { status: 404 });
    return Response.json({ task });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Aufgabe." }, { status: 400 });
    return apiError(error);
  }
}
