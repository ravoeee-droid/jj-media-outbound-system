import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { settings } from "@/db/schema";

const KEY = "strato_mail_credentials_v1";

export type StoredStratoCredentials = {
  email: string;
  password: string;
  senderName: string;
};

function encryptionSecret() {
  const value = (
    process.env.STRATO_CREDENTIAL_SECRET
    || process.env.COCKPIT_AUTH_SECRET
    || process.env.AUTH_SECRET
    || ""
  ).trim();

  if (!value || value === "digitale-gewinner-outbound-cockpit-v1") {
    throw new Error("Für verschlüsselte STRATO-Zugangsdaten fehlt ein serverseitiges Secret.");
  }
  return createHash("sha256").update(value, "utf8").digest();
}

function encrypt(value: string) {
  const key = encryptionSecret();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64url"), tag.toString("base64url"), encrypted.toString("base64url")].join(".");
}

function decrypt(value: string) {
  const [version, ivRaw, tagRaw, encryptedRaw] = value.split(".");
  if (version !== "v1" || !ivRaw || !tagRaw || !encryptedRaw) throw new Error("Ungültige STRATO-Credential-Version.");
  const decipher = createDecipheriv("aes-256-gcm", encryptionSecret(), Buffer.from(ivRaw, "base64url"));
  decipher.setAuthTag(Buffer.from(tagRaw, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedRaw, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

export async function getStoredStratoCredentials(workspaceId: string): Promise<StoredStratoCredentials | null> {
  const [row] = await getDb()
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, KEY)))
    .limit(1);

  if (!row?.value) return null;
  try {
    const parsed = JSON.parse(row.value) as { email?: unknown; password?: unknown; senderName?: unknown };
    if (typeof parsed.email !== "string" || typeof parsed.password !== "string") return null;
    return {
      email: parsed.email.trim(),
      password: decrypt(parsed.password),
      senderName: typeof parsed.senderName === "string" && parsed.senderName.trim() ? parsed.senderName.trim() : "JJ-Media",
    };
  } catch {
    return null;
  }
}

export async function saveStoredStratoCredentials(
  workspaceId: string,
  credentials: StoredStratoCredentials,
) {
  const email = credentials.email.trim().toLowerCase();
  const senderName = credentials.senderName.trim() || "JJ-Media";
  const password = credentials.password;
  if (!email || !password) throw new Error("E-Mail-Adresse und Passwort werden benötigt.");

  const value = JSON.stringify({
    email,
    password: encrypt(password),
    senderName,
    updatedAt: new Date().toISOString(),
  });

  await getDb()
    .insert(settings)
    .values({ workspaceId, key: KEY, value })
    .onConflictDoUpdate({
      target: [settings.workspaceId, settings.key],
      set: { value, updatedAt: new Date() },
    });

  return { email, senderName };
}

export async function deleteStoredStratoCredentials(workspaceId: string) {
  await getDb()
    .delete(settings)
    .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, KEY)));
}
