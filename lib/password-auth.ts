import { pbkdf2Sync, randomBytes, timingSafeEqual } from "node:crypto";

const ITERATIONS = 180_000;
const KEY_LENGTH = 32;
const DIGEST = "sha256";

export function hashPassword(password: string) {
  const salt = randomBytes(18).toString("base64url");
  const hash = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST).toString("base64url");
  return { salt, hash };
}

export function verifyPassword(password: string, salt: string | null | undefined, expectedHash: string | null | undefined) {
  if (!salt || !expectedHash) return false;
  const actual = pbkdf2Sync(password, salt, ITERATIONS, KEY_LENGTH, DIGEST);
  let expected: Buffer;
  try { expected = Buffer.from(expectedHash, "base64url"); } catch { return false; }
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}
