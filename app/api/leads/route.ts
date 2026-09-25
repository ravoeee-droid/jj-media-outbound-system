import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, leads } from "@/db/schema";
import { domainFromUrl, normalizeCompany, normalizeWebsite, slugify } from "@/lib/leads";
import { normalizeInstagramProfile } from "@/lib/social-profile";
import { hasPermission } from "@/lib/team";
import { apiError, requireWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

const leadInput = z.object({
  company: z.string().trim().min(2).max(200),
  contact: z.string().trim().max(200).optional().default(""),
  email: z.string().trim().max(320).optional().default(""),
  phone: z.string().trim().max(80).optional().default(""),
  instagramUrl: z.string().trim().max(1000).optional(),
  websiteUrl: z.string().trim().max(1000).optional().default(""),
  city: z.string().trim().max(120).optional().default(""),
  category: z.string().trim().max(80).optional().default("other"),
});

export async function GET(request: Request) {
  try {
    const workspace = await requireWorkspace();
    if (!hasPermission(workspace.role, workspace.permissions, "view_own_leads") && !hasPermission(workspace.role, workspace.permissions, "view_all_leads")) {
      throw new Error("FORBIDDEN");
    }
    const { workspaceId } = workspace;
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim() ?? "";
    const stage = url.searchParams.get("stage")?.trim() ?? "";
    const filters = [eq(leads.workspaceId, workspaceId)];
    if (!hasPermission(workspace.role, workspace.permissions, "view_all_leads")) {
      filters.push(eq(leads.ownerId, workspace.user.id));
    }
    if (stage && stage !== "all") filters.push(eq(leads.pipelineStage, stage));
    if (search) {
      const searchFilter = or(
        ilike(leads.company, `%${search}%`),
        ilike(leads.contact, `%${search}%`),
        ilike(leads.email, `%${search}%`),
        ilike(leads.domain, `%${search}%`),
      );
      if (searchFilter) filters.push(searchFilter);
    }
    const rows = await getDb()
      .select({
        id: leads.id,
        company: leads.company,
        contact: leads.contact,
        email: leads.email,
        phone: leads.phone,
        instagramUrl: leads.instagramUrl,
        websiteUrl: leads.websiteUrl,
        slug: leads.slug,
        pipelineStage: leads.pipelineStage,
        videoStatus: leads.videoStatus,
        watchPercent: leads.watchPercent,
        salesPriority: leads.salesPriority,
        websiteScore: leads.websiteScore,
        jobCount: leads.jobCount,
        dealValue: leads.dealValue,
        probability: leads.probability,
        ownerId: leads.ownerId,
        updatedAt: leads.updatedAt,
      })
      .from(leads)
      .where(and(...filters))
      .orderBy(desc(leads.salesPriority), desc(leads.updatedAt))
      .limit(1000);
    return Response.json({ leads: rows });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    if (!hasPermission(workspace.role, workspace.permissions, "manage_leads")) throw new Error("FORBIDDEN");
    const input = leadInput.parse(await request.json());
    const normalizedCompany = normalizeCompany(input.company);
    const legacyProfile = !input.instagramUrl && (/instagram\.com/i.test(input.websiteUrl) || input.websiteUrl.startsWith("@"))
      ? input.websiteUrl
      : "";
    const rawInstagram = input.instagramUrl || legacyProfile;
    if (!rawInstagram) return Response.json({ error: "Bitte ein Instagram-Profil angeben." }, { status: 400 });
    const instagramUrl = normalizeInstagramProfile(rawInstagram);
    const websiteUrl = input.instagramUrl ? normalizeWebsite(input.websiteUrl) : "";
    const db = getDb();
    const [existing] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.workspaceId, workspace.workspaceId), eq(leads.normalizedCompany, normalizedCompany)))
      .limit(1);
    if (existing) {
      return Response.json({ error: "Dieses Unternehmen ist bereits im CRM.", lead: existing }, { status: 409 });
    }
    const baseSlug = slugify(input.company) || `lead-${crypto.randomUUID().slice(0, 8)}`;
    const slug = `${baseSlug}-${crypto.randomUUID().slice(0, 5)}`;
    const [lead] = await db
      .insert(leads)
      .values({
        workspaceId: workspace.workspaceId,
        ownerId: workspace.user.id,
        createdById: workspace.user.id,
        assignedAt: new Date(),
        slug,
        company: input.company,
        normalizedCompany,
        contact: input.contact,
        email: input.email,
        phone: input.phone,
        instagramUrl,
        websiteUrl,
        domain: domainFromUrl(websiteUrl),
        researchStatus: "pending",
        validationStatus: input.phone || input.email ? "contact_found" : "pending",
        analysisStatus: "pending",
        nextAction: "enrich",
        city: input.city,
        category: input.category,
        landingPath: `/v/${slug}`,
        source: "manual",
      })
      .returning();
    await db.insert(activities).values({
      workspaceId: workspace.workspaceId,
      leadId: lead.id,
      userId: workspace.user.id,
      type: "created",
      title: "Lead angelegt",
      detail: "Manuell im JJ-Media Outbound Cockpit erstellt. Das Instagram-Profil wird erst beim bewussten Video-Start aufgenommen.",
    });

    return Response.json({ lead, enrichment: "manual" }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Bitte Unternehmen und gültige Kontaktdaten prüfen.", issues: error.issues }, { status: 400 });
    }
    if (error instanceof Error && error.message.toLowerCase().includes("instagram")) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    return apiError(error);
  }
}
