export type ResearchContactValidation = {
  phone: { valid: boolean; normalized: string; source: string };
  email: { valid: boolean; normalized: string; corporateMatch: boolean; source: string };
  instagram: { valid: boolean; normalized: string; source: string };
};

const FREE_EMAIL_DOMAINS = new Set([
  "gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com",
  "icloud.com", "me.com", "yahoo.com", "yahoo.de", "gmx.de", "gmx.net",
  "web.de", "t-online.de", "aol.com", "proton.me", "protonmail.com",
]);

const RESERVED_INSTAGRAM_PATHS = new Set([
  "accounts", "about", "developer", "direct", "directory", "emails", "explore",
  "legal", "p", "privacy", "reel", "reels", "stories", "terms", "web",
]);

function websiteDomain(value: string) {
  if (!value) return "";
  try {
    return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`)
      .hostname.toLowerCase().replace(/^www\./, "");
  } catch {
    return "";
  }
}

export function normalizeCallReadyPhone(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const withoutExtension = raw.replace(/\s*(?:durchwahl|dw\.?|ext\.?|extension)\s*[:.-]?\s*\d+\s*$/i, "");
  let digits = withoutExtension.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  else if (digits.startsWith("0")) digits = `49${digits.slice(1)}`;
  else if (!digits.startsWith("49")) return "";
  if (digits.startsWith("490")) digits = `49${digits.slice(3)}`;

  if (!/^49[1-9]\d{5,10}$/.test(digits)) return "";
  return `+${digits}`;
}

export function validateBusinessEmail(value: string, websiteUrl: string) {
  const normalized = value.trim().toLowerCase().replace(/^mailto:/, "").split(/[?&#]/)[0];
  if (!/^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9.-]+\.[a-z]{2,}$/i.test(normalized)) {
    return { valid: false, normalized: "", corporateMatch: false };
  }
  if (/(?:^|@)(?:example\.(?:com|org)|sentry|wixpress|cloudflare)|(?:noreply|no-reply|donotreply)@/i.test(normalized)) {
    return { valid: false, normalized: "", corporateMatch: false };
  }
  const domain = normalized.split("@")[1] || "";
  const site = websiteDomain(websiteUrl);
  const corporateMatch = Boolean(
    site &&
    !FREE_EMAIL_DOMAINS.has(domain) &&
    (domain === site || domain.endsWith(`.${site}`) || site.endsWith(`.${domain}`))
  );
  return { valid: true, normalized, corporateMatch };
}

export function normalizeVerifiedInstagram(value: string) {
  const raw = value.trim();
  if (!raw) return "";
  const usernameOnly = raw.replace(/^@/, "");
  if (/^[a-zA-Z0-9._]{1,30}$/.test(usernameOnly) && !RESERVED_INSTAGRAM_PATHS.has(usernameOnly.toLowerCase())) {
    return `https://www.instagram.com/${usernameOnly}/`;
  }
  let url: URL;
  try {
    url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return "";
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const parts = url.pathname.split("/").filter(Boolean);
  if (host !== "instagram.com" || parts.length !== 1) return "";
  const username = parts[0].replace(/^@/, "");
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username) || RESERVED_INSTAGRAM_PATHS.has(username.toLowerCase())) return "";
  return `https://www.instagram.com/${username}/`;
}

export function validateResearchContacts(input: {
  phone: string;
  email: string;
  instagramUrl: string;
  websiteUrl: string;
  phoneSource?: string;
  emailSource?: string;
  instagramSource?: string;
}): ResearchContactValidation {
  const phone = normalizeCallReadyPhone(input.phone);
  const email = validateBusinessEmail(input.email, input.websiteUrl);
  const instagram = normalizeVerifiedInstagram(input.instagramUrl);
  return {
    phone: { valid: Boolean(phone), normalized: phone, source: phone ? input.phoneSource || "source" : "" },
    email: { valid: email.valid, normalized: email.normalized, corporateMatch: email.corporateMatch, source: email.valid ? input.emailSource || "source" : "" },
    instagram: { valid: Boolean(instagram), normalized: instagram, source: instagram ? input.instagramSource || "source" : "" },
  };
}

export function scoreValidatedCandidate(input: {
  websiteUrl: string;
  source: string;
  ratingX10: number;
  reviewCount: number;
  validation: ResearchContactValidation;
}) {
  let score = 15;
  if (input.websiteUrl) score += 15;
  if (input.validation.phone.valid) score += 40;
  if (input.validation.email.valid) score += 10;
  if (input.validation.email.corporateMatch) score += 5;
  if (input.validation.instagram.valid) score += 8;
  if (input.source === "google_places") score += 2;
  if (input.ratingX10 >= 40) score += 2;
  if (input.reviewCount >= 10) score += 1;
  if (input.reviewCount >= 50) score += 1;
  if (input.reviewCount >= 150) score += 1;
  return Math.min(100, score);
}

export function isCallReady(validation: ResearchContactValidation, score: number) {
  return validation.phone.valid && score >= 55;
}
