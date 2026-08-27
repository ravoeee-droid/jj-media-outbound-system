import { and, eq, or } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads } from "@/db/schema";
import {
  normalizeCompany,
  normalizeImport,
  slugify,
} from "@/lib/leads";
import { instagramUsername, normalizeInstagramProfile } from "@/lib/social-profile";
import { apiError, requireWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const payload = (await request.json()) as { leads?: unknown[]; raw?: unknown; source?: string };
    const incoming = normalizeImport(payload.raw ?? payload.leads ?? []).slice(0, 500);
    if (!incoming.length) {
      return Response.json({ error: "Keine importierbaren Unternehmen gefunden." }, { status: 400 });
    }
    const db = getDb();
    let created = 0;
    let updated = 0;
    let skipped = 0;
    let enrichmentCandidates = 0;

    for (const item of incoming) {
      const company = item.company.trim();
      const normalizedCompany = normalizeCompany(company);
      const websiteUrl = (() => {
        try { return normalizeInstagramProfile(item.websiteUrl ?? ""); } catch { return ""; }
      })();
      const domain = instagramUsername(websiteUrl);
      if (!normalizedCompany) {
        skipped += 1;
        continue;
      }
      const candidate = or(
        eq(leads.normalizedCompany, normalizedCompany),
        ...(domain ? [eq(leads.domain, domain)] : []),
      );
      const [existing] = await db
        .select()
        .from(leads)
        .where(and(eq(leads.workspaceId, workspace.workspaceId), candidate))
        .limit(1);

      const shared: Partial<typeof leads.$inferInsert> = {
        company,
        normalizedCompany,
        contact: item.contact ?? "",
        email: item.email ?? "",
        phone: item.phone ?? "",
        websiteUrl,
        domain,
        city: item.city ?? "",
        region: item.region ?? "",
        category: item.category ?? "other",
        score: item.score ?? 0,
        confidence: item.confidence ?? 0,
        websiteScore: item.websiteScore ?? 0,
        salesPriority: item.salesPriority ?? 0,
        jobCount: item.jobCount ?? 0,
        jobTitles: item.jobTitles ?? [],
        source: payload.source ?? item.source ?? "import",
        sourceRecords: item.sourceRecords ?? 1,
        ceo: item.ceo ?? "",
        summary: item.summary ?? "",
        pitch: item.pitch ?? "",
        recommendedOffer: item.recommendedOffer ?? "",
        evidence: item.evidence ?? [],
        tags: item.tags ?? [],
        updatedAt: new Date(),
      };

      if (existing) {
        const merged: Partial<typeof leads.$inferInsert> = {
          ...shared,
          contact: item.contact || existing.contact,
          email: item.email || existing.email,
          phone: item.phone || existing.phone,
          websiteUrl: websiteUrl || existing.websiteUrl,
          domain: domain || existing.domain,
          ceo: item.ceo || existing.ceo,
          jobCount: Math.max(existing.jobCount, item.jobCount ?? 0),
          jobTitles: [...new Set([...existing.jobTitles, ...(item.jobTitles ?? [])])],
          sourceRecords: existing.sourceRecords + (item.sourceRecords ?? 1),
          evidence: [...existing.evidence, ...(item.evidence ?? [])].slice(0, 30),
          tags: [...new Set([...existing.tags, ...(item.tags ?? [])])],
          salesPriority: Math.max(existing.salesPriority, item.salesPriority ?? 0),
        };
        await db.update(leads).set(merged).where(eq(leads.id, existing.id));
        await db.insert(activities).values({
          workspaceId: workspace.workspaceId,
          leadId: existing.id,
          userId: workspace.user.id,
          type: "import_updated",
          title: "Importdaten ergänzt",
          detail: `${item.sourceRecords ?? 1} Quelldatensätze zusammengeführt. Instagram-Aufnahme startet erst bei der manuellen Video-Erstellung.`,
        });
        if (websiteUrl || existing.websiteUrl) enrichmentCandidates += 1;
        updated += 1;
        continue;
      }

      const slug = `${slugify(company) || "lead"}-${crypto.randomUUID().slice(0, 5)}`;
      const [lead] = await db
        .insert(leads)
        .values({
          workspaceId: workspace.workspaceId,
          slug,
          landingPath: `/v/${slug}`,
          ...shared,
          company,
          normalizedCompany,
        } as typeof leads.$inferInsert)
        .returning();
      await db.insert(activities).values({
        workspaceId: workspace.workspaceId,
        leadId: lead.id,
        userId: workspace.user.id,
        type: "imported",
        title: "Lead importiert",
        detail: `Quelle: ${lead.source}. ${lead.sourceRecords} Datensätze zusammengeführt. Instagram-Aufnahme startet nur nach dem manuellen Render-Klick.`,
      });
      if (lead.websiteUrl) enrichmentCandidates += 1;
      created += 1;
    }

    return Response.json({
      ok: true,
      created,
      updated,
      skipped,
      total: incoming.length,
      enrichmentMode: "manual",
      enrichmentCandidates,
    });
  } catch (error) {
    return apiError(error);
  }
}
