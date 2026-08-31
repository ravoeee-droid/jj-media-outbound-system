import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

const MAX_HTML_BYTES = 1_750_000;
const MAX_REDIRECTS = 4;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_PAGES = 6;

export type WebsiteEnrichmentEvidence = {
  kind: "email" | "phone" | "executive" | "address" | "social" | "description";
  value: string;
  source: string;
  label?: string;
};

export type WebsiteEnrichmentResult = {
  email: string;
  phone: string;
  ceo: string;
  contact: string;
  city: string;
  region: string;
  summary: string;
  confidence: number;
  evidence: WebsiteEnrichmentEvidence[];
  tags: string[];
  pagesScanned: string[];
};

type PageData = {
  url: string;
  html: string;
  text: string;
  emails: string[];
  phones: string[];
  executives: Array<{ name: string; role: string }>;
  city: string;
  region: string;
  description: string;
  socials: string[];
};

type JsonRecord = Record<string, unknown>;

function normalizedHostname(hostname: string) {
  return hostname.toLowerCase().replace(/^\[|\]$/g, "").replace(/\.$/, "");
}

function isPrivateAddress(address: string): boolean {
  const value = normalizedHostname(address);
  const version = isIP(value);
  if (version === 4) {
    const [a, b] = value.split(".").map(Number);
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (version === 6) {
    if (value === "::" || value === "::1") return true;
    if (/^(fc|fd)/.test(value) || /^fe[89ab]/.test(value)) return true;
    const mapped = value.match(/::ffff:(\d+\.\d+\.\d+\.\d+)$/)?.[1];
    return mapped ? isPrivateAddress(mapped) : false;
  }
  return false;
}

function isBlockedHostname(hostname: string) {
  const value = normalizedHostname(hostname);
  return (
    !value ||
    value === "localhost" ||
    value.endsWith(".localhost") ||
    value.endsWith(".local") ||
    value.endsWith(".internal") ||
    value === "metadata.google.internal" ||
    isPrivateAddress(value)
  );
}

const hostnameSafety = new Map<string, Promise<boolean>>();

async function hostnameIsPublic(hostname: string) {
  const normalized = normalizedHostname(hostname);
  if (isBlockedHostname(normalized)) return false;
  if (isIP(normalized)) return !isPrivateAddress(normalized);
  const cached = hostnameSafety.get(normalized);
  if (cached) return cached;
  const result = lookup(normalized, { all: true, verbatim: true })
    .then((addresses) => addresses.length > 0 && addresses.every(({ address }) => !isPrivateAddress(address)))
    .catch(() => false);
  hostnameSafety.set(normalized, result);
  return result;
}

async function assertPublicUrl(value: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Die Website-Adresse ist ungültig.");
  }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error("Es sind nur öffentliche HTTP- und HTTPS-Websites erlaubt.");
  }
  if (!(await hostnameIsPublic(url.hostname))) {
    throw new Error("Private oder lokale Netzwerkadressen dürfen nicht ausgelesen werden.");
  }
  return url;
}

function decodeEntities(value: string) {
  const named: Record<string, string> = {
    amp: "&",
    quot: '"',
    apos: "'",
    lt: "<",
    gt: ">",
    nbsp: " ",
    auml: "ä",
    ouml: "ö",
    uuml: "ü",
    Auml: "Ä",
    Ouml: "Ö",
    Uuml: "Ü",
    szlig: "ß",
  };
  return value
    .replace(/&#(\d+);/g, (_match, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code: string) => String.fromCodePoint(Number.parseInt(code, 16)))
    .replace(/&([a-z]+);/gi, (match, name: string) => named[name] ?? match);
}

function plainText(html: string) {
  return decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, " ")
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, " ")
      .replace(/<br\s*\/?>/gi, "\n")
      .replace(/<\/(p|div|li|section|article|h[1-6]|tr|address)>/gi, "\n")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/[\t\r ]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readLimitedBody(response: Response) {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let received = 0;
  let output = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_HTML_BYTES) {
      await reader.cancel();
      throw new Error("Die Website ist für das Enrichment ungewöhnlich groß.");
    }
    output += decoder.decode(value, { stream: true });
  }
  output += decoder.decode();
  return output;
}

async function fetchPublicHtml(input: string) {
  let current = await assertPublicUrl(input);
  for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect += 1) {
    const response = await fetch(current, {
      redirect: "manual",
      cache: "no-store",
      headers: {
        accept: "text/html,application/xhtml+xml;q=0.9,*/*;q=0.2",
        "accept-language": "de-DE,de;q=0.9,en;q=0.6",
        "user-agent": "Mozilla/5.0 (compatible; DigitaleGewinner-Enrichment/1.0; +https://digitalegewinner-outbound.vercel.app)",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("location");
      if (!location || redirect === MAX_REDIRECTS) throw new Error("Zu viele Weiterleitungen beim Website-Aufruf.");
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }
    if (!response.ok) throw new Error(`Website antwortet mit HTTP ${response.status}.`);
    const contentType = response.headers.get("content-type")?.toLowerCase() ?? "";
    if (contentType && !contentType.includes("text/html") && !contentType.includes("application/xhtml+xml")) {
      throw new Error("Die URL liefert keine HTML-Website.");
    }
    return { url: current.toString(), html: await readLimitedBody(response) };
  }
  throw new Error("Website konnte nicht geladen werden.");
}

function sameWebsite(first: string, second: string) {
  try {
    return normalizedHostname(new URL(first).hostname).replace(/^www\./, "") ===
      normalizedHostname(new URL(second).hostname).replace(/^www\./, "");
  } catch {
    return false;
  }
}

function unique(values: string[]) {
  return [...new Set(values.map((value) => value.trim()).filter(Boolean))];
}

function normalizeEmail(value: string) {
  return decodeEntities(value)
    .replace(/^mailto:/i, "")
    .split(/[?&#]/)[0]
    .trim()
    .replace(/^[<({\[]+|[>)}\],;:.]+$/g, "")
    .toLowerCase();
}

function validEmail(value: string) {
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(value)) return false;
  return !/(example\.(com|org)|sentry|wixpress|cloudflare|wordpress|noreply|no-reply|donotreply)/i.test(value)
    && !/\.(png|jpe?g|gif|svg|webp|css|js)$/i.test(value);
}

function extractEmails(html: string, text: string) {
  const deobfuscated = text
    .replace(/\s*(?:\[at\]|\(at\)|\{at\})\s*/gi, "@")
    .replace(/\s*(?:\[dot\]|\(dot\)|\{dot\})\s*/gi, ".");
  const mailtos = [...html.matchAll(/href\s*=\s*["']mailto:([^"'#?\s]+)[^"']*["']/gi)].map((match) => match[1]);
  const visible = deobfuscated.match(/[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}/gi) ?? [];
  return unique([...mailtos, ...visible].map(normalizeEmail).filter(validEmail));
}

function normalizePhone(value: string) {
  const decoded = decodeEntities(value).replace(/^tel:/i, "").split(/[?&#]/)[0].trim();
  const plus = decoded.startsWith("+");
  const digits = decoded.replace(/\D/g, "");
  if (digits.length < 7 || digits.length > 16) return "";
  return plus ? `+${digits}` : decoded.replace(/\s+/g, " ");
}

function extractPhones(html: string, text: string) {
  const telLinks = [...html.matchAll(/href\s*=\s*["']tel:([^"'#?]+)[^"']*["']/gi)].map((match) => match[1]);
  const labeled = [...text.matchAll(/(?:telefon|tel\.?|phone|fon|mobil)\s*[:.]?\s*(\+?[\d][\d\s().\/-]{6,24})/gi)].map((match) => match[1]);
  return unique([...telLinks, ...labeled].map(normalizePhone).filter(Boolean));
}

function cleanHumanName(value: string) {
  const cleaned = decodeEntities(value)
    .replace(/\b(?:geschäftsführer(?:in)?|geschäftsführung|vertreten durch|inhaber(?:in)?|vorstand|managing director|chief executive officer|ceo|owner)\b/gi, " ")
    .replace(/\b(?:herr|frau)\b/gi, " ")
    .replace(/[|;•]/g, ",")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^[:\-–,\s]+|[:\-–,\s]+$/g, "");
  const candidate = cleaned.split(/,|\bund\b|\band\b|&|\n/i)[0]?.trim() ?? "";
  if (/\b(gmbh|ggmbh|ag|kg|ug|ohg|mbh|gesellschaft|unternehmen)\b/i.test(candidate)) return "";
  const tokens = candidate.replace(/\b(?:dr\.?|prof\.?|dipl\.?[- ]?\w+)\b/gi, "").trim().split(/\s+/);
  if (tokens.length < 2 || tokens.length > 6) return "";
  if (tokens.some((token) => token.length < 2 || /\d/.test(token))) return "";
  if (!tokens.every((token) => /^[A-ZÄÖÜ][\p{L}'’-]+$/u.test(token))) return "";
  return candidate;
}

function extractExecutives(text: string) {
  const results: Array<{ name: string; role: string }> = [];
  const pattern = /\b(Geschäftsführer(?:in|innen)?|Geschäftsführung|Vertreten durch|Inhaber(?:in)?|Vorstand|Managing Director|Chief Executive Officer|CEO|Owner)\b\s*(?:ist|sind)?\s*[:\-–]?\s*([^\n]{3,140})/gi;
  for (const match of text.matchAll(pattern)) {
    const name = cleanHumanName(match[2]);
    if (name) results.push({ name, role: match[1] });
  }
  return results.filter((item, index, all) => all.findIndex((other) => other.name === item.name) === index);
}

function asRecord(value: unknown): JsonRecord | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : null;
}

function stringValue(value: unknown) {
  return typeof value === "string" ? decodeEntities(value).trim() : "";
}

function collectJsonLd(value: unknown, output: {
  emails: string[];
  phones: string[];
  executives: Array<{ name: string; role: string }>;
  city: string;
  region: string;
  socials: string[];
}) {
  if (Array.isArray(value)) {
    value.forEach((item) => collectJsonLd(item, output));
    return;
  }
  const record = asRecord(value);
  if (!record) return;
  const type = Array.isArray(record["@type"])
    ? record["@type"].map(stringValue).join(" ")
    : stringValue(record["@type"]);
  const email = normalizeEmail(stringValue(record.email));
  const phone = normalizePhone(stringValue(record.telephone));
  if (validEmail(email)) output.emails.push(email);
  if (phone) output.phones.push(phone);
  const address = asRecord(record.address);
  if (address) {
    output.city ||= stringValue(address.addressLocality);
    output.region ||= stringValue(address.addressRegion);
  }
  const sameAs = Array.isArray(record.sameAs) ? record.sameAs.map(stringValue) : [stringValue(record.sameAs)];
  output.socials.push(...sameAs.filter((entry) => /linkedin\.com|instagram\.com|facebook\.com|xing\.com/i.test(entry)));
  if (/Person/i.test(type)) {
    const role = stringValue(record.jobTitle);
    const name = cleanHumanName(stringValue(record.name));
    if (name && /geschäft|managing director|chief executive|\bceo\b|inhaber|owner|vorstand/i.test(role)) {
      output.executives.push({ name, role: role || "Geschäftsführung" });
    }
  }
  for (const nested of Object.values(record)) {
    if (nested && typeof nested === "object") collectJsonLd(nested, output);
  }
}

function extractJsonLd(html: string) {
  const output = {
    emails: [] as string[],
    phones: [] as string[],
    executives: [] as Array<{ name: string; role: string }>,
    city: "",
    region: "",
    socials: [] as string[],
  };
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      collectJsonLd(JSON.parse(decodeEntities(match[1]).trim()), output);
    } catch {
      // Invalid structured data is common and should not stop the enrichment.
    }
  }
  return output;
}

function extractDescription(html: string) {
  const candidates = [
    html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1],
    html.match(/<meta\b[^>]*content=["']([^"']+)["'][^>]*name=["']description["'][^>]*>/i)?.[1],
    html.match(/<meta\b[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["'][^>]*>/i)?.[1],
  ];
  return decodeEntities(candidates.find(Boolean) ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
}

function extractSocials(html: string, baseUrl: string) {
  const links = [...html.matchAll(/href\s*=\s*["']([^"']+)["']/gi)].map((match) => {
    try {
      return new URL(decodeEntities(match[1]), baseUrl).toString();
    } catch {
      return "";
    }
  });
  return unique(links.filter((link) => /linkedin\.com|instagram\.com|facebook\.com|xing\.com/i.test(link))).slice(0, 8);
}

function relevantLinks(html: string, pageUrl: string) {
  const scores = new Map<string, number>();
  for (const match of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]), pageUrl);
    } catch {
      continue;
    }
    if (!sameWebsite(url.toString(), pageUrl) || !['http:', 'https:'].includes(url.protocol)) continue;
    url.hash = "";
    const descriptor = `${url.pathname} ${plainText(match[2])}`.toLowerCase();
    let score = 0;
    if (/impressum|legal-notice|anbieterkennzeichnung/.test(descriptor)) score += 100;
    if (/kontakt|contact/.test(descriptor)) score += 80;
    if (/ueber-uns|über-uns|about|unternehmen|company/.test(descriptor)) score += 60;
    if (/team|menschen|people|management|leitung/.test(descriptor)) score += 55;
    if (score > 0) scores.set(url.toString(), Math.max(score, scores.get(url.toString()) ?? 0));
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]).map(([url]) => url).slice(0, MAX_PAGES - 1);
}

function analyzePage(url: string, html: string): PageData {
  const text = plainText(html);
  const structured = extractJsonLd(html);
  const executives = [...structured.executives, ...extractExecutives(text)]
    .filter((item, index, all) => all.findIndex((other) => other.name === item.name) === index);
  return {
    url,
    html,
    text,
    emails: unique([...structured.emails, ...extractEmails(html, text)]),
    phones: unique([...structured.phones, ...extractPhones(html, text)]),
    executives,
    city: structured.city,
    region: structured.region,
    description: extractDescription(html),
    socials: unique([...structured.socials, ...extractSocials(html, url)]),
  };
}

function emailScore(email: string, websiteUrl: string) {
  const emailDomain = email.split("@")[1] ?? "";
  const websiteDomain = normalizedHostname(new URL(websiteUrl).hostname).replace(/^www\./, "");
  let score = emailDomain === websiteDomain || emailDomain.endsWith(`.${websiteDomain}`) ? 100 : 25;
  if (/^(info|kontakt|office|hello|mail|service|team|anfrage)@/i.test(email)) score += 15;
  if (/^(bewerbung|jobs|karriere)@/i.test(email)) score -= 20;
  return score;
}

function bestEmail(pages: PageData[], websiteUrl: string) {
  const sourceWeights = (url: string) => /impressum|legal-notice/.test(url.toLowerCase()) ? 30 : /kontakt|contact/.test(url.toLowerCase()) ? 20 : 0;
  return pages
    .flatMap((page) => page.emails.map((email) => ({ email, score: emailScore(email, websiteUrl) + sourceWeights(page.url) })))
    .sort((a, b) => b.score - a.score)[0]?.email ?? "";
}

function bestPhone(pages: PageData[]) {
  return pages.find((page) => /kontakt|contact|impressum|legal-notice/i.test(page.url) && page.phones.length)?.phones[0]
    ?? pages.flatMap((page) => page.phones)[0]
    ?? "";
}

export async function enrichWebsite(inputUrl: string): Promise<WebsiteEnrichmentResult> {
  const normalized = /^https?:\/\//i.test(inputUrl.trim()) ? inputUrl.trim() : `https://${inputUrl.trim()}`;
  const homepage = await fetchPublicHtml(normalized);
  const homepageData = analyzePage(homepage.url, homepage.html);
  const links = relevantLinks(homepage.html, homepage.url);
  const additional = await Promise.allSettled(links.map(async (link) => {
    const page = await fetchPublicHtml(link);
    if (!sameWebsite(page.url, homepage.url)) throw new Error("Weiterleitung auf fremde Domain übersprungen.");
    return analyzePage(page.url, page.html);
  }));
  const pages = [homepageData, ...additional.flatMap((item) => item.status === "fulfilled" ? [item.value] : [])].slice(0, MAX_PAGES);
  const email = bestEmail(pages, homepage.url);
  const phone = bestPhone(pages);
  const executive = pages.flatMap((page) => page.executives.map((person) => ({ ...person, source: page.url })))
    .sort((a, b) => (/impressum|legal-notice/i.test(a.source) ? -1 : 1) - (/impressum|legal-notice/i.test(b.source) ? -1 : 1))[0];
  const city = pages.map((page) => page.city).find(Boolean) ?? "";
  const region = pages.map((page) => page.region).find(Boolean) ?? "";
  const summary = pages.map((page) => page.description).find(Boolean) ?? "";
  const evidence: WebsiteEnrichmentEvidence[] = [];
  const emailPage = pages.find((page) => page.emails.includes(email));
  const phonePage = pages.find((page) => page.phones.includes(phone));
  if (email && emailPage) evidence.push({ kind: "email", value: email, source: emailPage.url });
  if (phone && phonePage) evidence.push({ kind: "phone", value: phone, source: phonePage.url });
  if (executive) evidence.push({ kind: "executive", value: executive.name, label: executive.role, source: executive.source });
  if (city) evidence.push({ kind: "address", value: [city, region].filter(Boolean).join(", "), source: pages.find((page) => page.city === city)?.url ?? homepage.url });
  if (summary) evidence.push({ kind: "description", value: summary, source: pages.find((page) => page.description === summary)?.url ?? homepage.url });
  for (const social of unique(pages.flatMap((page) => page.socials)).slice(0, 5)) {
    evidence.push({ kind: "social", value: social, source: homepage.url });
  }
  const tags = [
    "website-enriched",
    ...(pages.some((page) => /impressum|legal-notice/i.test(page.url)) ? ["impressum-geprüft"] : []),
    ...(email ? ["email-gefunden"] : []),
    ...(phone ? ["telefon-gefunden"] : []),
    ...(executive ? ["geschäftsführung-gefunden"] : []),
    ...(evidence.some((item) => item.kind === "social") ? ["social-profile-gefunden"] : []),
  ];
  let confidence = 20;
  if (pages.length > 1) confidence += 10;
  if (email) confidence += 25;
  if (phone) confidence += 15;
  if (executive) confidence += 25;
  if (pages.some((page) => /impressum|legal-notice/i.test(page.url))) confidence += 10;
  return {
    email,
    phone,
    ceo: executive?.name ?? "",
    contact: executive?.name ?? "",
    city,
    region,
    summary,
    confidence: Math.min(100, confidence),
    evidence: evidence.slice(0, 30),
    tags: unique(tags),
    pagesScanned: pages.map((page) => page.url),
  };
}
