import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads } from "@/db/schema";
import { domainFromUrl, normalizeCompany, normalizeWebsite } from "@/lib/leads";
import { enrichWebsite } from "@/lib/website-enrichment";

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com",
  "googlemail.com",
  "outlook.com",
  "hotmail.com",
  "live.com",
  "icloud.com",
  "me.com",
  "yahoo.com",
  "yahoo.de",
  "gmx.de",
  "gmx.net",
  "web.de",
  "t-online.de",
  "aol.com",
  "proton.me",
  "protonmail.com",
]);

const EXCLUDED_SEARCH_DOMAINS = [
  "duckduckgo.com",
  "google.com",
  "facebook.com",
  "instagram.com",
  "linkedin.com",
  "xing.com",
  "youtube.com",
  "wikipedia.org",
  "kununu.com",
  "indeed.com",
  "stepstone.de",
  "meinestadt.de",
  "dasoertliche.de",
  "11880.com",
  "cylex.de",
  "northdata.de",
  "firmenwissen.de",
  "companyhouse.de",
  "golocal.de",
  "branchenbuch.meinestadt.de",
];

type LeadRow = typeof leads.$inferSelect;

type Discovery = {
  websiteUrl: string;
  source: "stored" | "domain" | "email_domain" | "google_places" | "web_search";
  phone?: string;
  city?: string;
  evidence?: string[];
};

type Candidate = Pick<Discovery, "websiteUrl" | "source">;

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

function corporateEmailDomain(email: string) {
  const domain = email.trim().toLowerCase().split("@")[1] || "";
  if (!domain.includes(".") || FREE_EMAIL_DOMAINS.has(domain)) return "";
  return domain.replace(/^www\./, "");
}

function uniqueCandidates(lead: LeadRow) {
  const candidates: Candidate[] = [];
  const seen = new Set<string>();
  const add = (value: string, source: Candidate["source"]) => {
    const websiteUrl = normalizeWebsite(value);
    const domain = domainFromUrl(websiteUrl);
    if (!websiteUrl || !domain || seen.has(domain)) return;
    seen.add(domain);
    candidates.push({ websiteUrl, source });
  };

  add(lead.websiteUrl, "stored");
  add(lead.domain, "domain");
  add(corporateEmailDomain(lead.email), "email_domain");
  return candidates;
}

async function fetchJson<T>(url: URL) {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json() as Promise<T>;
}

async function discoverViaGooglePlaces(lead: LeadRow): Promise<Discovery | null> {
  const key = process.env.GOOGLE_PLACES_API_KEY?.trim();
  if (!key) return null;

  const query = [lead.company, lead.city, lead.region].filter(Boolean).join(" ");
  const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
  searchUrl.searchParams.set("input", query);
  searchUrl.searchParams.set("inputtype", "textquery");
  searchUrl.searchParams.set("fields", "place_id,name,formatted_address");
  searchUrl.searchParams.set("key", key);

  const search = await fetchJson<{
    status?: string;
    error_message?: string;
    candidates?: Array<{ place_id?: string; formatted_address?: string }>;
  }>(searchUrl);

  if (search.status && !["OK", "ZERO_RESULTS"].includes(search.status)) {
    throw new Error(`Google Places: ${search.status}`);
  }

  const place = search.candidates?.[0];
  if (!place?.place_id) return null;

  const detailUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
  detailUrl.searchParams.set("place_id", place.place_id);
  detailUrl.searchParams.set("fields", "name,formatted_address,formatted_phone_number,website");
  detailUrl.searchParams.set("key", key);

  const details = await fetchJson<{
    status?: string;
    result?: {
      website?: string;
      formatted_phone_number?: string;
      formatted_address?: string;
    };
  }>(detailUrl);

  if (details.status && details.status !== "OK") {
    throw new Error(`Google Places Details: ${details.status}`);
  }

  const websiteUrl = normalizeWebsite(details.result?.website || "");
  if (!websiteUrl) return null;

  return {
    websiteUrl,
    source: "google_places",
    phone: details.result?.formatted_phone_number || "",
    city: details.result?.formatted_address || place.formatted_address || "",
    evidence: ["Unternehmenswebsite über Google Places gefunden"],
  };
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, "\"")
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCharCode(Number(code)));
}

function cleanSearchResultUrl(href: string) {
  try {
    const absolute = new URL(decodeHtml(href), "https://duckduckgo.com");
    const redirected = absolute.hostname.endsWith("duckduckgo.com")
      ? absolute.searchParams.get("uddg") || ""
      : absolute.toString();
    const url = new URL(decodeURIComponent(redirected));
    if (!/^https?:$/.test(url.protocol)) return "";
    const hostname = url.hostname.replace(/^www\./, "").toLowerCase();
    if (EXCLUDED_SEARCH_DOMAINS.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`))) return "";
    return normalizeWebsite(url.toString());
  } catch {
    return "";
  }
}

function searchResultScore(lead: LeadRow, url: string, title: string) {
  const normalizedCompany = normalizeCompany(lead.company);
  const tokens = normalizedCompany.split(/\s+/).filter((token) => token.length >= 4);
  const titleText = normalizeCompany(title);
  const hostname = domainFromUrl(url).replace(/[^a-z0-9]/g, " ");
  let score = 0;

  if (normalizedCompany && titleText.includes(normalizedCompany)) score += 6;
  for (const token of tokens) {
    if (hostname.includes(token)) score += 4;
    if (titleText.includes(token)) score += 2;
  }
  if (lead.city && titleText.includes(normalizeCompany(lead.city))) score += 2;
  if (/karriere|jobs|stellenangebote/.test(`${hostname} ${titleText}`)) score -= 3;
  return score;
}

async function discoverViaWebSearch(lead: LeadRow): Promise<Discovery | null> {
  const query = `\"${lead.company}\" ${lead.city || lead.region || "Deutschland"} offizielle Website`;
  const url = new URL("https://html.duckduckgo.com/html/");
  url.searchParams.set("q", query);

  const response = await fetch(url, {
    signal: AbortSignal.timeout(12_000),
    headers: {
      accept: "text/html,application/xhtml+xml",
      "accept-language": "de-DE,de;q=0.9,en;q=0.6",
      "user-agent": "Mozilla/5.0 (compatible; DigitaleGewinnerEnrichment/1.0)",
    },
  });
  if (!response.ok) return null;
  const html = await response.text();
  const results: Array<{ url: string; title: string; score: number }> = [];

  for (const match of html.matchAll(/<a\b([^>]+)>([\s\S]*?)<\/a>/gi)) {
    const attributes = match[1] || "";
    if (!/result__a/i.test(attributes)) continue;
    const href = attributes.match(/\bhref=["']([^"']+)["']/i)?.[1] || "";
    const resultUrl = cleanSearchResultUrl(href);
    if (!resultUrl) continue;
    const title = decodeHtml((match[2] || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
    results.push({ url: resultUrl, title, score: searchResultScore(lead, resultUrl, title) });
    if (results.length >= 10) break;
  }

  results.sort((a, b) => b.score - a.score);
  const best = results[0];
  if (!best || best.score < 4) return null;
  return {
    websiteUrl: best.url,
    source: "web_search",
    evidence: [`Unternehmenswebsite über Websuche gefunden: ${best.title}`],
  };
}

async function tryEnrichment(candidate: Discovery) {
  const enrichment = await enrichWebsite(candidate.websiteUrl);
  return { candidate, enrichment };
}

export async function enrichLeadManually({
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

  const attempts: string[] = [];
  let resolved: Awaited<ReturnType<typeof tryEnrichment>> | null = null;

  for (const candidate of uniqueCandidates(lead)) {
    try {
      resolved = await tryEnrichment(candidate);
      break;
    } catch (error) {
      attempts.push(`${candidate.source}: ${error instanceof Error ? error.message : "nicht erreichbar"}`);
    }
  }

  if (!resolved) {
    try {
      const places = await discoverViaGooglePlaces(lead);
      if (places) resolved = await tryEnrichment(places);
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : "Google Places fehlgeschlagen");
    }
  }

  if (!resolved) {
    try {
      const webSearch = await discoverViaWebSearch(lead);
      if (webSearch) resolved = await tryEnrichment(webSearch);
    } catch (error) {
      attempts.push(error instanceof Error ? error.message : "Websuche fehlgeschlagen");
    }
  }

  if (!resolved) {
    const detail = attempts.slice(0, 3).join(" · ");
    throw new Error(detail
      ? `Keine belastbare Unternehmenswebsite gefunden. ${detail}`
      : "Keine belastbare Unternehmenswebsite gefunden.");
  }

  const { candidate, enrichment } = resolved;
  const email = force ? enrichment.email || lead.email : lead.email || enrichment.email;
  const phoneCandidate = enrichment.phone || candidate.phone || "";
  const phone = force ? phoneCandidate || lead.phone : lead.phone || phoneCandidate;
  const ceo = force ? enrichment.ceo || lead.ceo : lead.ceo || enrichment.ceo;
  const contact = force ? enrichment.contact || lead.contact : lead.contact || enrichment.contact;
  const cityCandidate = enrichment.city || candidate.city || "";
  const city = force ? cityCandidate || lead.city : lead.city || cityCandidate;
  const region = force ? enrichment.region || lead.region : lead.region || enrichment.region;
  const summary = force ? enrichment.summary || lead.summary : lead.summary || enrichment.summary;
  const foundSignals = [email, phone, ceo].filter(Boolean).length;
  const resolutionEvidence = [
    ...(candidate.evidence || []),
    `Website-Auflösung: ${candidate.source}`,
  ];

  const [updated] = await db
    .update(leads)
    .set({
      websiteUrl: candidate.websiteUrl,
      domain: domainFromUrl(candidate.websiteUrl),
      email,
      phone,
      ceo,
      contact,
      city,
      region,
      summary,
      confidence: Math.max(lead.confidence, enrichment.confidence),
      salesPriority: Math.max(lead.salesPriority, foundSignals >= 3 ? 80 : foundSignals === 2 ? 65 : foundSignals === 1 ? 50 : 25),
      evidence: mergeEvidence(lead.evidence, [...resolutionEvidence, ...enrichment.evidence]),
      tags: [...new Set([...lead.tags, ...enrichment.tags, "manuell-enriched"])],
      updatedAt: new Date(),
    })
    .where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId)))
    .returning();

  const found = [
    `Website: ${candidate.websiteUrl}`,
    email ? `E-Mail: ${email}` : "",
    phone ? `Telefon: ${phone}` : "",
    ceo ? `Geschäftsführung: ${ceo}` : "",
  ].filter(Boolean);

  await db.insert(activities).values({
    workspaceId,
    leadId,
    userId: userId || null,
    type: "website_enriched_manual",
    title: "Website-Daten manuell ergänzt",
    detail: `${found.join(" · ")}. ${enrichment.pagesScanned.length} Seiten geprüft.`,
    metadata: {
      mode: "manual",
      websiteResolutionSource: candidate.source,
      pagesScanned: enrichment.pagesScanned,
      confidence: enrichment.confidence,
      foundEmail: Boolean(enrichment.email),
      foundPhone: Boolean(enrichment.phone || candidate.phone),
      foundExecutive: Boolean(enrichment.ceo),
    },
  });

  return { lead: updated, enrichment, websiteResolutionSource: candidate.source };
}
