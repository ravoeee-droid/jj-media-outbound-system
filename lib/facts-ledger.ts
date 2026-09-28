import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { acquisitionLeadSignals, leads, outboundEvidenceItems } from "@/db/schema";

export type FactReviewStatus = "proposed" | "auto_verified" | "approved" | "rejected";



async function upsertFact(args: {
  workspace: string;
  leadId: string;
  companyId: string;
  key: string;
  type: string;
  claim: string;
  value?: string;
  sourceUrl?: string;
  sourceTitle?: string;
  confidence: number;
  excerpt?: string;
  metadata?: Record<string, unknown>;
}) {
  const db = getDb();
  const [existing] = await db.select().from(outboundEvidenceItems)
    .where(and(
      eq(outboundEvidenceItems.workspace, args.workspace),
      eq(outboundEvidenceItems.leadId, args.leadId),
      eq(outboundEvidenceItems.evidenceKey, args.key),
    )).limit(1);
  const autoVerified = args.confidence >= 0.8 && Boolean(args.sourceUrl) && args.type !== "derived";
  if (existing) {
    if (existing.locked || existing.reviewStatus === "approved" || existing.reviewStatus === "rejected") return existing;
    const [updated] = await db.update(outboundEvidenceItems).set({
      evidenceType: args.type,
      claim: args.claim,
      valueText: args.value || null,
      sourceUrl: args.sourceUrl || null,
      sourceTitle: args.sourceTitle || null,
      observedAt: new Date(),
      confidence: String(args.confidence),
      excerpt: args.excerpt || null,
      metadata: args.metadata || {},
      reviewStatus: autoVerified ? "auto_verified" : "proposed",
      outreachAllowed: autoVerified,
    }).where(eq(outboundEvidenceItems.id, existing.id)).returning();
    return updated;
  }
  const [created] = await db.insert(outboundEvidenceItems).values({
    workspace: args.workspace,
    companyId: args.companyId,
    leadId: args.leadId,
    evidenceKey: args.key,
    evidenceType: args.type,
    claim: args.claim,
    valueText: args.value || null,
    sourceUrl: args.sourceUrl || null,
    sourceTitle: args.sourceTitle || null,
    observedAt: new Date(),
    confidence: String(args.confidence),
    excerpt: args.excerpt || null,
    metadata: args.metadata || {},
    reviewStatus: autoVerified ? "auto_verified" : "proposed",
    outreachAllowed: autoVerified,
  }).returning();
  return created;
}

export async function syncLeadFacts(workspace: string, leadId: string) {
  const db = getDb();
  const [lead] = await db.select().from(leads)
    .where(and(eq(leads.workspaceId, workspace), eq(leads.id, leadId))).limit(1);
  if (!lead) throw new Error("Lead nicht gefunden.");

  const signals = await db.select().from(acquisitionLeadSignals)
    .where(and(eq(acquisitionLeadSignals.workspaceId, workspace), eq(acquisitionLeadSignals.leadId, leadId)));

  const companyId = lead.normalizedCompany || lead.id;
  const tasks: Promise<unknown>[] = [];

  if (lead.websiteUrl) tasks.push(upsertFact({
    workspace, leadId, companyId,
    key: "official_website",
    type: "website",
    claim: "Offizielle Unternehmenswebsite vorhanden.",
    value: lead.websiteUrl,
    sourceUrl: lead.websiteUrl,
    sourceTitle: lead.company,
    confidence: 0.99,
    metadata: { origin: "lead_record" },
  }));

  if (lead.ceo) tasks.push(upsertFact({
    workspace, leadId, companyId,
    key: "executive_contact",
    type: "website",
    claim: "Geschäftsführung oder leitende Ansprechperson wurde öffentlich gefunden.",
    value: lead.ceo,
    sourceUrl: lead.websiteUrl,
    sourceTitle: lead.company,
    confidence: Math.max(0.8, lead.confidence / 100),
    metadata: { origin: "website_enrichment" },
  }));

  if (lead.jobCount > 0) tasks.push(upsertFact({
    workspace, leadId, companyId,
    key: "active_hiring",
    type: "job_signal",
    claim: "Aktiver Personalbedarf wurde erkannt.",
    value: lead.jobCount + " offene Stelle" + (lead.jobCount === 1 ? "" : "n") + (lead.jobTitles.length ? ": " + lead.jobTitles.slice(0, 5).join(", ") : ""),
    sourceUrl: lead.websiteUrl,
    sourceTitle: "Karriere-/Stellensignal",
    confidence: lead.jobTitles.length ? 0.95 : 0.8,
    metadata: { jobCount: lead.jobCount, jobTitles: lead.jobTitles.slice(0, 10) },
  }));

  const evidenceRows = Array.isArray(lead.evidence) ? lead.evidence : [];
  evidenceRows.forEach((raw, index) => {
    if (!raw || typeof raw !== "object") return;
    const row = raw as Record<string, unknown>;
    const source = typeof row.source === "string" ? row.source : lead.websiteUrl;
    const value = typeof row.value === "string" ? row.value : typeof row.detail === "string" ? row.detail : "";
    const kind = typeof row.kind === "string" ? row.kind : "public_page";
    const label = typeof row.label === "string" ? row.label : kind;
    if (!value && !source) return;
    tasks.push(upsertFact({
      workspace, leadId, companyId,
      key: "lead_evidence_" + kind + "_" + index,
      type: ["email","phone","executive","address","description","social"].includes(kind) ? "website" : "public_page",
      claim: "Öffentlich belegter Research-Fakt: " + label,
      value,
      sourceUrl: source,
      sourceTitle: lead.company,
      confidence: Math.max(0.75, lead.confidence / 100),
      metadata: { origin: "lead_evidence", kind, label },
    }));
  });

  signals.forEach((signal) => {
    tasks.push(upsertFact({
      workspace, leadId, companyId,
      key: "signal_" + signal.signalKey,
      type: signal.sourceKind === "job_signal" ? "job_signal" : signal.sourceKind === "crm" ? "crm" : signal.sourceKind === "website_analysis" ? "website" : "derived",
      claim: signal.title,
      value: signal.detail,
      sourceUrl: signal.sourceUrl,
      sourceTitle: signal.sourceKind,
      confidence: signal.confidence / 100,
      metadata: { origin: "signal_radar", signalType: signal.signalType, strength: signal.strength, ...signal.evidence },
    }));
  });

  await Promise.all(tasks);
  return listFactsForLead(workspace, leadId);
}

export async function listFactsForLead(workspace: string, leadId: string) {
  return getDb()
    .select()
    .from(outboundEvidenceItems)
    .where(and(eq(outboundEvidenceItems.workspace, workspace), eq(outboundEvidenceItems.leadId, leadId)));
}

export async function reviewFact(args: {
  workspace: string;
  leadId: string;
  factId: string;
  action: "approve" | "reject" | "toggle_lock";
  reviewer: string;
}) {
  const db = getDb();
  const [fact] = await db.select().from(outboundEvidenceItems)
    .where(and(
      eq(outboundEvidenceItems.workspace, args.workspace),
      eq(outboundEvidenceItems.leadId, args.leadId),
      eq(outboundEvidenceItems.id, args.factId),
    ))
    .limit(1);
  if (!fact) throw new Error("Fakt nicht gefunden.");

  if (args.action === "toggle_lock") {
    const [updated] = await db.update(outboundEvidenceItems).set({
      locked: !fact.locked,
      reviewedBy: args.reviewer,
      reviewedAt: new Date(),
    }).where(eq(outboundEvidenceItems.id, fact.id)).returning();
    return updated;
  }

  const approved = args.action === "approve";
  const [updated] = await db.update(outboundEvidenceItems).set({
    reviewStatus: approved ? "approved" : "rejected",
    outreachAllowed: approved,
    locked: approved ? fact.locked : true,
    reviewedBy: args.reviewer,
    reviewedAt: new Date(),
  }).where(eq(outboundEvidenceItems.id, fact.id)).returning();
  return updated;
}

export async function getAllowedFacts(workspace: string, leadId: string) {
  const facts = await listFactsForLead(workspace, leadId);
  return facts.filter((fact) => {
    const fresh = !fact.expiresAt || fact.expiresAt.getTime() > Date.now();
    return fresh && fact.outreachAllowed && fact.reviewStatus !== "rejected";
  });
}

export async function buildClaimContext(workspace: string, leadId: string) {
  const facts = await listFactsForLead(workspace, leadId);
  const allowed = facts.filter((fact) => {
    const fresh = !fact.expiresAt || fact.expiresAt.getTime() > Date.now();
    return fresh && fact.outreachAllowed && ["auto_verified", "approved"].includes(fact.reviewStatus);
  });
  return {
    allowedClaims: allowed.map((fact) => ({
      id: fact.id,
      key: fact.evidenceKey,
      claim: fact.claim,
      value: fact.valueText || "",
      sourceUrl: fact.sourceUrl || "",
      confidence: Number(fact.confidence || 0),
      locked: fact.locked,
    })),
    blockedCount: facts.length - allowed.length,
    totalCount: facts.length,
  };
}

export async function assertClaimsGrounded(workspace: string, leadId: string, factIds: string[]) {
  if (!factIds.length) return { ok: true, facts: [] };
  const context = await buildClaimContext(workspace, leadId);
  const allowed = new Map(context.allowedClaims.map((fact) => [fact.id, fact]));
  const missing = factIds.filter((id) => !allowed.has(id));
  if (missing.length) {
    throw new Error("FACT_GATE_BLOCKED: Eine oder mehrere Aussagen sind nicht freigegeben oder nicht mehr aktuell.");
  }
  return { ok: true, facts: factIds.map((id) => allowed.get(id)!) };
}
