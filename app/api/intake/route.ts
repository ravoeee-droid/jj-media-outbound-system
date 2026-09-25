import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { users, workspaceMembers } from "@/db/schema";
import { commitLeadIntake, prepareLeadIntake } from "@/lib/lead-intake";
import { hasPermission } from "@/lib/team";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 120;

const previewInput = z.object({
  mode: z.literal("preview"),
  raw: z.unknown(),
  source: z.string().trim().max(180).optional().default("Lead Intake"),
});

const commitInput = z.object({
  mode: z.literal("commit"),
  raw: z.unknown(),
  source: z.string().trim().max(180).optional().default("Lead Intake"),
  selectedIntakeIds: z.array(z.string().min(3).max(500)).min(1).max(30),
  ownerId: z.string().uuid().nullable().optional(),
});

const inputSchema = z.discriminatedUnion("mode", [previewInput, commitInput]);

async function activeMembers(workspaceId: string) {
  return getDb()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: workspaceMembers.role,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.status, "active")));
}

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const input = inputSchema.parse(await request.json());
    const canViewAll = hasPermission(workspace.role, workspace.permissions, "view_all_leads");

    if (input.mode === "preview") {
      const [preview, members] = await Promise.all([
        prepareLeadIntake(workspace.workspaceId, input.raw),
        activeMembers(workspace.workspaceId),
      ]);

      return Response.json({
        source: input.source,
        sourceCount: preview.sourceCount,
        normalizedCount: preview.normalizedCount,
        mergedInsideImport: preview.mergedInsideImport,
        discarded: preview.discarded,
        decisions: preview.decisions,
        permissions: { canViewAll },
        currentUser: {
          id: workspace.user.id,
          name: workspace.user.name,
          email: workspace.user.email,
        },
        members: canViewAll
          ? members.map((member) => ({
              userId: member.userId,
              name: member.name || member.email || "Mitarbeiter",
              role: member.role,
            }))
          : [],
      });
    }

    let ownerId: string | null;
    if (!canViewAll) {
      ownerId = workspace.user.id;
    } else if (input.ownerId === undefined) {
      ownerId = workspace.user.id;
    } else {
      ownerId = input.ownerId;
    }

    if (ownerId) {
      const [member] = await getDb()
        .select({ userId: workspaceMembers.userId })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(and(
          eq(workspaceMembers.workspaceId, workspace.workspaceId),
          eq(workspaceMembers.userId, ownerId),
          eq(users.status, "active"),
        ))
        .limit(1);
      if (!member) {
        return Response.json({ error: "Der gewählte Mitarbeiter ist nicht aktiv oder gehört nicht zum Workspace." }, { status: 400 });
      }
    }

    const result = await commitLeadIntake({
      workspaceId: workspace.workspaceId,
      userId: workspace.user.id,
      raw: input.raw,
      selectedIntakeIds: [...new Set(input.selectedIntakeIds)],
      source: input.source,
      ownerId,
    });

    return Response.json({
      ok: true,
      ownerId,
      created: result.created,
      updated: result.updated,
      processed: result.leadIds.length,
      leadIds: result.leadIds,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Die Intake-Anfrage ist ungültig.", issues: error.issues }, { status: 400 });
    }
    return apiError(error);
  }
}
