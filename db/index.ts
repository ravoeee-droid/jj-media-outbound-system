import { neon } from "@neondatabase/serverless";
import { getVercelOidcToken } from "@vercel/oidc";
import { drizzle as neonDrizzle } from "drizzle-orm/neon-http";
import { drizzle as proxyDrizzle } from "drizzle-orm/pg-proxy";
import * as schema from "./schema";

let cached: any;

const REMOTE_DB_PROXY = "https://dessavbytgxyygeohjrn.supabase.co/functions/v1/jj-media-db-proxy";

function databaseConnectionUrl() {
  return (
    process.env.DATABASE_URL ||
    process.env.POSTGRES_URL ||
    process.env.POSTGRES_URL_NON_POOLING ||
    process.env.DATABASE_URL_UNPOOLED ||
    process.env.NEON_DATABASE_URL ||
    ""
  );
}

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

export function getDb() {
  if (cached) return cached;

  const databaseUrl = databaseConnectionUrl();
  if (databaseUrl) {
    cached = neonDrizzle(neon(databaseUrl), { schema });
    return cached;
  }

  cached = proxyDrizzle(remoteQuery, { schema });
  return cached;
}

export function assertDatabaseConfigured() {
  // Production can authenticate to the Supabase DB proxy with Vercel OIDC,
  // so a static DATABASE_URL is intentionally optional.
}

export { schema };
