import { and, asc, eq, inArray, lt, lte, or } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, jobs, leads } from "@/db/schema";
import { enrichWebsite } from "@/lib/website-enrichment";

function mergeEvidence(current: unknown[], incoming: unknown[]) {
  const seen = new Set<string>();
  const merged: unknown[] = [];
  for (const item of [...incoming, ...current]) {
    let key: string;
    try {
      key = JSON.stringify(item);
    } catch {
      key = String(item);
    }
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(item);
    if (merged.length >= 50) break;
  }
  return merged;
}

export async function enrichLeadRecord({
  workspaceId,
  leadId,
  userId,
  force = false,
}: {
  workspaceId: string;
  leadId: string;
  userId?: string | null;
  force?: boolean;
}) {
  const db = getDb();
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId)))
    .limit(1);
  if (!lead) throw new Error("Lead nicht gefunden.");
  if (!lead.websiteUrl) throw new Error("Für diesen Lead fehlt eine Website.");

  const enrichment = await enrichWebsite(lead.websiteUrl);
  const email = force ? enrichment.email || lead.email : lead.email || enrichment.email;
  const phone = force ? enrichment.phone || lead.phone : lead.phone || enrichment.phone;
  const ceo = force ? enrichment.ceo || lead.ceo : lead.ceo || enrichment.ceo;
  const contact = force ? enrichment.contact || lead.contact : lead.contact || enrichment.contact;
  const city = force ? enrichment.city || lead.city : lead.city || enrichment.city;
  const region = force ? enrichment.region || lead.region : lead.region || enrichment.region;
  const summary = force ? enrichment.summary || lead.summary : lead.summary || enrichment.summary;
  const foundSignals = [email, phone, ceo].filter(Boolean).length;

  const [updated] = await db
    .update(leads)
    .set({
      email,
      phone,
      ceo,
      contact,
      city,
      region,
      summary,
      confidence: Math.max(lead.confidence, enrichment.confidence),
      salesPriority: Math.max(lead.salesPriority, foundSignals >= 3 ? 80 : foundSignals === 2 ? 65 : foundSignals === 1 ? 50 : 25),
      evidence: mergeEvidence(lead.evidence, enrichment.evidence),
      tags: [...new Set([...lead.tags, ...enrichment.tags])],
      updatedAt: new Date(),
    })
    .where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId)))
    .returning();

  const found = [
    email ? `E-Mail: ${email}` : "",
    phone ? `Telefon: ${phone}` : "",
    ceo ? `Geschäftsführung: ${ceo}` : "",
  ].filter(Boolean);
  await db.insert(activities).values({
    workspaceId,
    leadId,
    userId: userId || null,
    type: "website_enriched",
    title: found.length ? "Website-Daten automatisch ergänzt" : "Website geprüft",
    detail: found.length
      ? `${found.join(" · ")}. ${enrichment.pagesScanned.length} Seiten geprüft.`
      : `${enrichment.pagesScanned.length} Seiten geprüft, aber keine belastbaren Kontaktdaten gefunden.`,
    metadata: {
      pagesScanned: enrichment.pagesScanned,
      confidence: enrichment.confidence,
      foundEmail: Boolean(enrichment.email),
      foundPhone: Boolean(enrichment.phone),
      foundExecutive: Boolean(enrichment.ceo),
    },
  });

  return { lead: updated, enrichment };
}

export async function queueLeadEnrichments({
  workspaceId,
  leadIds,
}: {
  workspaceId: string;
  leadIds: string[];
}) {
  const ids = [...new Set(leadIds)].filter(Boolean).slice(0, 1000);
  if (!ids.length) return 0;
  const db = getDb();
  const existing = await db
    .select({ leadId: jobs.leadId })
    .from(jobs)
    .where(and(
      eq(jobs.workspaceId, workspaceId),
      inArray(jobs.leadId, ids),
      eq(jobs.type, "website_enrichment"),
      or(eq(jobs.status, "queued"), eq(jobs.status, "processing")),
    ));
  const alreadyQueued = new Set(existing.map((item) => item.leadId).filter((id): id is string => Boolean(id)));
  const missing = ids.filter((id) => !alreadyQueued.has(id));
  if (!missing.length) return 0;
  await db.insert(jobs).values(missing.map((leadId) => ({
    workspaceId,
    leadId,
    type: "website_enrichment",
    status: "queued",
    scheduledAt: new Date(),
  })));
  return missing.length;
}

export async function queueLeadEnrichment({
  workspaceId,
  leadId,
}: {
  workspaceId: string;
  leadId: string;
}) {
  const db = getDb();
  const [existing] = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(
      eq(jobs.workspaceId, workspaceId),
      eq(jobs.leadId, leadId),
      eq(jobs.type, "website_enrichment"),
      or(eq(jobs.status, "queued"), eq(jobs.status, "processing")),
    ))
    .limit(1);
  if (existing) return existing.id;
  const [job] = await db
    .insert(jobs)
    .values({
      workspaceId,
      leadId,
      type: "website_enrichment",
      status: "queued",
      scheduledAt: new Date(),
    })
    .returning({ id: jobs.id });
  return job.id;
}

export async function processQueuedEnrichments(limit = 8) {
  const db = getDb();
  const staleBefore = new Date(Date.now() - 20 * 60 * 1000);
  await db
    .update(jobs)
    .set({ status: "queued", error: "Vorheriger Lauf wurde unterbrochen und automatisch neu eingeplant.", updatedAt: new Date() })
    .where(and(
      eq(jobs.type, "website_enrichment"),
      eq(jobs.status, "processing"),
      lt(jobs.updatedAt, staleBefore),
    ));

  const queued = await db
    .select()
    .from(jobs)
    .where(and(
      eq(jobs.type, "website_enrichment"),
      eq(jobs.status, "queued"),
      lte(jobs.scheduledAt, new Date()),
    ))
    .orderBy(asc(jobs.scheduledAt))
    .limit(Math.max(1, Math.min(limit, 20)));

  let completed = 0;
  let failed = 0;
  for (const job of queued) {
    const [claimed] = await db
      .update(jobs)
      .set({
        status: "processing",
        attempts: job.attempts + 1,
        progress: 10,
        startedAt: new Date(),
        error: null,
        updatedAt: new Date(),
      })
      .where(and(eq(jobs.id, job.id), eq(jobs.status, "queued")))
      .returning({ id: jobs.id });
    if (!claimed || !job.leadId) continue;
    try {
      await enrichLeadRecord({ workspaceId: job.workspaceId, leadId: job.leadId });
      await db
        .update(jobs)
        .set({
          status: "completed",
          progress: 100,
          finishedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      completed += 1;
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Website-Enrichment fehlgeschlagen.";
      const retry = job.attempts + 1 < 3;
      await db
        .update(jobs)
        .set({
          status: retry ? "queued" : "failed",
          progress: 0,
          error: detail.slice(0, 1000),
          scheduledAt: retry ? new Date(Date.now() + 30 * 60 * 1000) : job.scheduledAt,
          finishedAt: retry ? null : new Date(),
          updatedAt: new Date(),
        })
        .where(eq(jobs.id, job.id));
      failed += 1;
    }
  }
  return { processed: queued.length, completed, failed };
}
