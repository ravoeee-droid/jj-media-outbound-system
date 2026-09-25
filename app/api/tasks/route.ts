import { and, asc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { leads, tasks } from "@/db/schema";
import { hasPermission } from "@/lib/team";
import { apiError, requireWorkspace } from "@/lib/workspace";

export async function GET() {
  try {
    const workspace = await requireWorkspace();
    const { workspaceId } = workspace;
    const rows = await getDb()
      .select({
        id: tasks.id,
        leadId: tasks.leadId,
        assigneeId: tasks.assigneeId,
        title: tasks.title,
        dueAt: tasks.dueAt,
        status: tasks.status,
        priority: tasks.priority,
        type: tasks.type,
        company: leads.company,
      })
      .from(tasks)
      .leftJoin(leads, eq(tasks.leadId, leads.id))
      .where(and(
        eq(tasks.workspaceId, workspaceId),
        ...(hasPermission(workspace.role, workspace.permissions, "view_all_leads") ? [] : [eq(tasks.assigneeId, workspace.user.id)]),
      ))
      .orderBy(asc(tasks.dueAt))
      .limit(500);
    return Response.json({ tasks: rows });
  } catch (error) {
    return apiError(error);
  }
}

const taskUpdate = z.object({
  id: z.string().uuid(),
  status: z.enum(["open", "done", "dismissed"]).optional(),
  assigneeId: z.string().uuid().nullable().optional(),
}).refine((input) => input.status !== undefined || input.assigneeId !== undefined, {
  message: "Mindestens eine Änderung ist erforderlich.",
});

export async function PUT(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const { workspaceId } = workspace;
    const input = taskUpdate.parse(await request.json());
    if (input.assigneeId !== undefined && !hasPermission(workspace.role, workspace.permissions, "view_all_leads")) throw new Error("FORBIDDEN");
    const filters = [eq(tasks.id, input.id), eq(tasks.workspaceId, workspaceId)];
    if (!hasPermission(workspace.role, workspace.permissions, "view_all_leads")) filters.push(eq(tasks.assigneeId, workspace.user.id));
    const [task] = await getDb()
      .update(tasks)
      .set({
        ...(input.status !== undefined ? { status: input.status } : {}),
        ...(input.assigneeId !== undefined ? { assigneeId: input.assigneeId } : {}),
        updatedAt: new Date(),
      })
      .where(and(...filters))
      .returning();
    if (!task) return Response.json({ error: "Aufgabe nicht gefunden." }, { status: 404 });
    return Response.json({ task });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Aufgabe." }, { status: 400 });
    return apiError(error);
  }
}
