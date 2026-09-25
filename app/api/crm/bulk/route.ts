import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, jobs, leads, users, workspaceMembers } from "@/db/schema";
import { analyzeLead, validateLead } from "@/lib/lead-workflow";
import { enrichLeadManually } from "@/lib/manual-lead-enrichment";
import { hasPermission } from "@/lib/team";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

const operations = ["assign_owner", "enrich", "validate", "analyze", "prepare_media"] as const;
type Operation = typeof operations[number];

const previewInput = z.object({
  mode: z.literal("preview"),
  operation: z.enum(operations),
  leadIds: z.array(z.string().uuid()).min(1).max(30),
  ownerId: z.string().uuid().nullable().optional(),
});

const executeInput = z.object({
  mode: z.literal("execute"),
  operation: z.enum(operations),
  leadIds: z.array(z.string().uuid()).min(1).max(10),
  ownerId: z.string().uuid().nullable().optional(),
});

const inputSchema = z.discriminatedUnion("mode", [previewInput, executeInput]);

type LeadRow = {
  id: string;
  company: string;
  ownerId: string | null;
  pipelineStage: string;
  researchStatus: string;
  validationStatus: string;
  analysisStatus: string;
  contactLocked: boolean;
  email: string;
  phone: string;
  instagramUrl: string;
  scrollVideoUrl: string | null;
  videoStatus: string;
};

type Decision = {
  leadId: string;
  company: string;
  eligible: boolean;
  reason: string;
};

function operationLabel(operation: Operation) {
  if (operation === "assign_owner") return "Owner zuweisen";
  if (operation === "enrich") return "Enrichen";
  if (operation === "validate") return "Validieren";
  if (operation === "analyze") return "Analysieren";
  return "Screenshot vorbereiten";
}

function decisionFor(operation: Operation, lead: LeadRow, ownerId?: string | null): Decision {
  if (operation === "assign_owner") {
    if (lead.ownerId === (ownerId || null)) {
      return { leadId: lead.id, company: lead.company, eligible: false, reason: "Bereits diesem Owner zugeordnet." };
    }
    return { leadId: lead.id, company: lead.company, eligible: true, reason: "Kann neu zugewiesen werden." };
  }

  if (lead.contactLocked || ["lost", "won"].includes(lead.pipelineStage)) {
    return { leadId: lead.id, company: lead.company, eligible: false, reason: "Lead ist abgeschlossen oder für Kontakt gesperrt." };
  }

  if (operation === "enrich") {
    if (lead.researchStatus === "enriched" && (lead.email || lead.phone)) {
      return { leadId: lead.id, company: lead.company, eligible: false, reason: "Bereits enriched und mit Kontaktweg." };
    }
    return { leadId: lead.id, company: lead.company, eligible: true, reason: "Recherche kann ergänzt werden." };
  }

  if (operation === "validate") {
    if (lead.validationStatus === "validated") {
      return { leadId: lead.id, company: lead.company, eligible: false, reason: "Bereits validiert." };
    }
    return { leadId: lead.id, company: lead.company, eligible: true, reason: lead.email || lead.phone ? "Direkter Kontaktweg vorhanden." : "Validierung entscheidet über Nachrecherche." };
  }

  if (operation === "analyze") {
    if (lead.analysisStatus === "ready") {
      return { leadId: lead.id, company: lead.company, eligible: false, reason: "Analyse ist bereits aktuell." };
    }
    return { leadId: lead.id, company: lead.company, eligible: true, reason: "Readiness und Priorität können berechnet werden." };
  }

  if (!lead.instagramUrl) {
    return { leadId: lead.id, company: lead.company, eligible: false, reason: "Instagram-Profil fehlt." };
  }
  if (lead.scrollVideoUrl) {
    return { leadId: lead.id, company: lead.company, eligible: false, reason: "Profil-Screenshot ist bereits vorhanden." };
  }
  if (lead.videoStatus === "ready") {
    return { leadId: lead.id, company: lead.company, eligible: false, reason: "Persönliches Video ist bereits fertig." };
  }
  return { leadId: lead.id, company: lead.company, eligible: true, reason: "Kann in die Medien-Queue." };
}

async function processWithConcurrency<T, R>(items: T[], concurrency: number, worker: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let cursor = 0;
  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor++;
      results[index] = await worker(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const input = inputSchema.parse(await request.json());
    const db = getDb();
    const leadIds = [...new Set(input.leadIds)];

    const canViewAll = hasPermission(workspace.role, workspace.permissions, "view_all_leads");
    if (input.operation === "assign_owner" && input.ownerId === undefined) {
      return Response.json({ error: "Für die Zuweisung muss ein Ziel-Owner angegeben werden." }, { status: 400 });
    }
    if (input.operation === "assign_owner" && !canViewAll) throw new Error("FORBIDDEN");
    if (input.operation === "prepare_media" && !hasPermission(workspace.role, workspace.permissions, "generate_video")) {
      throw new Error("FORBIDDEN");
    }

    if (input.operation === "assign_owner" && input.ownerId) {
      const [member] = await db
        .select({ userId: users.id, status: users.status })
        .from(workspaceMembers)
        .innerJoin(users, eq(users.id, workspaceMembers.userId))
        .where(and(
          eq(workspaceMembers.workspaceId, workspace.workspaceId),
          eq(workspaceMembers.userId, input.ownerId),
          eq(users.status, "active"),
        ))
        .limit(1);
      if (!member) return Response.json({ error: "Der gewählte Mitarbeiter ist nicht aktiv oder gehört nicht zum Workspace." }, { status: 400 });
    }

    const rows = await db
      .select({
        id: leads.id,
        company: leads.company,
        ownerId: leads.ownerId,
        pipelineStage: leads.pipelineStage,
        researchStatus: leads.researchStatus,
        validationStatus: leads.validationStatus,
        analysisStatus: leads.analysisStatus,
        contactLocked: leads.contactLocked,
        email: leads.email,
        phone: leads.phone,
        instagramUrl: leads.instagramUrl,
        scrollVideoUrl: leads.scrollVideoUrl,
        videoStatus: leads.videoStatus,
      })
      .from(leads)
      .where(and(
        eq(leads.workspaceId, workspace.workspaceId),
        inArray(leads.id, leadIds),
        ...(canViewAll ? [] : [eq(leads.ownerId, workspace.user.id)]),
      ));

    const byId = new Map(rows.map((lead) => [lead.id, lead]));
    const decisions: Decision[] = leadIds.map((leadId) => {
      const lead = byId.get(leadId);
      if (!lead) return { leadId, company: "Nicht verfügbar", eligible: false, reason: "Lead ist nicht zugänglich." };
      return decisionFor(input.operation, lead, input.ownerId);
    });

    const eligibleIds = decisions.filter((item) => item.eligible).map((item) => item.leadId);

    if (input.mode === "preview") {
      return Response.json({
        operation: input.operation,
        label: operationLabel(input.operation),
        selected: leadIds.length,
        eligible: eligibleIds.length,
        skipped: decisions.length - eligibleIds.length,
        decisions,
        execution: {
          chunkSize: input.operation === "enrich" ? 5 : 10,
          heavy: input.operation === "enrich" || input.operation === "prepare_media",
        },
      });
    }

    if (!eligibleIds.length) {
      return Response.json({ operation: input.operation, processed: 0, succeeded: 0, failed: 0, results: [] });
    }

    if (input.operation === "assign_owner") {
      await db
        .update(leads)
        .set({ ownerId: input.ownerId || null, assignedAt: new Date(), updatedAt: new Date() })
        .where(and(eq(leads.workspaceId, workspace.workspaceId), inArray(leads.id, eligibleIds)));

      await db.insert(activities).values(eligibleIds.map((leadId) => ({
        workspaceId: workspace.workspaceId,
        leadId,
        userId: workspace.user.id,
        type: "owner_changed_bulk",
        title: input.ownerId ? "Lead im Power-Modus zugewiesen" : "Lead im Power-Modus auf unzugeordnet gesetzt",
        detail: "",
      })));

      return Response.json({
        operation: input.operation,
        processed: eligibleIds.length,
        succeeded: eligibleIds.length,
        failed: 0,
        results: eligibleIds.map((leadId) => ({ leadId, ok: true })),
      });
    }

    if (input.operation === "prepare_media") {
      const existingJobs = await db
        .select({ leadId: jobs.leadId })
        .from(jobs)
        .where(and(
          eq(jobs.workspaceId, workspace.workspaceId),
          eq(jobs.type, "profile_capture_prepare"),
          inArray(jobs.leadId, eligibleIds),
          inArray(jobs.status, ["queued", "running"]),
        ));
      const queued = new Set(existingJobs.map((job) => job.leadId).filter(Boolean));
      const toQueue = eligibleIds.filter((leadId) => !queued.has(leadId));

      if (toQueue.length) {
        await Promise.all([
          db.insert(jobs).values(toQueue.map((leadId) => ({
            workspaceId: workspace.workspaceId,
            leadId,
            type: "profile_capture_prepare",
            status: "queued",
            attempts: 0,
            progress: 0,
          }))),
          db.update(leads)
            .set({ videoStatus: "queued", nextAction: "screenshot", updatedAt: new Date() })
            .where(and(eq(leads.workspaceId, workspace.workspaceId), inArray(leads.id, toQueue))),
          db.insert(activities).values(toQueue.map((leadId) => ({
            workspaceId: workspace.workspaceId,
            leadId,
            userId: workspace.user.id,
            type: "profile_capture_queued",
            title: "Instagram-Screenshot vorbereitet",
            detail: "Der Lead wurde in die Medien-Queue gelegt.",
          }))),
        ]);
      }

      return Response.json({
        operation: input.operation,
        processed: eligibleIds.length,
        succeeded: eligibleIds.length,
        failed: 0,
        results: eligibleIds.map((leadId) => ({ leadId, ok: true, alreadyQueued: queued.has(leadId) })),
      });
    }

    const results = await processWithConcurrency(eligibleIds, input.operation === "enrich" ? 2 : 5, async (leadId) => {
      try {
        if (input.operation === "enrich") {
          const result = await enrichLeadManually({
            workspaceId: workspace.workspaceId,
            leadId,
            userId: workspace.user.id,
          });
          return { leadId, ok: true, lead: result.lead };
        }
        if (input.operation === "validate") {
          const lead = await validateLead({ workspaceId: workspace.workspaceId, userId: workspace.user.id, leadId });
          return { leadId, ok: true, lead };
        }
        const lead = await analyzeLead({ workspaceId: workspace.workspaceId, userId: workspace.user.id, leadId });
        return { leadId, ok: true, lead };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Aktion fehlgeschlagen.";
        if (input.operation === "enrich") {
          await db.update(leads)
            .set({ researchStatus: "failed", nextAction: "review", updatedAt: new Date() })
            .where(and(eq(leads.workspaceId, workspace.workspaceId), eq(leads.id, leadId)))
            .catch(() => undefined);
        }
        return { leadId, ok: false, error: detail };
      }
    });

    return Response.json({
      operation: input.operation,
      processed: results.length,
      succeeded: results.filter((result) => result.ok).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Bulk-Aktion ist ungültig.", issues: error.issues }, { status: 400 });
    }
    return apiError(error);
  }
}
