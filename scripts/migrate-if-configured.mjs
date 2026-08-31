import { spawnSync } from "node:child_process";

const databaseUrl =
  process.env.DATABASE_URL ||
  process.env.POSTGRES_URL ||
  process.env.POSTGRES_URL_NON_POOLING ||
  process.env.DATABASE_URL_UNPOOLED ||
  process.env.NEON_DATABASE_URL ||
  "";

if (!databaseUrl) {
  console.log("[db] No Postgres connection configured; skipping migrations.");
  process.exit(0);
}

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = databaseUrl;
}

console.log("[db] Postgres connection detected; applying Drizzle migrations...");
const result = spawnSync(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "db:migrate"], {
  stdio: "inherit",
  env: process.env,
});

if (result.status !== 0) {
  console.error("[db] Migration failed.");
  process.exit(result.status ?? 1);
}

console.log("[db] Migrations are up to date.");
