import { instagramUsername, normalizeInstagramProfile } from "@/lib/social-profile";

export type NormalizedLeadInput = {
  company: string;
  contact?: string;
  email?: string;
  phone?: string;
  websiteUrl?: string;
  city?: string;
  region?: string;
  category?: string;
  score?: number;
  confidence?: number;
  websiteScore?: number;
  salesPriority?: number;
  jobCount?: number;
  jobTitles?: string[];
  source?: string;
  sourceRecords?: number;
  ceo?: string;
  summary?: string;
  pitch?: string;
  recommendedOffer?: string;
  evidence?: unknown[];
  tags?: string[];
};

type UnknownRecord = Record<string, unknown>;

const asRecord = (value: unknown): UnknownRecord =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as UnknownRecord) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const number = (value: unknown, fallback = 0) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.max(0, Math.round(parsed)) : fallback;
};

export function normalizeCompany(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\b(gmbh|ggmbh|ag|kg|ohg|ug|e\.?v\.?|mbh)\b/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function domainFromUrl(value: string) {
  if (!value) return "";
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname.replace(/^www\./, "")
      .toLowerCase();
  } catch {
    return "";
  }
}

export function normalizeWebsite(value: string) {
  if (!value) return "";
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
}

export function slugify(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}

function firstEmail(...values: unknown[]) {
  for (const value of values) {
    if (Array.isArray(value)) {
      const candidate = value.map(text).find((entry) => entry.includes("@"));
      if (candidate) return candidate;
    }
    const candidate = text(value);
    if (candidate.includes("@")) return candidate;
  }
  return "";
}

function leadHasInstagramProfile(value: string) {
  try { return Boolean(normalizeInstagramProfile(value)); } catch { return false; }
}

function rowToLead(raw: unknown): NormalizedLeadInput | null {
  const row = asRecord(raw);
  const enrichment = asRecord(row.enrichment);
  const companyLinks = asRecord(row.companyLinks);
  const location = asRecord(row.location);
  const companyCeo = asRecord(row.companyCeo);

  const company =
    text(enrichment.companyName) ||
    text(row.companyName) ||
    text(row.company) ||
    text(row.unternehmen) ||
    text(row.firma);
  if (!company) return null;

  const socialProfile =
    text(row.instagramUrl) ||
    text(row.instagramProfile) ||
    text(row.instagram) ||
    text(row.socialUrl) ||
    text(row.profileUrl) ||
    text(enrichment.instagram) ||
    text(companyLinks.instagram) ||
    text(row.websiteUrl) ||
    text(row.url);
  const email = firstEmail(enrichment.emails, row.emails, row.email, row["e-mail"]);
  const ceo =
    text(enrichment.ceo) ||
    text(companyCeo.name) ||
    text(row.ceo) ||
    text(row.geschaeftsfuehrer);
  const title = text(row.title) || text(row.jobTitle);
  const notes = [text(enrichment.assessmentNotes), text(enrichment.assessmentBasis)].filter(Boolean);
  const evidence = [
    ...notes,
    ...asArray(row.benefits).map(text).filter(Boolean).slice(0, 8),
  ];
  const city = text(location.city) || text(row.city) || text(row.ort);
  const jobCount = number(enrichment.jobCount, title ? 1 : 0);
  const websiteScore = number(enrichment.websiteScore, number(row.websiteScore));
  const salesPriority = number(
    enrichment.salesPriority,
    number(row.salesPriority, Math.min(100, Math.max(0, 100 - websiteScore + Math.min(jobCount * 5, 25)))),
  );

  return {
    company,
    contact: text(row.contact) || text(row.ansprechpartner) || ceo,
    email,
    phone: text(enrichment.phone) || text(row.phone) || text(row.telefon),
    websiteUrl: (() => {
      try { return normalizeInstagramProfile(socialProfile); } catch { return ""; }
    })(),
    city,
    region: text(row.region) || text(location.country),
    category: text(row.category) || "other",
    score: number(row.score, salesPriority),
    confidence: number(row.confidence, enrichment.verificationStatus ? 70 : 45),
    websiteScore,
    salesPriority,
    jobCount,
    jobTitles: title ? [title] : asArray(row.jobTitles).map(text).filter(Boolean),
    source: text(row.source) || "import",
    sourceRecords: 1,
    ceo,
    summary:
      text(row.summary) ||
      (socialProfile ? `${company} verfügt über ein Instagram-Profil, das für die persönliche JJ-Media Social-Media-Analyse hinterlegt wurde.` : ""),
    pitch:
      text(row.pitch) ||
      `Ich habe drei konkrete Hebel gefunden, mit denen ${company} über Instagram schneller Vertrauen, Reichweite und qualifizierte Anfragen aufbauen kann.`,
    recommendedOffer: text(row.recommendedOffer) || "Social Media Wachstumssystem",
    evidence,
    tags: [
      ...asArray(row.tags).map(text).filter(Boolean),
      ...(leadHasInstagramProfile(socialProfile) ? ["instagram-profil"] : []),
    ],
  };
}

export function normalizeImport(input: unknown): NormalizedLeadInput[] {
  const rows = Array.isArray(input)
    ? input
    : Array.isArray(asRecord(input).leads)
      ? (asRecord(input).leads as unknown[])
      : Array.isArray(asRecord(input).data)
        ? (asRecord(input).data as unknown[])
        : [];

  const grouped = new Map<string, NormalizedLeadInput>();
  for (const raw of rows) {
    const lead = rowToLead(raw);
    if (!lead) continue;
    const key = instagramUsername(lead.websiteUrl ?? "") || normalizeCompany(lead.company);
    if (!key) continue;
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, lead);
      continue;
    }
    const titles = new Set([...(existing.jobTitles ?? []), ...(lead.jobTitles ?? [])]);
    const evidence = [...(existing.evidence ?? []), ...(lead.evidence ?? [])];
    grouped.set(key, {
      ...existing,
      contact: existing.contact || lead.contact,
      email: existing.email || lead.email,
      phone: existing.phone || lead.phone,
      websiteUrl: existing.websiteUrl || lead.websiteUrl,
      city: existing.city || lead.city,
      ceo: existing.ceo || lead.ceo,
      jobCount: Math.max(existing.jobCount ?? 0, lead.jobCount ?? 0, (existing.sourceRecords ?? 1) + 1),
      jobTitles: [...titles],
      sourceRecords: (existing.sourceRecords ?? 1) + 1,
      salesPriority: Math.max(existing.salesPriority ?? 0, lead.salesPriority ?? 0),
      websiteScore: existing.websiteScore || lead.websiteScore,
      evidence: evidence.slice(0, 20),
      tags: [...new Set([...(existing.tags ?? []), ...(lead.tags ?? [])])],
    });
  }
  return [...grouped.values()];
}

export function mergeLeadInputs(current: NormalizedLeadInput, incoming: NormalizedLeadInput) {
  return {
    ...current,
    ...incoming,
    contact: incoming.contact || current.contact,
    email: incoming.email || current.email,
    phone: incoming.phone || current.phone,
    websiteUrl: incoming.websiteUrl || current.websiteUrl,
    ceo: incoming.ceo || current.ceo,
    jobCount: Math.max(current.jobCount ?? 0, incoming.jobCount ?? 0),
    jobTitles: [...new Set([...(current.jobTitles ?? []), ...(incoming.jobTitles ?? [])])],
    sourceRecords: (current.sourceRecords ?? 1) + (incoming.sourceRecords ?? 1),
    evidence: [...(current.evidence ?? []), ...(incoming.evidence ?? [])].slice(0, 30),
    tags: [...new Set([...(current.tags ?? []), ...(incoming.tags ?? [])])],
  } satisfies NormalizedLeadInput;
}
