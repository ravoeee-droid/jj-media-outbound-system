import { and, desc, eq, ilike, or } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, leads } from "@/db/schema";
import { normalizeCompany, slugify } from "@/lib/leads";
import { instagramUsername, normalizeInstagramProfile } from "@/lib/social-profile";
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
    const { workspaceId } = await requireWorkspace();
    const url = new URL(request.url);
    const search = url.searchParams.get("search")?.trim() ?? "";
    const stage = url.searchParams.get("stage")?.trim() ?? "";
    const filters = [eq(leads.workspaceId, workspaceId)];
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
      .select()
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
    const input = leadInput.parse(await request.json());
    const normalizedCompany = normalizeCompany(input.company);
    const websiteUrl = normalizeInstagramProfile(input.instagramUrl || input.websiteUrl);
    if (!websiteUrl) return Response.json({ error: "Bitte ein Instagram-Profil angeben." }, { status: 400 });
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
        slug,
        company: input.company,
        normalizedCompany,
        contact: input.contact,
        email: input.email,
        phone: input.phone,
        websiteUrl,
        domain: instagramUsername(websiteUrl),
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
