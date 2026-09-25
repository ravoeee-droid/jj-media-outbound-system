import { and, desc, eq, inArray, ne, or } from "drizzle-orm";
import { getDb } from "@/db";
import { leads, researchCandidates, settings } from "@/db/schema";
import { domainFromUrl, normalizeCompany, normalizeWebsite } from "@/lib/leads";
import { enrichWebsite } from "@/lib/website-enrichment";
import { isCallReady, scoreValidatedCandidate, validateResearchContacts, type ResearchContactValidation } from "@/lib/research-validation";

export type ResearchFeedConfig = {
  enabled: boolean;
  target: number;
  queries: string[];
};

export const defaultResearchFeedConfig: ResearchFeedConfig = {
  enabled: false,
  target: 100,
  queries: [],
};

type DiscoveredCandidate = {
  source: "google_places" | "web_search";
  sourceQuery: string;
  externalId: string;
  company: string;
  websiteUrl: string;
  phone: string;
  email: string;
  city: string;
  region: string;
  category: string;
  ratingX10: number;
  reviewCount: number;
  raw: Record<string, unknown>;
};

const BLOCKED_DOMAINS = [
  "google.com",
  "google.de",
  "bing.com",
  "duckduckgo.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "xing.com",
  "youtube.com",
  "wikipedia.org",
  "tripadvisor.de",
  "tripadvisor.com",
  "yelp.de",
  "yelp.com",
  "gelbeseiten.de",
  "dasoertliche.de",
  "11880.com",
  "cylex.de",
  "meinestadt.de",
  "indeed.com",
  "stepstone.de",
  "kununu.com",
];

function cleanQueries(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter((value) => value.length >= 3))].slice(0, 10);
}

export function normalizeResearchConfig(input: Partial<ResearchFeedConfig>): ResearchFeedConfig {
  return {
    enabled: Boolean(input.enabled),
    target: Math.max(20, Math.min(100, Math.round(Number(input.target) || 100))),
    queries: cleanQueries(Array.isArray(input.queries) ? input.queries : []),
  };
}

export async function getResearchFeedConfig(workspaceId: string) {
  const [row] = await getDb()
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, "research_feed_config")))
    .limit(1);
  if (!row?.value) return defaultResearchFeedConfig;
  try {
    return normalizeResearchConfig(JSON.parse(row.value) as Partial<ResearchFeedConfig>);
  } catch {
    return defaultResearchFeedConfig;
  }
}

export async function saveResearchFeedConfig(workspaceId: string, config: ResearchFeedConfig) {
  const normalized = normalizeResearchConfig(config);
  await getDb()
    .insert(settings)
    .values({ workspaceId, key: "research_feed_config", value: JSON.stringify(normalized) })
    .onConflictDoUpdate({
      target: [settings.workspaceId, settings.key],
      set: { value: JSON.stringify(normalized), updatedAt: new Date() },
    });
  return normalized;
}

async function fetchJson<T>(url: URL) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: { accept: "application/json" },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error("HTTP " + response.status);
  return response.json() as Promise<T>;
}

async function googlePlacesSearch(query: string, limit = 60): Promise<DiscoveredCandidate[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) return [];
  const output: DiscoveredCandidate[] = [];
  let pageToken = "";

  for (let page = 0; page < 3 && output.length < Math.min(60, limit); page += 1) {
    const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      cache: "no-store",
      headers: {
        accept: "application/json",
        "content-type": "application/json",
        "x-goog-api-key": key,
        "x-goog-field-mask": [
          "places.id",
          "places.displayName",
          "places.formattedAddress",
          "places.nationalPhoneNumber",
          "places.websiteUri",
          "places.primaryType",
          "places.rating",
          "places.userRatingCount",
          "nextPageToken",
        ].join(","),
      },
      body: JSON.stringify({
        textQuery: query,
        languageCode: "de",
        regionCode: "DE",
        pageSize: Math.min(20, Math.max(1, Math.min(60, limit) - output.length)),
        ...(pageToken ? { pageToken } : {}),
      }),
      signal: AbortSignal.timeout(15_000),
    });

    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      throw new Error("Google Places (New): HTTP " + response.status + (detail ? " · " + detail.slice(0, 240) : ""));
    }

    const result = await response.json() as {
      nextPageToken?: string;
      places?: Array<{
        id?: string;
        displayName?: { text?: string; languageCode?: string };
        formattedAddress?: string;
        nationalPhoneNumber?: string;
        websiteUri?: string;
        primaryType?: string;
        rating?: number;
        userRatingCount?: number;
      }>;
    };

    for (const place of result.places || []) {
      if (!place.id || !place.displayName?.text) continue;
      output.push({
        source: "google_places",
        sourceQuery: query,
        externalId: place.id,
        company: place.displayName.text,
        websiteUrl: normalizeWebsite(place.websiteUri || ""),
        phone: place.nationalPhoneNumber || "",
        email: "",
        city: place.formattedAddress || "",
        region: "",
        category: place.primaryType || "other",
        ratingX10: Math.max(0, Math.round(Number(place.rating || 0) * 10)),
        reviewCount: Math.max(0, Math.round(Number(place.userRatingCount || 0))),
        raw: {
          placeId: place.id,
          rating: place.rating || 0,
          reviewCount: place.userRatingCount || 0,
          address: place.formattedAddress || "",
          api: "places-new",
          phoneSource: place.nationalPhoneNumber ? "google_places" : "",
        },
      });
      if (output.length >= Math.min(60, limit)) break;
    }
    pageToken = result.nextPageToken || "";
    if (!pageToken) break;
  }
  return output;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function cleanSearchUrl(href: string) {
  try {
    const absolute = new URL(decodeHtml(href), "https://html.duckduckgo.com");
    const redirected = absolute.hostname.endsWith("duckduckgo.com")
      ? absolute.searchParams.get("uddg") || ""
      : absolute.toString();
    const url = new URL(decodeURIComponent(redirected));
    if (!["http:", "https:"].includes(url.protocol)) return "";
    const domain = url.hostname.replace(/^www\./, "").toLowerCase();
    if (BLOCKED_DOMAINS.some((blocked) => domain === blocked || domain.endsWith("." + blocked))) return "";
    url.hash = "";
    return normalizeWebsite(url.toString());
  } catch {
    return "";
  }
}

function plainTitle(value: string) {
  return decodeHtml(value.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .replace(/\s+[|–—-]\s+.+$/, "")
    .trim()
    .slice(0, 180);
}

async function webSearch(query: string): Promise<DiscoveredCandidate[]> {
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query + " offizielle Website");
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "de-DE,de;q=0.9,en;q=0.6",
      "user-agent": "Mozilla/5.0 (compatible; JJMediaResearch/1.0)",
    },
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) return [];
  const html = await response.text();
  const matches = [...html.matchAll(/<a[^>]+class=["'][^"']*result__a[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];
  const output: DiscoveredCandidate[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const websiteUrl = cleanSearchUrl(match[1]);
    const domain = domainFromUrl(websiteUrl);
    const company = plainTitle(match[2]);
    if (!websiteUrl || !domain || !company || seen.has(domain)) continue;
    seen.add(domain);
    output.push({
      source: "web_search",
      sourceQuery: query,
      externalId: domain,
      company,
      websiteUrl,
      phone: "",
      email: "",
      city: "",
      region: "",
      category: "other",
      ratingX10: 0,
      reviewCount: 0,
      raw: { resultTitle: company, resultUrl: websiteUrl },
    });
    if (output.length >= 20) break;
  }
  return output;
}

function candidateIdentity(item: DiscoveredCandidate) {
  const domain = domainFromUrl(item.websiteUrl);
  return domain ? "domain:" + domain : "company:" + normalizeCompany(item.company);
}

function validateCandidate(item: DiscoveredCandidate): ResearchContactValidation {
  const instagramUrl = typeof item.raw.instagramUrl === "string" ? item.raw.instagramUrl : "";
  const validation = validateResearchContacts({
    phone: item.phone,
    email: item.email,
    instagramUrl,
    websiteUrl: item.websiteUrl,
    phoneSource: typeof item.raw.phoneSource === "string" ? item.raw.phoneSource : item.phone ? item.source : "",
    emailSource: typeof item.raw.emailSource === "string" ? item.raw.emailSource : item.email ? item.source : "",
    instagramSource: typeof item.raw.instagramSource === "string" ? item.raw.instagramSource : instagramUrl ? "website" : "",
  });
  item.phone = validation.phone.normalized;
  item.email = validation.email.normalized;
  item.raw = { ...item.raw, instagramUrl: validation.instagram.normalized, contactValidation: validation };
  return validation;
}

function scoreCandidate(item: DiscoveredCandidate) {
  const validation = validateCandidate(item);
  return scoreValidatedCandidate({
    websiteUrl: item.websiteUrl,
    source: item.source,
    ratingX10: item.ratingX10,
    reviewCount: item.reviewCount,
    validation,
  });
}

function reasonFor(item: DiscoveredCandidate, score: number) {
  const validation = validateCandidate(item);
  const parts = [];
  if (validation.phone.valid) parts.push("Telefon validiert");
  if (validation.email.valid) parts.push(validation.email.corporateMatch ? "Firmen-E-Mail validiert" : "E-Mail plausibel");
  if (validation.instagram.valid) parts.push("Instagram-Profil validiert");
  if (item.websiteUrl) parts.push("Website vorhanden");
  if (item.reviewCount >= 50) parts.push(item.reviewCount + " Google-Bewertungen");
  if (!parts.length) parts.push("Kontakt noch unvollständig");
  return parts.join(" · ") + " · Score " + score + "/100";
}

async function enrichCandidates(items: DiscoveredCandidate[], budgetMs = 190_000) {
  const startedAt = Date.now();
  const candidates = items
    .filter((item) => item.websiteUrl)
    .sort((a, b) => {
      const aPhone = validateCandidate(a).phone.valid ? 1 : 0;
      const bPhone = validateCandidate(b).phone.valid ? 1 : 0;
      return aPhone - bPhone || scoreCandidate(b) - scoreCandidate(a);
    })
    .slice(0, 120);

  let enriched = 0;
  let failed = 0;
  for (let index = 0; index < candidates.length; index += 5) {
    if (Date.now() - startedAt >= budgetMs) break;
    const batch = candidates.slice(index, index + 5);
    const results = await Promise.allSettled(batch.map(async (item) => {
      const enrichedWebsite = await enrichWebsite(item.websiteUrl);
      if (!item.email && enrichedWebsite.email) {
        item.email = enrichedWebsite.email;
        item.raw.emailSource = "website";
      }
      if (!item.phone && enrichedWebsite.phone) {
        item.phone = enrichedWebsite.phone;
        item.raw.phoneSource = "website";
      }
      item.city ||= enrichedWebsite.city;
      item.region ||= enrichedWebsite.region;
      const socialLinks = enrichedWebsite.evidence.filter((entry) => entry.kind === "social").map((entry) => entry.value);
      const instagramUrl = socialLinks.find((url) => /instagram\.com/i.test(url)) || "";
      item.raw = {
        ...item.raw,
        websiteConfidence: enrichedWebsite.confidence,
        websitePages: enrichedWebsite.pagesScanned.slice(0, 6),
        executive: enrichedWebsite.ceo,
        socialLinks: socialLinks.slice(0, 5),
        instagramUrl: instagramUrl || item.raw.instagramUrl || "",
        instagramSource: instagramUrl ? "website" : item.raw.instagramSource || "",
      };
      validateCandidate(item);
    }));
    enriched += results.filter((result) => result.status === "fulfilled").length;
    failed += results.filter((result) => result.status === "rejected").length;
  }
  return { enriched, failed };
}

type ResearchRunSummary = {
  finishedAt: string;
  source: string;
  target: number;
  readyBefore: number;
  readyAdded: number;
  readyAfter: number;
  discovered: number;
  inserted: number;
  duplicates: number;
  enriched: number;
};

async function saveResearchRunSummary(workspaceId: string, summary: ResearchRunSummary) {
  await getDb().insert(settings).values({ workspaceId, key: "research_feed_last_run", value: JSON.stringify(summary) })
    .onConflictDoUpdate({ target: [settings.workspaceId, settings.key], set: { value: JSON.stringify(summary), updatedAt: new Date() } });
}

export async function getResearchFeedLastRun(workspaceId: string): Promise<ResearchRunSummary | null> {
  const [row] = await getDb().select({ value: settings.value }).from(settings)
    .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, "research_feed_last_run"))).limit(1);
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as ResearchRunSummary; } catch { return null; }
}

export async function runResearchFeed(workspaceId: string, override?: Partial<ResearchFeedConfig>) {
  const stored = await getResearchFeedConfig(workspaceId);
  const config = normalizeResearchConfig({ ...stored, ...override });
  if (!config.queries.length) {
    return { ok: true, configured: false, discovered: 0, inserted: 0, duplicates: 0, callReady: 0, readyBefore: 0, readyAfter: 0, enriched: 0, source: "none", config };
  }

  const db = getDb();
  const existingReady = await db.select({ id: researchCandidates.id }).from(researchCandidates)
    .where(and(eq(researchCandidates.workspaceId, workspaceId), eq(researchCandidates.status, "call_ready"))).limit(config.target);
  const readyBefore = existingReady.length;
  const needed = Math.max(0, config.target - readyBefore);

  if (!needed) {
    const summary: ResearchRunSummary = { finishedAt: new Date().toISOString(), source: "stock", target: config.target, readyBefore, readyAdded: 0, readyAfter: readyBefore, discovered: 0, inserted: 0, duplicates: 0, enriched: 0 };
    await saveResearchRunSummary(workspaceId, summary);
    return { ok: true, configured: true, discovered: 0, inserted: 0, duplicates: 0, callReady: 0, readyBefore, readyAfter: readyBefore, enriched: 0, source: "stock", config };
  }

  const discoveryTarget = Math.min(300, Math.max(config.target, needed * 3));
  const discovered: DiscoveredCandidate[] = [];
  const seen = new Set<string>();
  let googleUsed = false;

  for (const query of config.queries) {
    if (discovered.length >= discoveryTarget) break;
    let rows: DiscoveredCandidate[] = [];
    try {
      rows = await googlePlacesSearch(query, Math.min(60, discoveryTarget - discovered.length));
      if (rows.length) googleUsed = true;
    } catch { rows = []; }
    if (!rows.length) rows = await webSearch(query).catch(() => []);
    for (const row of rows) {
      validateCandidate(row);
      const identity = candidateIdentity(row);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      discovered.push(row);
      if (discovered.length >= discoveryTarget) break;
    }
  }

  if (discovered.length < discoveryTarget) {
    for (const query of config.queries) {
      if (discovered.length >= discoveryTarget) break;
      const fallback = await webSearch(query).catch(() => []);
      for (const row of fallback) {
        validateCandidate(row);
        const identity = candidateIdentity(row);
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        discovered.push(row);
        if (discovered.length >= discoveryTarget) break;
      }
    }
  }

  const companies = [...new Set(discovered.map((item) => normalizeCompany(item.company)).filter(Boolean))];
  const domains = [...new Set(discovered.map((item) => domainFromUrl(item.websiteUrl)).filter(Boolean))];
  const [leadCompanyRows, leadDomainRows, candidateCompanyRows, candidateDomainRows, leadPhoneRows, candidatePhoneRows] = await Promise.all([
    companies.length ? db.select({ normalizedCompany: leads.normalizedCompany }).from(leads).where(and(eq(leads.workspaceId, workspaceId), inArray(leads.normalizedCompany, companies))) : Promise.resolve([]),
    domains.length ? db.select({ domain: leads.domain }).from(leads).where(and(eq(leads.workspaceId, workspaceId), inArray(leads.domain, domains))) : Promise.resolve([]),
    companies.length ? db.select({ normalizedCompany: researchCandidates.normalizedCompany }).from(researchCandidates).where(and(eq(researchCandidates.workspaceId, workspaceId), inArray(researchCandidates.normalizedCompany, companies))) : Promise.resolve([]),
    domains.length ? db.select({ domain: researchCandidates.domain }).from(researchCandidates).where(and(eq(researchCandidates.workspaceId, workspaceId), inArray(researchCandidates.domain, domains))) : Promise.resolve([]),
    db.select({ phone: leads.phone }).from(leads).where(and(eq(leads.workspaceId, workspaceId), ne(leads.phone, ""))),
    db.select({ phone: researchCandidates.phone }).from(researchCandidates).where(and(eq(researchCandidates.workspaceId, workspaceId), ne(researchCandidates.phone, ""))),
  ]);

  const knownCompanies = new Set([...leadCompanyRows.map((row) => row.normalizedCompany), ...candidateCompanyRows.map((row) => row.normalizedCompany)]);
  const knownDomains = new Set([...leadDomainRows.map((row) => row.domain).filter(Boolean), ...candidateDomainRows.map((row) => row.domain).filter(Boolean)]);
  const knownPhones = new Set([...leadPhoneRows, ...candidatePhoneRows]
    .map((row) => validateResearchContacts({ phone: row.phone, email: "", instagramUrl: "", websiteUrl: "" }).phone.normalized).filter(Boolean));

  const fresh: DiscoveredCandidate[] = [];
  const freshPhones = new Set<string>();
  for (const item of discovered) {
    const company = normalizeCompany(item.company);
    const domain = domainFromUrl(item.websiteUrl);
    const phone = validateCandidate(item).phone.normalized;
    if (!company || knownCompanies.has(company) || (domain && knownDomains.has(domain)) || (phone && (knownPhones.has(phone) || freshPhones.has(phone)))) continue;
    fresh.push(item);
    if (phone) freshPhones.add(phone);
  }

  const enrichment = await enrichCandidates(fresh);
  const evaluated = fresh.map((item) => {
    const validation = validateCandidate(item);
    const score = scoreCandidate(item);
    return { item, score, callReady: isCallReady(validation, score) };
  }).sort((a, b) => b.score - a.score || b.item.reviewCount - a.item.reviewCount);

  const rowsToInsert = [
    ...evaluated.filter((row) => row.callReady).slice(0, needed),
    ...evaluated.filter((row) => !row.callReady).slice(0, 30),
  ];

  let inserted = 0;
  let callReady = 0;
  if (rowsToInsert.length) {
    const rows = await db.insert(researchCandidates).values(rowsToInsert.map(({ item, score, callReady }) => {
      const websiteUrl = normalizeWebsite(item.websiteUrl);
      return {
        workspaceId,
        source: item.source,
        sourceQuery: item.sourceQuery,
        externalId: item.externalId || domainFromUrl(websiteUrl) || normalizeCompany(item.company),
        company: item.company,
        normalizedCompany: normalizeCompany(item.company),
        websiteUrl,
        domain: domainFromUrl(websiteUrl),
        phone: item.phone,
        email: item.email,
        city: item.city,
        region: item.region,
        category: item.category,
        ratingX10: item.ratingX10,
        reviewCount: item.reviewCount,
        score,
        status: callReady ? "call_ready" : "new",
        reason: reasonFor(item, score),
        raw: item.raw,
        discoveredAt: new Date(),
      };
    })).onConflictDoNothing().returning({ id: researchCandidates.id, status: researchCandidates.status });
    inserted = rows.length;
    callReady = rows.filter((row) => row.status === "call_ready").length;
  }

  const duplicateCount = Math.max(0, discovered.length - fresh.length);
  const readyAfter = readyBefore + callReady;
  const source = googleUsed ? "google_places+web" : "web_search";
  const summary: ResearchRunSummary = { finishedAt: new Date().toISOString(), source, target: config.target, readyBefore, readyAdded: callReady, readyAfter, discovered: discovered.length, inserted, duplicates: duplicateCount, enriched: enrichment.enriched };
  await saveResearchRunSummary(workspaceId, summary);
  return { ok: true, configured: true, discovered: discovered.length, inserted, duplicates: duplicateCount, callReady, readyBefore, readyAfter, enriched: enrichment.enriched, enrichmentFailed: enrichment.failed, source, config };
}

export async function listResearchCandidates(workspaceId: string, status = "new", limit = 200) {
  return getDb()
    .select()
    .from(researchCandidates)
    .where(and(eq(researchCandidates.workspaceId, workspaceId), eq(researchCandidates.status, status)))
    .orderBy(desc(researchCandidates.score), desc(researchCandidates.discoveredAt))
    .limit(Math.max(1, Math.min(limit, 250)));
}

export async function setResearchCandidateStatus(workspaceId: string, ids: string[], status: "new" | "call_ready" | "shortlisted" | "dismissed" | "imported") {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) return 0;
  const rows = await getDb()
    .update(researchCandidates)
    .set({ status, reviewedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(researchCandidates.workspaceId, workspaceId), inArray(researchCandidates.id, unique)))
    .returning({ id: researchCandidates.id });
  return rows.length;
}

export async function researchCandidatesForIntake(workspaceId: string, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 30);
  if (!unique.length) return [];
  const rows = await getDb()
    .select()
    .from(researchCandidates)
    .where(and(
      eq(researchCandidates.workspaceId, workspaceId),
      inArray(researchCandidates.id, unique),
      or(eq(researchCandidates.status, "new"), eq(researchCandidates.status, "call_ready"), eq(researchCandidates.status, "shortlisted")),
    ));
  return rows.map((row) => ({
    company: row.company,
    phone: row.phone,
    email: row.email,
    websiteUrl: row.websiteUrl,
    instagramUrl: typeof row.raw.instagramUrl === "string" ? row.raw.instagramUrl : "",
    city: row.city,
    region: row.region,
    category: row.category,
    salesPriority: row.score,
    confidence: row.phone || row.email ? 80 : row.websiteUrl ? 65 : 40,
    source: "research-feed:" + row.source,
    summary: row.reason,
    tags: ["research-feed", "quelle:" + row.source, "candidate:" + row.id],
  }));
}


export async function markResearchCandidatesImported(
  workspaceId: string,
  mappings: Array<{ candidateId: string; leadId: string }>,
) {
  const unique = new Map<string, string>();
  for (const mapping of mappings) {
    if (mapping.candidateId && mapping.leadId) unique.set(mapping.candidateId, mapping.leadId);
  }

  let updated = 0;
  for (const [candidateId, leadId] of [...unique.entries()].slice(0, 30)) {
    const rows = await getDb()
      .update(researchCandidates)
      .set({
        status: "imported",
        importedLeadId: leadId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(researchCandidates.workspaceId, workspaceId),
        eq(researchCandidates.id, candidateId),
        or(eq(researchCandidates.status, "new"), eq(researchCandidates.status, "call_ready"), eq(researchCandidates.status, "shortlisted")),
      ))
      .returning({ id: researchCandidates.id });
    updated += rows.length;
  }
  return updated;
}

export async function restoreResearchCandidates(workspaceId: string, ids: string[]) {
  const unique = [...new Set(ids)].slice(0, 100);
  if (!unique.length) return 0;
  const db = getDb();
  const rows = await db.select({ id: researchCandidates.id, raw: researchCandidates.raw }).from(researchCandidates)
    .where(and(eq(researchCandidates.workspaceId, workspaceId), inArray(researchCandidates.id, unique), eq(researchCandidates.status, "dismissed")));
  const ready = rows.filter((row) => {
    const value = row.raw?.contactValidation;
    return Boolean(value && typeof value === "object" && !Array.isArray(value) && (value as { phone?: { valid?: boolean } }).phone?.valid);
  }).map((row) => row.id);
  const readySet = new Set(ready);
  const review = rows.filter((row) => !readySet.has(row.id)).map((row) => row.id);
  let updated = 0;
  if (ready.length) {
    const changed = await db.update(researchCandidates).set({ status: "call_ready", reviewedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(researchCandidates.workspaceId, workspaceId), inArray(researchCandidates.id, ready), eq(researchCandidates.status, "dismissed"))).returning({ id: researchCandidates.id });
    updated += changed.length;
  }
  if (review.length) {
    const changed = await db.update(researchCandidates).set({ status: "new", reviewedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(researchCandidates.workspaceId, workspaceId), inArray(researchCandidates.id, review), eq(researchCandidates.status, "dismissed"))).returning({ id: researchCandidates.id });
    updated += changed.length;
  }
  return updated;
}
