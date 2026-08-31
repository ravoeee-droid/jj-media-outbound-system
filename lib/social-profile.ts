const RESERVED_INSTAGRAM_PATHS = new Set([
  "accounts",
  "about",
  "developer",
  "direct",
  "directory",
  "emails",
  "explore",
  "legal",
  "p",
  "privacy",
  "reel",
  "reels",
  "stories",
  "terms",
  "web",
]);

export function normalizeInstagramProfile(value: string) {
  const raw = value.trim();
  if (!raw) return "";

  const usernameOnly = raw.replace(/^@/, "");
  const candidate = /^[a-zA-Z0-9._]{1,30}$/.test(usernameOnly)
    ? `https://www.instagram.com/${usernameOnly}/`
    : /^https?:\/\//i.test(raw)
      ? raw
      : `https://${raw}`;

  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    throw new Error("Das Instagram-Profil ist ungültig.");
  }

  const host = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
  if (host !== "instagram.com") throw new Error("Bitte ausschließlich ein öffentliches Instagram-Profil verwenden.");
  const username = url.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "") ?? "";
  if (!/^[a-zA-Z0-9._]{1,30}$/.test(username) || RESERVED_INSTAGRAM_PATHS.has(username.toLowerCase())) {
    throw new Error("Bitte die URL eines Instagram-Profils verwenden, nicht die URL eines Beitrags oder Reels.");
  }

  return `https://www.instagram.com/${username}/`;
}

export function instagramUsername(value: string) {
  const normalized = normalizeInstagramProfile(value);
  return normalized ? new URL(normalized).pathname.split("/").filter(Boolean)[0] : "";
}
