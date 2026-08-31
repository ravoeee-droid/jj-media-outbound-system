import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let cached: NeonHttpDatabase<typeof schema> | undefined;

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

export function getDb() {
  if (cached) return cached;
  const databaseUrl = databaseConnectionUrl() ||
    "postgresql://placeholder:placeholder@localhost:5432/outbound_placeholder";
  cached = drizzle(neon(databaseUrl), { schema });
  return cached;
}

export function assertDatabaseConfigured() {
  if (!databaseConnectionUrl()) {
    throw new Error("Keine Postgres-Verbindung ist gesetzt. Verbinde in Vercel eine Neon-Postgres-Datenbank oder setze DATABASE_URL.");
  }
}

export { schema };
