import { and, desc, eq, inArray, or } from "drizzle-orm";
import { getDb } from "@/db";
import { leads, researchCandidates, settings } from "@/db/schema";
import { domainFromUrl, normalizeCompany, normalizeWebsite } from "@/lib/leads";
import { enrichWebsite } from "@/lib/website-enrichment";

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

async function googlePlacesSearch(query: string): Promise<DiscoveredCandidate[]> {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) return [];
  const apiKey = key;

  const url = new URL("https://maps.googleapis.com/maps/api/place/textsearch/json");
  url.searchParams.set("query", query);
  url.searchParams.set("language", "de");
  url.searchParams.set("region", "de");
  url.searchParams.set("key", apiKey);

  const result = await fetchJson<{
    status?: string;
    error_message?: string;
    results?: Array<{
      place_id?: string;
      name?: string;
      formatted_address?: string;
      rating?: number;
      user_ratings_total?: number;
      types?: string[];
    }>;
  }>(url);

  if (result.status && !["OK", "ZERO_RESULTS"].includes(result.status)) {
    throw new Error("Google Places: " + result.status + (result.error_message ? " · " + result.error_message : ""));
  }

  const base = (result.results || []).filter((item) => item.place_id && item.name).slice(0, 20);
  const output: DiscoveredCandidate[] = [];

  async function detail(item: (typeof base)[number]) {
    const detailUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
    detailUrl.searchParams.set("place_id", item.place_id!);
    detailUrl.searchParams.set("fields", "name,formatted_address,formatted_phone_number,website,types");
    detailUrl.searchParams.set("language", "de");
    detailUrl.searchParams.set("key", apiKey);
    const details = await fetchJson<{
      status?: string;
      result?: {
        website?: string;
        formatted_phone_number?: string;
        formatted_address?: string;
        types?: string[];
      };
    }>(detailUrl).catch(() => ({ status: "ERROR", result: undefined }));
    const websiteUrl = normalizeWebsite(details.result?.website || "");
    return {
      source: "google_places" as const,
      sourceQuery: query,
      externalId: item.place_id!,
      company: item.name!,
      websiteUrl,
      phone: details.result?.formatted_phone_number || "",
      email: "",
      city: details.result?.formatted_address || item.formatted_address || "",
      region: "",
      category: details.result?.types?.[0] || item.types?.[0] || "other",
      ratingX10: Math.max(0, Math.round(Number(item.rating || 0) * 10)),
      reviewCount: Math.max(0, Math.round(Number(item.user_ratings_total || 0))),
      raw: {
        placeId: item.place_id,
        rating: item.rating || 0,
        reviewCount: item.user_ratings_total || 0,
        address: details.result?.formatted_address || item.formatted_address || "",
      },
    } satisfies DiscoveredCandidate;
  }

  for (let index = 0; index < base.length; index += 5) {
    const batch = await Promise.all(base.slice(index, index + 5).map(detail));
    output.push(...batch);
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

function scoreCandidate(item: DiscoveredCandidate) {
  let score = 20;
  if (item.websiteUrl) score += 18;
  if (item.phone) score += 25;
  if (item.email) score += 22;
  if (item.ratingX10 >= 40) score += 5;
  if (item.reviewCount >= 10) score += 3;
  if (item.reviewCount >= 50) score += 3;
  if (item.reviewCount >= 150) score += 4;
  return Math.min(100, score);
}

function reasonFor(item: DiscoveredCandidate, score: number) {
  const parts = [];
  if (item.phone) parts.push("Telefon vorhanden");
  if (item.email) parts.push("E-Mail vorhanden");
  if (item.websiteUrl) parts.push("Website vorhanden");
  if (item.reviewCount >= 50) parts.push(item.reviewCount + " Google-Bewertungen");
  if (!parts.length) parts.push("Recherchekandidat");
  return parts.join(" · ") + " · Score " + score + "/100";
}

async function enrichTopWebsites(items: DiscoveredCandidate[]) {
  const candidates = items
    .filter((item) => item.websiteUrl && (!item.email || !item.phone))
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, 12);

  for (let index = 0; index < candidates.length; index += 3) {
    const batch = candidates.slice(index, index + 3);
    const results = await Promise.allSettled(batch.map(async (item) => {
      const enriched = await enrichWebsite(item.websiteUrl);
      item.email ||= enriched.email;
      item.phone ||= enriched.phone;
      item.city ||= enriched.city;
      item.region ||= enriched.region;
      item.raw = {
        ...item.raw,
        websiteConfidence: enriched.confidence,
        websitePages: enriched.pagesScanned.slice(0, 6),
        executive: enriched.ceo,
      };
    }));
    void results;
  }
}

export async function runResearchFeed(workspaceId: string, override?: Partial<ResearchFeedConfig>) {
  const stored = await getResearchFeedConfig(workspaceId);
  const config = normalizeResearchConfig({ ...stored, ...override });
  if (!config.queries.length) {
    return { ok: true, configured: false, discovered: 0, inserted: 0, duplicates: 0, source: "none", config };
  }

  const discovered: DiscoveredCandidate[] = [];
  const seen = new Set<string>();
  let googleUsed = false;

  for (const query of config.queries) {
    if (discovered.length >= config.target) break;
    let rows: DiscoveredCandidate[] = [];
    try {
      rows = await googlePlacesSearch(query);
      if (rows.length) googleUsed = true;
    } catch {
      rows = [];
    }
    if (!rows.length) rows = await webSearch(query).catch(() => []);

    for (const row of rows) {
      const identity = candidateIdentity(row);
      if (!identity || seen.has(identity)) continue;
      seen.add(identity);
      discovered.push(row);
      if (discovered.length >= config.target) break;
    }
  }

  if (discovered.length < config.target) {
    for (const query of config.queries) {
      if (discovered.length >= config.target) break;
      const fallback = await webSearch(query).catch(() => []);
      for (const row of fallback) {
        const identity = candidateIdentity(row);
        if (!identity || seen.has(identity)) continue;
        seen.add(identity);
        discovered.push(row);
        if (discovered.length >= config.target) break;
      }
    }
  }

  await enrichTopWebsites(discovered);

  const companies = [...new Set(discovered.map((item) => normalizeCompany(item.company)).filter(Boolean))];
  const domains = [...new Set(discovered.map((item) => domainFromUrl(item.websiteUrl)).filter(Boolean))];

  const db = getDb();
  const [leadCompanyRows, leadDomainRows, candidateCompanyRows, candidateDomainRows] = await Promise.all([
    companies.length
      ? db.select({ normalizedCompany: leads.normalizedCompany }).from(leads)
          .where(and(eq(leads.workspaceId, workspaceId), inArray(leads.normalizedCompany, companies)))
      : Promise.resolve([]),
    domains.length
      ? db.select({ domain: leads.domain }).from(leads)
          .where(and(eq(leads.workspaceId, workspaceId), inArray(leads.domain, domains)))
      : Promise.resolve([]),
    companies.length
      ? db.select({ normalizedCompany: researchCandidates.normalizedCompany }).from(researchCandidates)
          .where(and(eq(researchCandidates.workspaceId, workspaceId), inArray(researchCandidates.normalizedCompany, companies)))
      : Promise.resolve([]),
    domains.length
      ? db.select({ domain: researchCandidates.domain }).from(researchCandidates)
          .where(and(eq(researchCandidates.workspaceId, workspaceId), inArray(researchCandidates.domain, domains)))
      : Promise.resolve([]),
  ]);

  const knownCompanies = new Set([
    ...leadCompanyRows.map((row) => row.normalizedCompany),
    ...candidateCompanyRows.map((row) => row.normalizedCompany),
  ]);
  const knownDomains = new Set([
    ...leadDomainRows.map((row) => row.domain).filter(Boolean),
    ...candidateDomainRows.map((row) => row.domain).filter(Boolean),
  ]);

  const fresh = discovered.filter((item) => {
    const company = normalizeCompany(item.company);
    const domain = domainFromUrl(item.websiteUrl);
    return Boolean(company) && !knownCompanies.has(company) && (!domain || !knownDomains.has(domain));
  });

  if (fresh.length) {
    await db.insert(researchCandidates).values(fresh.map((item) => {
      const score = scoreCandidate(item);
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
        status: "new",
        reason: reasonFor(item, score),
        raw: item.raw,
        discoveredAt: new Date(),
      };
    })).onConflictDoNothing();
  }

  const duplicateCount = Math.max(0, discovered.length - fresh.length);
  return {
    ok: true,
    configured: true,
    discovered: discovered.length,
    inserted: fresh.length,
    duplicates: duplicateCount,
    source: googleUsed ? "google_places+web" : "web_search",
    config,
  };
}

export async function listResearchCandidates(workspaceId: string, status = "new", limit = 200) {
  return getDb()
    .select()
    .from(researchCandidates)
    .where(and(eq(researchCandidates.workspaceId, workspaceId), eq(researchCandidates.status, status)))
    .orderBy(desc(researchCandidates.score), desc(researchCandidates.discoveredAt))
    .limit(Math.max(1, Math.min(limit, 250)));
}

export async function setResearchCandidateStatus(workspaceId: string, ids: string[], status: "new" | "shortlisted" | "dismissed" | "imported") {
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
      or(eq(researchCandidates.status, "new"), eq(researchCandidates.status, "shortlisted")),
    ));
  return rows.map((row) => ({
    company: row.company,
    phone: row.phone,
    email: row.email,
    websiteUrl: row.websiteUrl,
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
