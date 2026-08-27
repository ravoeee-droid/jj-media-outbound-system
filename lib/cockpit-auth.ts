export const COCKPIT_COOKIE = "dg_cockpit";
export const COCKPIT_COOKIE_MAX_AGE = 60 * 60 * 24 * 30;

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

export async function cockpitToken() {
  return sha256(`${cockpitPassword()}:${cockpitSecret()}`);
}

export function passwordMatches(value: string) {
  const expected = cockpitPassword();
  if (value.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= value.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}

export async function validCockpitToken(value?: string | null) {
  if (!value) return false;
  const expected = await cockpitToken();
  if (value.length !== expected.length) return false;
  let difference = 0;
  for (let index = 0; index < expected.length; index += 1) {
    difference |= value.charCodeAt(index) ^ expected.charCodeAt(index);
  }
  return difference === 0;
}
