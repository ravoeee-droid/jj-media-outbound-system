import { createRemoteJWKSet, jwtVerify } from "jose";
import { Pool } from "postgres";

const ISSUER = "https://oidc.vercel.com/raphaelo-s-projects";
const AUDIENCE = "https://vercel.com/raphaelo-s-projects";
const SUBJECT = "owner:raphaelo-s-projects:project:jj-media-social-outbound:environment:production";
const EXPECTED_OWNER_ID = "team_JGkiXUaIpL46UGMllyrJujFS";
const EXPECTED_PROJECT_ID = "prj_CSWP0Ht9bw1MdZVZD0s7xawe19H0";
const JWKS = createRemoteJWKSet(new URL(`${ISSUER}/.well-known/jwks`));
const dbUrl = Deno.env.get("SUPABASE_DB_URL");
if (!dbUrl) throw new Error("SUPABASE_DB_URL is unavailable");
const pool = new Pool(dbUrl, 3, true);

const allowedTables = new Set([
  "accounts", "activities", "assets", "authenticators", "bookings", "campaigns",
  "events", "jobs", "leads", "outreach", "sessions", "settings", "tasks", "users",
  "verification_tokens", "workspace_members", "workspaces",
  "jj_whatsapp_threads", "jj_whatsapp_messages", "jj_whatsapp_locks",
  "jj_whatsapp_queue", "jj_whatsapp_reservations"
]);

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function verifyCaller(req: Request) {
  const header = req.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!token) throw new Error("missing_token");
  const { payload } = await jwtVerify(token, JWKS, {
    issuer: ISSUER,
    audience: AUDIENCE,
    subject: SUBJECT,
  });
  if (payload.owner_id !== EXPECTED_OWNER_ID || payload.project_id !== EXPECTED_PROJECT_ID || payload.environment !== "production") {
    throw new Error("wrong_project");
  }
}

function validateSql(input: string) {
  const sql = input.trim().replace(/;\s*$/, "");
  if (!sql || sql.length > 100_000) throw new Error("invalid_sql");
  if (sql.includes(";")) throw new Error("multiple_statements_denied");
  if (!/^(select|insert|update|delete)\b/i.test(sql) || /\b(drop|alter|create|grant|revoke|truncate|copy|vacuum|analyze|reset|listen|notify|call)\b/i.test(sql)) {
    throw new Error("statement_denied");
  }
  if (/\b(pg_catalog|information_schema|auth|storage|vault|realtime|cron|extensions|dg_private)\s*\./i.test(sql)) {
    throw new Error("schema_denied");
  }
  const tablePattern = /\b(?:from|join|into|update(?!\s+set\b)|delete\s+from)\s+(?:(?:"?public"?)\s*\.\s*)?"?([a-zA-Z_][a-zA-Z0-9_]*)"?/gi;
  for (const match of sql.matchAll(tablePattern)) {
    const table = match[1].toLowerCase();
    if (!allowedTables.has(table)) throw new Error(`table_denied:${table}`);
  }
  return sql;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    await verifyCaller(req);
  } catch (error) {
    console.error("OIDC verification failed", error);
    return json({ error: "unauthorized" }, 401);
  }

  try {
    const body = await req.json() as { sql?: unknown; params?: unknown; method?: unknown };
    if (typeof body.sql !== "string" || !Array.isArray(body.params)) return json({ error: "invalid_request" }, 400);
    const sqlText = validateSql(body.sql);
    const connection = await pool.connect();
    try {
      const result = await connection.queryArray(sqlText, body.params as unknown[]);
      return json({ rows: result.rows });
    } finally {
      connection.release();
    }
  } catch (error) {
    console.error("DB proxy error", error);
    return json({ error: error instanceof Error ? error.message : "query_failed" }, 500);
  }
});

