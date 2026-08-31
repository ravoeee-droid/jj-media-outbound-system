import { getVercelOidcToken } from "@vercel/oidc";
import { drizzle, type PgRemoteDatabase } from "drizzle-orm/pg-proxy";
import * as schema from "./schema";

let cached: PgRemoteDatabase<typeof schema> | undefined;

const REMOTE_DB_PROXY = "https://dessavbytgxyygeohjrn.supabase.co/functions/v1/jj-media-db-proxy";

async function remoteQuery(sql: string, params: unknown[], method: "all" | "execute") {
  const oidcToken = await getVercelOidcToken();
  if (!oidcToken) {
    throw new Error("Vercel OIDC ist für den sicheren Datenbankzugriff nicht verfügbar.");
  }

  const response = await fetch(REMOTE_DB_PROXY, {
    method: "POST",
    headers: {
      authorization: `Bearer ${oidcToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ sql, params, method }),
    cache: "no-store",
  });

  const payload = (await response.json().catch(() => ({}))) as { rows?: unknown[][]; error?: string };
  if (!response.ok) {
    throw new Error(payload.error || `Remote DB Proxy antwortete mit HTTP ${response.status}.`);
  }
  return { rows: payload.rows || [] };
}

export function getDb(): PgRemoteDatabase<typeof schema> {
  if (cached) return cached;
  cached = drizzle(remoteQuery, { schema });
  return cached;
}

export function assertDatabaseConfigured() {
  // Production authenticates to the database broker with short-lived Vercel OIDC.
}

export { schema };
