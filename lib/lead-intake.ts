import { and, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads } from "@/db/schema";
import {
  domainFromUrl,
  leadUrlIdentity,
  normalizeCompany,
  normalizeImport,
  normalizeWebsite,
  mergeLeadInputs,
  slugify,
  type NormalizedLeadInput,
} from "@/lib/leads";

export type IntakeDecisionKind = "create" | "update" | "duplicate";

export type IntakeDecision = {
  intakeId: string;
  kind: IntakeDecisionKind;
  eligible: boolean;
  company: string;
  existingLeadId: string | null;
  reason: string;
  matchBy: "instagram" | "domain" | "company" | "none";
  readiness: "strong" | "usable" | "research";
  directContact: boolean;
  fields: {
    contact: string;
    email: string;
    phone: string;
    instagramUrl: string;
    websiteUrl: string;
    city: string;
    region: string;
    salesPriority: number;
  };
};

type ExistingLead = {
  id: string;
  company: string;
  normalizedCompany: string;
  ownerId: string | null;
  contact: string;
  email: string;
  phone: string;
  instagramUrl: string;
  websiteUrl: string;
  domain: string;
  city: string;
  region: string;
  category: string;
  ceo: string;
  jobCount: number;
  jobTitles: string[];
  sourceRecords: number;
  evidence: unknown[];
  tags: string[];
  salesPriority: number;
  websiteScore: number;
  summary: string;
  pitch: string;
  recommendedOffer: string;
};

type Prepared = {
  intakeId: string;
  input: NormalizedLeadInput;
  existing: ExistingLead | null;
  decision: IntakeDecision;
};

function rawRecordCount(raw: unknown) {
  if (Array.isArray(raw)) return raw.length;
  if (!raw || typeof raw !== "object") return 0;
  const object = raw as Record<string, unknown>;
  for (const key of ["leads", "data", "results", "items"]) {
    if (Array.isArray(object[key])) return object[key].length;
  }
  return 0;
}

function intakeIdentity(input: NormalizedLeadInput) {
  const instagram = leadUrlIdentity(input.instagramUrl ?? "");
  if (instagram) return `ig:${instagram}`;
  const domain = domainFromUrl(input.websiteUrl ?? "");
  if (domain) return `domain:${domain}`;
  return `company:${normalizeCompany(input.company)}`;
}

function usefulNewFields(input: NormalizedLeadInput, existing: ExistingLead) {
  const additions = [
    Boolean(input.contact && input.contact !== existing.contact),
    Boolean(input.email && input.email !== existing.email),
    Boolean(input.phone && input.phone !== existing.phone),
    Boolean(input.instagramUrl && input.instagramUrl !== existing.instagramUrl),
    Boolean(input.websiteUrl && normalizeWebsite(input.websiteUrl) !== existing.websiteUrl),
    Boolean(input.city && input.city !== existing.city),
    Boolean(input.region && input.region !== existing.region),
    Boolean(input.ceo && input.ceo !== existing.ceo),
    (input.jobCount ?? 0) > existing.jobCount,
    (input.jobTitles ?? []).some((title) => !existing.jobTitles.includes(title)),
    (input.tags ?? []).some((tag) => !existing.tags.includes(tag)),
    (input.salesPriority ?? 0) > existing.salesPriority,
    (input.websiteScore ?? 0) > 0 && (input.websiteScore ?? 0) !== existing.websiteScore,
  ];
  return additions.filter(Boolean).length;
}

function readiness(input: NormalizedLeadInput): IntakeDecision["readiness"] {
  const direct = Boolean(input.phone || input.email);
  const digital = Boolean(input.websiteUrl || input.instagramUrl);
  if (direct && digital) return "strong";
  if (direct || digital) return "usable";
  return "research";
}

function bestMatch(
  input: NormalizedLeadInput,
  byInstagram: Map<string, ExistingLead>,
  byDomain: Map<string, ExistingLead>,
  byCompany: Map<string, ExistingLead>,
) {
  const instagram = leadUrlIdentity(input.instagramUrl ?? "");
  if (instagram && byInstagram.has(instagram)) return { lead: byInstagram.get(instagram)!, matchBy: "instagram" as const };
  const domain = domainFromUrl(input.websiteUrl ?? "");
  if (domain && byDomain.has(domain)) return { lead: byDomain.get(domain)!, matchBy: "domain" as const };
  const company = normalizeCompany(input.company);
  if (company && byCompany.has(company)) return { lead: byCompany.get(company)!, matchBy: "company" as const };
  return { lead: null, matchBy: "none" as const };
}

export async function prepareLeadIntake(workspaceId: string, raw: unknown) {
  const firstPass = normalizeImport(raw);
  const consolidated = new Map<string, NormalizedLeadInput>();
  for (const input of firstPass) {
    const key = normalizeCompany(input.company);
    if (!key) continue;
    const current = consolidated.get(key);
    consolidated.set(key, current ? mergeLeadInputs(current, input) : input);
  }
  const normalized = [...consolidated.values()].slice(0, 100);
  const sourceCount = rawRecordCount(raw);
  const representedRecords = normalized.reduce((sum, item) => sum + (item.sourceRecords ?? 1), 0);
  const mergedInsideImport = normalized.reduce((sum, item) => sum + Math.max(0, (item.sourceRecords ?? 1) - 1), 0);

  const companies = [...new Set(normalized.map((item) => normalizeCompany(item.company)).filter(Boolean))];
  const domains = [...new Set(normalized.map((item) => domainFromUrl(item.websiteUrl ?? "")).filter(Boolean))];
  const instagramUrls = [...new Set(normalized.map((item) => item.instagramUrl ?? "").filter(Boolean))];

  const db = getDb();
  const select = {
    id: leads.id,
    company: leads.company,
    normalizedCompany: leads.normalizedCompany,
    ownerId: leads.ownerId,
    contact: leads.contact,
    email: leads.email,
    phone: leads.phone,
    instagramUrl: leads.instagramUrl,
    websiteUrl: leads.websiteUrl,
    domain: leads.domain,
    city: leads.city,
    region: leads.region,
    category: leads.category,
    ceo: leads.ceo,
    jobCount: leads.jobCount,
    jobTitles: leads.jobTitles,
    sourceRecords: leads.sourceRecords,
    evidence: leads.evidence,
    tags: leads.tags,
    salesPriority: leads.salesPriority,
    websiteScore: leads.websiteScore,
    summary: leads.summary,
    pitch: leads.pitch,
    recommendedOffer: leads.recommendedOffer,
  };

  const [companyRows, domainRows, instagramRows] = await Promise.all([
    companies.length
      ? db.select(select).from(leads).where(and(eq(leads.workspaceId, workspaceId), inArray(leads.normalizedCompany, companies)))
      : Promise.resolve([]),
    domains.length
      ? db.select(select).from(leads).where(and(eq(leads.workspaceId, workspaceId), inArray(leads.domain, domains)))
      : Promise.resolve([]),
    instagramUrls.length
      ? db.select(select).from(leads).where(and(eq(leads.workspaceId, workspaceId), inArray(leads.instagramUrl, instagramUrls)))
      : Promise.resolve([]),
  ]);

  const byCompany = new Map(companyRows.map((row) => [row.normalizedCompany, row]));
  const byDomain = new Map(domainRows.filter((row) => row.domain).map((row) => [row.domain, row]));
  const byInstagram = new Map(
    instagramRows
      .map((row) => [leadUrlIdentity(row.instagramUrl), row] as const)
      .filter(([identity]) => Boolean(identity)),
  );

  const prepared: Prepared[] = normalized.map((input) => {
    const intakeId = intakeIdentity(input);
    const match = bestMatch(input, byInstagram, byDomain, byCompany);
    const directContact = Boolean(input.phone || input.email);
    const common = {
      intakeId,
      company: input.company,
      existingLeadId: match.lead?.id ?? null,
      matchBy: match.matchBy,
      readiness: readiness(input),
      directContact,
      fields: {
        contact: input.contact ?? "",
        email: input.email ?? "",
        phone: input.phone ?? "",
        instagramUrl: input.instagramUrl ?? "",
        websiteUrl: input.websiteUrl ?? "",
        city: input.city ?? "",
        region: input.region ?? "",
        salesPriority: input.salesPriority ?? 0,
      },
    };

    let decision: IntakeDecision;
    if (!match.lead) {
      decision = {
        ...common,
        kind: "create",
        eligible: true,
        reason: directContact
          ? "Neuer Lead mit direktem Kontaktweg."
          : "Neuer Lead; Kontakt kann im nächsten Schritt recherchiert werden.",
      };
    } else {
      const additions = usefulNewFields(input, match.lead);
      decision = additions > 0
        ? {
            ...common,
            kind: "update",
            eligible: true,
            reason: `Bestehender Lead · ${additions} neue/aktuellere Felder können ergänzt werden.`,
          }
        : {
            ...common,
            kind: "duplicate",
            eligible: false,
            reason: "Bereits vollständig im CRM vorhanden; keine neuen Informationen.",
          };
    }

    return { intakeId, input, existing: match.lead, decision };
  });

  return {
    sourceCount,
    normalizedCount: normalized.length,
    mergedInsideImport,
    discarded: Math.max(0, sourceCount - representedRecords),
    prepared,
    decisions: prepared.map((item) => item.decision),
  };
}

function mergeExisting(input: NormalizedLeadInput, existing: ExistingLead, source: string) {
  const websiteUrl = normalizeWebsite(input.websiteUrl ?? "") || existing.websiteUrl;
  return {
    company: input.company || existing.company,
    normalizedCompany: normalizeCompany(input.company || existing.company),
    contact: input.contact || existing.contact,
    email: input.email || existing.email,
    phone: input.phone || existing.phone,
    instagramUrl: input.instagramUrl || existing.instagramUrl,
    websiteUrl,
    domain: domainFromUrl(websiteUrl) || existing.domain,
    city: input.city || existing.city,
    region: input.region || existing.region,
    category: input.category && input.category !== "other" ? input.category : existing.category,
    ceo: input.ceo || existing.ceo,
    jobCount: Math.max(existing.jobCount, input.jobCount ?? 0),
    jobTitles: [...new Set([...existing.jobTitles, ...(input.jobTitles ?? [])])],
    sourceRecords: existing.sourceRecords + (input.sourceRecords ?? 1),
    evidence: [...existing.evidence, ...(input.evidence ?? [])].slice(0, 30),
    tags: [...new Set([...existing.tags, ...(input.tags ?? [])])],
    salesPriority: Math.max(existing.salesPriority, input.salesPriority ?? 0),
    websiteScore: input.websiteScore || existing.websiteScore,
    summary: input.summary || existing.summary,
    pitch: input.pitch || existing.pitch,
    recommendedOffer: input.recommendedOffer || existing.recommendedOffer,
    source: source || input.source || "intake",
    updatedAt: new Date(),
  } satisfies Partial<typeof leads.$inferInsert>;
}

export async function commitLeadIntake(options: {
  workspaceId: string;
  userId: string;
  raw: unknown;
  selectedIntakeIds: string[];
  source: string;
  ownerId: string | null;
}) {
  const preview = await prepareLeadIntake(options.workspaceId, options.raw);
  const selected = new Set(options.selectedIntakeIds);
  const candidates = preview.prepared.filter((item) => selected.has(item.intakeId) && item.decision.eligible).slice(0, 30);
  if (!candidates.length) return { created: 0, updated: 0, leadIds: [] as string[], decisions: preview.decisions };

  const db = getDb();
  const createdInputs = candidates.filter((item) => !item.existing);
  const updateInputs = candidates.filter((item) => item.existing);
  const leadIds: string[] = [];
  let createdCount = 0;
  let updatedCount = 0;

  if (createdInputs.length) {
    const rows = createdInputs.map(({ input }) => {
      const websiteUrl = normalizeWebsite(input.websiteUrl ?? "");
      const slug = `${slugify(input.company) || "lead"}-${crypto.randomUUID().slice(0, 7)}`;
      return {
        workspaceId: options.workspaceId,
        ownerId: options.ownerId,
        createdById: options.userId,
        assignedAt: options.ownerId ? new Date() : null,
        slug,
        landingPath: `/v/${slug}`,
        company: input.company,
        normalizedCompany: normalizeCompany(input.company),
        contact: input.contact ?? "",
        email: input.email ?? "",
        phone: input.phone ?? "",
        instagramUrl: input.instagramUrl ?? "",
        websiteUrl,
        domain: domainFromUrl(websiteUrl),
        city: input.city ?? "",
        region: input.region ?? "",
        category: input.category ?? "other",
        pipelineStage: "new",
        researchStatus: "pending",
        validationStatus: input.phone || input.email ? "contact_found" : "pending",
        analysisStatus: "pending",
        nextAction: "enrich",
        score: input.score ?? 0,
        confidence: input.confidence ?? 0,
        websiteScore: input.websiteScore ?? 0,
        salesPriority: input.salesPriority ?? 0,
        jobCount: input.jobCount ?? 0,
        jobTitles: input.jobTitles ?? [],
        source: options.source || input.source || "intake",
        sourceRecords: input.sourceRecords ?? 1,
        ceo: input.ceo ?? "",
        summary: input.summary ?? "",
        pitch: input.pitch ?? "",
        recommendedOffer: input.recommendedOffer ?? "",
        evidence: input.evidence ?? [],
        tags: input.tags ?? [],
      } satisfies typeof leads.$inferInsert;
    });

    const created = await db.insert(leads).values(rows).onConflictDoNothing().returning({ id: leads.id, company: leads.company });
    leadIds.push(...created.map((row) => row.id));
    createdCount = created.length;
    if (created.length) {
      await db.insert(activities).values(created.map((row) => ({
        workspaceId: options.workspaceId,
        leadId: row.id,
        userId: options.userId,
        type: "intake_created",
        title: "Lead über Intake übernommen",
        detail: `Quelle: ${options.source || "Lead Intake"}`,
      })));
    }
  }

  for (const item of updateInputs) {
    const existing = item.existing!;
    const [updated] = await db
      .update(leads)
      .set(mergeExisting(item.input, existing, options.source))
      .where(and(eq(leads.workspaceId, options.workspaceId), eq(leads.id, existing.id)))
      .returning({ id: leads.id });
    if (!updated) continue;
    leadIds.push(updated.id);
    updatedCount += 1;
    await db.insert(activities).values({
      workspaceId: options.workspaceId,
      leadId: updated.id,
      userId: options.userId,
      type: "intake_updated",
      title: "Lead über Intake ergänzt",
      detail: "Neue Importdaten wurden ohne Überschreiben bestehender Kontaktdaten ergänzt.",
    });
  }

  return {
    created: createdCount,
    updated: updatedCount,
    leadIds,
    decisions: preview.decisions,
  };
}
