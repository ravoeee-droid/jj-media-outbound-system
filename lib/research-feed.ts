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

  const response = await fetch("https://places.googleapis.com/v1/places:searchText", {
    method: "POST",
    cache: "no-store",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      "x-goog-api-key": apiKey,
      "x-goog-field-mask": [
        "places.id",
        "places.displayName",
        "places.formattedAddress",
        "places.nationalPhoneNumber",
        "places.websiteUri",
        "places.primaryType",
        "places.rating",
        "places.userRatingCount",
      ].join(","),
    },
    body: JSON.stringify({
      textQuery: query,
      languageCode: "de",
      regionCode: "DE",
      pageSize: 20,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Google Places (New): HTTP " + response.status + (detail ? " · " + detail.slice(0, 240) : ""));
  }

  const result = await response.json() as {
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

  return (result.places || [])
    .filter((place) => place.id && place.displayName?.text)
    .slice(0, 20)
    .map((place) => ({
      source: "google_places" as const,
      sourceQuery: query,
      externalId: place.id!,
      company: place.displayName!.text!,
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
      },
    }));
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
  if (typeof item.raw.instagramUrl === "string" && item.raw.instagramUrl) score += 8;
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
  if (typeof item.raw.instagramUrl === "string" && item.raw.instagramUrl) parts.push("Instagram gefunden");
  if (item.reviewCount >= 50) parts.push(item.reviewCount + " Google-Bewertungen");
  if (!parts.length) parts.push("Recherchekandidat");
  return parts.join(" · ") + " · Score " + score + "/100";
}

async function enrichTopWebsites(items: DiscoveredCandidate[]) {
  const candidates = items
    .filter((item) => item.websiteUrl)
    .sort((a, b) => scoreCandidate(b) - scoreCandidate(a))
    .slice(0, 20);

  for (let index = 0; index < candidates.length; index += 3) {
    const batch = candidates.slice(index, index + 3);
    const results = await Promise.allSettled(batch.map(async (item) => {
      const enriched = await enrichWebsite(item.websiteUrl);
      item.email ||= enriched.email;
      item.phone ||= enriched.phone;
      item.city ||= enriched.city;
      item.region ||= enriched.region;
      const socialLinks = enriched.evidence
        .filter((entry) => entry.kind === "social")
        .map((entry) => entry.value);
      const instagramUrl = socialLinks.find((url) => /instagram\.com/i.test(url)) || "";
      item.raw = {
        ...item.raw,
        websiteConfidence: enriched.confidence,
        websitePages: enriched.pagesScanned.slice(0, 6),
        executive: enriched.ceo,
        socialLinks: socialLinks.slice(0, 5),
        instagramUrl,
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

  let inserted = 0;
  if (fresh.length) {
    const rows = await db.insert(researchCandidates).values(fresh.map((item) => {
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
    })).onConflictDoNothing().returning({ id: researchCandidates.id });
    inserted = rows.length;
  }

  const duplicateCount = Math.max(0, discovered.length - inserted);
  return {
    ok: true,
    configured: true,
    discovered: discovered.length,
    inserted,
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
        or(eq(researchCandidates.status, "new"), eq(researchCandidates.status, "shortlisted")),
      ))
      .returning({ id: researchCandidates.id });
    updated += rows.length;
  }
  return updated;
}
