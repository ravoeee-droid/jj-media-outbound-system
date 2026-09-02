import { and, eq, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { settings, whatsappLocks } from "@/db/schema";
import { agentConfigSchema, DEFAULT_AGENT, type AgentConfig } from "./policy";

export const AGENT_CONFIG_KEY = "jj_whatsapp_agent";

export async function getAgentConfig(workspaceId: string): Promise<AgentConfig> {
  const [row] = await getDb().select().from(settings).where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, AGENT_CONFIG_KEY))).limit(1);
  if (!row) return structuredClone(DEFAULT_AGENT);
  return agentConfigSchema.parse(JSON.parse(row.value));
}

export async function saveAgentConfig(workspaceId: string, input: unknown) {
  const config = agentConfigSchema.parse(input);
  if (config.enabled && !config.knowledge.some((entry) => entry.approved)) throw new Error("Bitte zuerst mindestens einen Wissenseintrag freigeben.");
  if (config.dailyOutreachEnabled && !config.enabled) throw new Error("Für den Tageslauf muss die KI aktiviert sein.");
  const db = getDb();
  const [current] = await db.select().from(settings).where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, AGENT_CONFIG_KEY))).limit(1);
  const previousVersion = current ? agentConfigSchema.parse(JSON.parse(current.value)).version : 0;
  if (previousVersion !== config.version) throw new Error("Die Einstellungen wurden inzwischen geändert. Bitte neu laden.");
  const next = { ...config, version: previousVersion + 1 };
  const value = JSON.stringify(next);
  const saved = current
    ? await db.update(settings).set({ value, updatedAt: new Date() }).where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, AGENT_CONFIG_KEY), eq(settings.value, current.value))).returning()
    : await db.insert(settings).values({ workspaceId, key: AGENT_CONFIG_KEY, value }).onConflictDoNothing().returning();
  if (!saved.length) throw new Error("Die Einstellungen wurden inzwischen geändert. Bitte neu laden.");
  return next;
}

// Database-backed leases coordinate Vercel invocations and the persistent bridge.
export async function withLease<T>(workspaceId: string, key: string, work: () => Promise<T>): Promise<T> {
  const db = getDb();
  const token = crypto.randomUUID();
  const [lock] = await db.insert(whatsappLocks).values({ workspaceId, key, token, expiresAt: new Date(Date.now() + 180_000) }).onConflictDoUpdate({
    target: [whatsappLocks.workspaceId, whatsappLocks.key],
    set: { token, expiresAt: new Date(Date.now() + 180_000) },
    setWhere: lt(whatsappLocks.expiresAt, new Date()),
  }).returning();
  if (!lock) throw new Error("Dieser Vorgang wird gerade verarbeitet. Bitte kurz warten.");
  try { return await work(); }
  finally { await db.delete(whatsappLocks).where(and(eq(whatsappLocks.workspaceId, workspaceId), eq(whatsappLocks.key, key), eq(whatsappLocks.token, token))); }
}
