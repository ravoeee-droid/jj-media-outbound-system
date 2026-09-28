import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import {
  acquisitionLeadControls,
  acquisitionWorkspaceControls,
  bookings,
  leads,
  outreach,
} from "@/db/schema";
import { apiError, requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

const MODES = ["manual", "copilot", "autopilot"] as const;
const STEP_KEYS = [
  "research",
  "enrichment",
  "validation",
  "scoring",
  "angle",
  "screenshot",
  "video",
  "landing",
  "email",
  "sequence",
  "reply",
  "booking",
  "attribution",
] as const;

const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("set_workspace_mode"), mode: z.enum(MODES) }),
  z.object({ action: z.literal("set_lead_mode"), leadId: z.string().uuid(), mode: z.enum(MODES).nullable() }),
  z.object({ action: z.literal("toggle_lock"), leadId: z.string().uuid(), step: z.enum(STEP_KEYS) }),
  z.object({ action: z.literal("toggle_skip"), leadId: z.string().uuid(), step: z.enum(STEP_KEYS) }),
  z.object({ action: z.literal("set_current_step"), leadId: z.string().uuid(), step: z.enum(STEP_KEYS) }),
]);

function stepStatus(lead: typeof leads.$inferSelect, outreachCount: number, bookingCount: number) {
  const hasAngle = Boolean(lead.pitch.trim() || lead.recommendedOffer.trim());
  const statuses: Record<(typeof STEP_KEYS)[number], "done" | "ready" | "open" | "blocked"> = {
    research: lead.researchStatus === "enriched" ? "done" : "open",
    enrichment: lead.researchStatus === "enriched" ? "done" : "ready",
    validation: lead.validationStatus === "validated" ? "done" : lead.email || lead.phone ? "ready" : "open",
    scoring: lead.analysisStatus === "ready" || lead.salesPriority > 0 ? "done" : "ready",
    angle: hasAngle ? "done" : lead.analysisStatus === "ready" ? "ready" : "open",
    screenshot: lead.scrollVideoUrl ? "done" : lead.instagramUrl ? "ready" : "blocked",
    video: lead.videoStatus === "ready" ? "done" : lead.scrollVideoUrl ? "ready" : "blocked",
    landing: lead.landingPath ? (lead.videoStatus === "ready" ? "done" : "ready") : "open",
    email: ["sent", "replied"].includes(lead.emailStatus) ? "done" : lead.email ? "ready" : "blocked",
    sequence: outreachCount > 1 ? "done" : outreachCount === 1 ? "ready" : "open",
    reply: ["replied", "call_booked", "won"].includes(lead.pipelineStage) ? "done" : lead.emailStatus === "sent" ? "ready" : "open",
    booking: bookingCount > 0 || ["call_booked", "won"].includes(lead.pipelineStage) ? "done" : lead.pipelineStage === "replied" ? "ready" : "open",
    attribution: lead.pipelineStage === "won" || lead.dealValue > 0 ? "done" : lead.pipelineStage === "call_booked" ? "ready" : "open",
  };
  return statuses;
}

async function getWorkspaceControl(workspaceId: string) {
  const db = getDb();
  const [existing] = await db.select().from(acquisitionWorkspaceControls).where(eq(acquisitionWorkspaceControls.workspaceId, workspaceId)).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(acquisitionWorkspaceControls).values({ workspaceId }).returning();
  return created;
}

async function getLeadControl(workspaceId: string, leadId: string) {
  const db = getDb();
  const [existing] = await db.select().from(acquisitionLeadControls)
    .where(and(eq(acquisitionLeadControls.workspaceId, workspaceId), eq(acquisitionLeadControls.leadId, leadId))).limit(1);
  if (existing) return existing;
  const [created] = await db.insert(acquisitionLeadControls).values({ workspaceId, leadId }).returning();
  return created;
}

export async function GET(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const url = new URL(request.url);
    const leadId = url.searchParams.get("leadId");
    const workspaceControl = await getWorkspaceControl(workspaceId);
    if (!leadId) return Response.json({ workspace: workspaceControl, steps: STEP_KEYS });

    const db = getDb();
    const [lead] = await db.select().from(leads)
      .where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId))).limit(1);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });

    const [leadControl, outreachRows, bookingRows] = await Promise.all([
      getLeadControl(workspaceId, leadId),
      db.select({ id: outreach.id }).from(outreach).where(and(eq(outreach.workspaceId, workspaceId), eq(outreach.leadId, leadId))),
      db.select({ id: bookings.id }).from(bookings).where(eq(bookings.leadId, leadId)),
    ]);
    const statuses = stepStatus(lead, outreachRows.length, bookingRows.length);
    const effectiveMode = leadControl.modeOverride || workspaceControl.mode;
    const firstOpen = STEP_KEYS.find((step) => !leadControl.skippedSteps.includes(step) && statuses[step] !== "done" && statuses[step] !== "blocked") || "research";

    return Response.json({
      workspace: workspaceControl,
      control: leadControl,
      effectiveMode,
      recommendedStep: firstOpen,
      steps: STEP_KEYS.map((key) => ({
        key,
        status: leadControl.skippedSteps.includes(key) ? "skipped" : statuses[key],
        locked: leadControl.lockedSteps.includes(key),
      })),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  try {
    const { workspaceId, user } = await requireWorkspace();
    const input = inputSchema.parse(await request.json());
    const db = getDb();

    if (input.action === "set_workspace_mode") {
      const [row] = await db.insert(acquisitionWorkspaceControls)
        .values({ workspaceId, mode: input.mode })
        .onConflictDoUpdate({
          target: acquisitionWorkspaceControls.workspaceId,
          set: { mode: input.mode, updatedAt: new Date() },
        })
        .returning();
      return Response.json({ ok: true, workspace: row });
    }

    const [lead] = await db.select({ id: leads.id }).from(leads)
      .where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, input.leadId))).limit(1);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });

    const control = await getLeadControl(workspaceId, input.leadId);
    if (input.action === "set_lead_mode") {
      const [row] = await db.update(acquisitionLeadControls).set({
        modeOverride: input.mode,
        updatedById: user.id,
        updatedAt: new Date(),
      }).where(eq(acquisitionLeadControls.leadId, input.leadId)).returning();
      return Response.json({ ok: true, control: row });
    }

    if (input.action === "set_current_step") {
      const [row] = await db.update(acquisitionLeadControls).set({
        currentStep: input.step,
        updatedById: user.id,
        updatedAt: new Date(),
      }).where(eq(acquisitionLeadControls.leadId, input.leadId)).returning();
      return Response.json({ ok: true, control: row });
    }

    const field = input.action === "toggle_lock" ? "lockedSteps" : "skippedSteps";
    const current = control[field];
    const next = current.includes(input.step) ? current.filter((step) => step !== input.step) : [...current, input.step];
    const [row] = await db.update(acquisitionLeadControls).set({
      [field]: next,
      updatedById: user.id,
      updatedAt: new Date(),
    }).where(eq(acquisitionLeadControls.leadId, input.leadId)).returning();
    return Response.json({ ok: true, control: row });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Acquisition-Control-Anfrage." }, { status: 400 });
    return apiError(error);
  }
}
