export const COCKPIT_COOKIE = "dg_cockpit";
export const COCKPIT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

type CockpitSession = {
  version: 2;
  userId: string;
  exp: number;
};

function cockpitPassword() {
  return process.env.COCKPIT_PASSWORD || "siemens";
}

function cockpitSecret() {
  return process.env.COCKPIT_AUTH_SECRET || process.env.AUTH_SECRET || "digitale-gewinner-outbound-cockpit-v1";
}

async function sha256(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function toBase64Url(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromBase64Url(value: string) {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - value.length % 4) % 4);
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

async function hmac(value: string) {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(cockpitSecret()),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(value));
  const bytes = new Uint8Array(signature);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function constantTimeEqual(left: string, right: string) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

export async function cockpitToken() {
  return sha256(`${cockpitPassword()}:${cockpitSecret()}`);
}

export async function createCockpitSessionToken(userId: string) {
  const payload: CockpitSession = {
    version: 2,
    userId,
    exp: Math.floor(Date.now() / 1000) + COCKPIT_COOKIE_MAX_AGE,
  };
  const encoded = toBase64Url(JSON.stringify(payload));
  return `v2.${encoded}.${await hmac(encoded)}`;
}

export function passwordMatches(value: string) {
  const expected = cockpitPassword();
  if (value.length !== expected.length) return false;
  return constantTimeEqual(value, expected);
}

export async function readCockpitSession(value?: string | null): Promise<CockpitSession | null> {
  if (!value?.startsWith("v2.")) return null;
  const [, encoded, signature] = value.split(".");
  if (!encoded || !signature) return null;
  if (!constantTimeEqual(signature, await hmac(encoded))) return null;
  try {
    const parsed = JSON.parse(fromBase64Url(encoded)) as Partial<CockpitSession>;
    if (parsed.version !== 2 || typeof parsed.userId !== "string" || typeof parsed.exp !== "number") return null;
    if (parsed.exp <= Math.floor(Date.now() / 1000)) return null;
    return parsed as CockpitSession;
  } catch {
    return null;
  }
}

export async function validCockpitToken(value?: string | null) {
  if (!value) return false;
  if (await readCockpitSession(value)) return true;
  const expected = await cockpitToken();
  return constantTimeEqual(value, expected);
}
