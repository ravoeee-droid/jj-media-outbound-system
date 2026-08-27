import { and, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { campaigns, leads } from "@/db/schema";
import { apiError, requireWorkspace } from "@/lib/workspace";

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();
    const [campaignRows, leadRows] = await Promise.all([
      getDb().select().from(campaigns).where(eq(campaigns.workspaceId, workspaceId)).orderBy(desc(campaigns.createdAt)),
      getDb().select({ campaignId: leads.campaignId, stage: leads.pipelineStage }).from(leads).where(eq(leads.workspaceId, workspaceId)),
    ]);
    return Response.json({
      campaigns: campaignRows.map((campaign) => {
        const assigned = leadRows.filter((lead) => lead.campaignId === campaign.id);
        return {
          ...campaign,
          leadCount: assigned.length,
          contacted: assigned.filter((lead) => ["contacted", "replied", "call_booked", "won"].includes(lead.stage)).length,
          booked: assigned.filter((lead) => ["call_booked", "won"].includes(lead.stage)).length,
        };
      }),
    });
  } catch (error) {
    return apiError(error);
  }
}

const campaignInput = z.object({
  name: z.string().trim().min(2).max(200),
  audience: z.string().trim().max(500).optional().default(""),
  channel: z.enum(["email", "phone", "linkedin", "mixed"]).optional().default("email"),
  dailyLimit: z.number().int().min(1).max(500).optional().default(25),
});

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = campaignInput.parse(await request.json());
    const [campaign] = await getDb()
      .insert(campaigns)
      .values({ workspaceId, ...input, status: "active" })
      .returning();
    return Response.json({ campaign }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Kampagne ist unvollständig." }, { status: 400 });
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = z
      .object({
        id: z.string().uuid(),
        status: z.enum(["draft", "active", "paused", "completed"]).optional(),
        name: z.string().trim().min(2).max(200).optional(),
      })
      .parse(await request.json());
    const [campaign] = await getDb()
      .update(campaigns)
      .set({ ...(input.status ? { status: input.status } : {}), ...(input.name ? { name: input.name } : {}), updatedAt: new Date() })
      .where(and(eq(campaigns.id, input.id), eq(campaigns.workspaceId, workspaceId)))
      .returning();
    if (!campaign) return Response.json({ error: "Kampagne nicht gefunden." }, { status: 404 });
    return Response.json({ campaign });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Kampagne." }, { status: 400 });
    return apiError(error);
  }
}
