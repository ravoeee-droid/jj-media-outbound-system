import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, leads } from "@/db/schema";
import { apiError, requireWorkspace } from "@/lib/workspace";

const allowedStages = ["new", "qualified", "contact_ready", "contacted", "replied", "call_booked", "won", "lost"] as const;
const updateInput = z.object({
  id: z.string().uuid(),
  pipelineStage: z.enum(allowedStages).optional(),
  contact: z.string().max(200).optional(),
  email: z.string().max(320).optional(),
  phone: z.string().max(80).optional(),
  notes: z.string().max(20000).optional(),
  objection: z.string().max(4000).optional(),
  pitch: z.string().max(10000).optional(),
  recommendedOffer: z.string().max(1000).optional(),
  dealValue: z.number().int().min(0).max(10000000).optional(),
  probability: z.number().int().min(0).max(100).optional(),
  nextFollowUpAt: z.string().datetime().nullable().optional(),
});

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();
    const rows = await getDb()
      .select()
      .from(leads)
      .where(eq(leads.workspaceId, workspaceId))
      .orderBy(desc(leads.salesPriority), desc(leads.updatedAt))
      .limit(1000);
    return Response.json({ leads: rows });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const input = updateInput.parse(await request.json());
    const updates: Partial<typeof leads.$inferInsert> = {
      updatedAt: new Date(),
      ...(input.pipelineStage ? { pipelineStage: input.pipelineStage } : {}),
      ...(input.contact !== undefined ? { contact: input.contact.trim() } : {}),
      ...(input.email !== undefined ? { email: input.email.trim() } : {}),
      ...(input.phone !== undefined ? { phone: input.phone.trim() } : {}),
      ...(input.notes !== undefined ? { notes: input.notes } : {}),
      ...(input.objection !== undefined ? { objection: input.objection } : {}),
      ...(input.pitch !== undefined ? { pitch: input.pitch } : {}),
      ...(input.recommendedOffer !== undefined ? { recommendedOffer: input.recommendedOffer } : {}),
      ...(input.dealValue !== undefined ? { dealValue: input.dealValue } : {}),
      ...(input.probability !== undefined ? { probability: input.probability } : {}),
      ...(input.nextFollowUpAt !== undefined
        ? { nextFollowUpAt: input.nextFollowUpAt ? new Date(input.nextFollowUpAt) : null }
        : {}),
    };
    const [lead] = await getDb()
      .update(leads)
      .set(updates)
      .where(and(eq(leads.id, input.id), eq(leads.workspaceId, workspace.workspaceId)))
      .returning();
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    if (input.pipelineStage) {
      await getDb().insert(activities).values({
        workspaceId: workspace.workspaceId,
        leadId: lead.id,
        userId: workspace.user.id,
        type: "stage_changed",
        title: `Pipeline: ${input.pipelineStage}`,
        detail: "Status im CRM geändert.",
      });
    }
    return Response.json({ lead });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige CRM-Daten.", issues: error.issues }, { status: 400 });
    return apiError(error);
  }
}
