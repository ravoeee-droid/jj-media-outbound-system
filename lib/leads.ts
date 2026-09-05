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

export function leadUrlIdentity(value: string) {
  if (!value) return "";
  try {
    const username = instagramUsername(value);
    if (username) return username.toLowerCase();
  } catch {
    // Generic websites are valid lead URLs too.
  }
  return domainFromUrl(value);
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

function normalizeLeadUrl(value: string) {
  const raw = text(value);
  if (!raw) return "";
  try { return normalizeInstagramProfile(raw); }
  catch { return normalizeWebsite(raw); }
}

function firstCategory(row: UnknownRecord) {
  return text(row.category) || text(row.categoryName) || asArray(row.categories).map(text).find(Boolean) || "other";
}

function rowToLead(raw: unknown): NormalizedLeadInput | null {
  const row = asRecord(raw);
  const enrichment = asRecord(row.enrichment);
  const companyLinks = asRecord(row.companyLinks);
  const location = asRecord(row.location);
  const companyCeo = asRecord(row.companyCeo);

  const explicitCompany =
    text(enrichment.companyName) ||
    text(row.companyName) ||
    text(row.company) ||
    text(row.unternehmen) ||
    text(row.firma) ||
    text(row.businessName) ||
    text(row.name);
  // Google Maps / scraper exports commonly store the business name in `title`.
  const company = explicitCompany || text(row.title);
  if (!company) return null;

  const explicitInstagram =
    text(row.instagramUrl) ||
    text(row.instagramProfile) ||
    text(row.instagram) ||
    text(row.socialUrl) ||
    text(row.profileUrl) ||
    text(enrichment.instagram) ||
    text(companyLinks.instagram);
  const genericWebsite =
    text(row.websiteUrl) ||
    text(row.website) ||
    text(row.homepage) ||
    text(row.web) ||
    text(companyLinks.website) ||
    text(enrichment.website);
  const fallbackUrl = /instagram\.com/i.test(text(row.url)) ? text(row.url) : "";
  const websiteUrl = normalizeLeadUrl(explicitInstagram || genericWebsite || fallbackUrl);

  const email = firstEmail(enrichment.emails, row.emails, row.email, row["e-mail"], row.mail);
  const ceo =
    text(enrichment.ceo) ||
    text(companyCeo.name) ||
    text(row.ceo) ||
    text(row.geschaeftsfuehrer) ||
    text(row.geschäftsführer);
  // `title` is only a job title when a separate company field exists. Otherwise it is the business name.
  const jobTitle = text(row.jobTitle) || (explicitCompany ? text(row.title) : "");
  const notes = [text(enrichment.assessmentNotes), text(enrichment.assessmentBasis)].filter(Boolean);
  const street = text(row.street) || text(location.street);
  const city = text(location.city) || text(row.city) || text(row.ort);
  const state = text(row.state) || text(location.state) || text(row.region);
  const country = text(row.countryCode) || text(location.country) || text(row.country);
  const rating = Number(row.totalScore);
  const reviews = Number(row.reviewsCount);
  const categories = asArray(row.categories).map(text).filter(Boolean);
  const mapsUrl = /^https?:\/\//i.test(text(row.url)) && /google\.[^/]+\/maps|google\.com\/maps/i.test(text(row.url)) ? text(row.url) : "";
  const evidence: unknown[] = [
    ...notes,
    ...asArray(row.benefits).map(text).filter(Boolean).slice(0, 8),
    ...(street || city ? [`Adresse: ${[street, city].filter(Boolean).join(", ")}`] : []),
    ...(Number.isFinite(rating) ? [`Google-Bewertung: ${rating}${Number.isFinite(reviews) ? ` (${reviews} Bewertungen)` : ""}`] : []),
    ...(categories.length ? [`Kategorien: ${categories.join(", ")}`] : []),
    ...(mapsUrl ? [`Google Maps: ${mapsUrl}`] : []),
  ];
  const jobCount = number(enrichment.jobCount, jobTitle ? 1 : 0);
  const websiteScore = number(enrichment.websiteScore, number(row.websiteScore));
  const defaultPriority = websiteUrl || text(row.phone) ? 55 : 35;
  const salesPriority = number(
    enrichment.salesPriority,
    number(row.salesPriority, Math.min(100, Math.max(defaultPriority, 100 - websiteScore + Math.min(jobCount * 5, 25)))),
  );
  const category = firstCategory(row);
  const hasInstagram = leadHasInstagramProfile(websiteUrl);

  return {
    company,
    contact: text(row.contact) || text(row.ansprechpartner) || ceo,
    email,
    phone: text(enrichment.phone) || text(row.phone) || text(row.telefon) || text(row.phoneNumber),
    websiteUrl,
    city,
    region: state || country,
    category,
    score: number(row.score, Number.isFinite(rating) ? Math.round(rating * 20) : salesPriority),
    confidence: number(row.confidence, enrichment.verificationStatus ? 70 : websiteUrl || text(row.phone) ? 65 : 45),
    websiteScore,
    salesPriority,
    jobCount,
    jobTitles: jobTitle ? [jobTitle] : asArray(row.jobTitles).map(text).filter(Boolean),
    source: text(row.source) || (mapsUrl ? "google-maps" : "import"),
    sourceRecords: 1,
    ceo,
    summary:
      text(row.summary) ||
      (websiteUrl
        ? `${company} wurde mit ${hasInstagram ? "Instagram-Profil" : "Website"}${city ? ` in ${city}` : ""} importiert.`
        : city ? `${company} wurde als Lead in ${city} importiert.` : ""),
    pitch:
      text(row.pitch) ||
      `Ich habe mir ${company} angesehen und konkrete Hebel gefunden, mit denen sich Sichtbarkeit, Vertrauen und qualifizierte Anfragen verbessern lassen.`,
    recommendedOffer: text(row.recommendedOffer) || "JJ-Media Wachstumssystem",
    evidence,
    tags: [
      ...asArray(row.tags).map(text).filter(Boolean),
      ...(hasInstagram ? ["instagram-profil"] : []),
      ...(genericWebsite && !hasInstagram ? ["website"] : []),
      ...(mapsUrl ? ["google-maps"] : []),
      ...categories.slice(0, 5).map((entry) => `kategorie:${entry.toLowerCase()}`),
    ],
  };
}

export function normalizeImport(input: unknown): NormalizedLeadInput[] {
  const object = asRecord(input);
  const rows = Array.isArray(input)
    ? input
    : Array.isArray(object.leads)
      ? (object.leads as unknown[])
      : Array.isArray(object.data)
        ? (object.data as unknown[])
        : Array.isArray(object.results)
          ? (object.results as unknown[])
          : Array.isArray(object.items)
            ? (object.items as unknown[])
            : [];

  const grouped = new Map<string, NormalizedLeadInput>();
  for (const raw of rows) {
    const lead = rowToLead(raw);
    if (!lead) continue;
    const key = leadUrlIdentity(lead.websiteUrl ?? "") || normalizeCompany(lead.company);
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
      region: existing.region || lead.region,
      category: existing.category !== "other" ? existing.category : lead.category,
      ceo: existing.ceo || lead.ceo,
      jobCount: Math.max(existing.jobCount ?? 0, lead.jobCount ?? 0),
      jobTitles: [...titles],
      sourceRecords: (existing.sourceRecords ?? 1) + 1,
      salesPriority: Math.max(existing.salesPriority ?? 0, lead.salesPriority ?? 0),
      websiteScore: existing.websiteScore || lead.websiteScore,
      evidence: evidence.slice(0, 30),
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
    city: incoming.city || current.city,
    region: incoming.region || current.region,
    category: incoming.category || current.category,
    ceo: incoming.ceo || current.ceo,
    jobCount: Math.max(current.jobCount ?? 0, incoming.jobCount ?? 0),
    jobTitles: [...new Set([...(current.jobTitles ?? []), ...(incoming.jobTitles ?? [])])],
    sourceRecords: (current.sourceRecords ?? 1) + (incoming.sourceRecords ?? 1),
    evidence: [...(current.evidence ?? []), ...(incoming.evidence ?? [])].slice(0, 30),
    tags: [...new Set([...(current.tags ?? []), ...(incoming.tags ?? [])])],
  } satisfies NormalizedLeadInput;
}
