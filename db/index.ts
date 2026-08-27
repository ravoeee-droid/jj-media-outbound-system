import { neon } from "@neondatabase/serverless";
import { drizzle, type NeonHttpDatabase } from "drizzle-orm/neon-http";
import * as schema from "./schema";

let cached: NeonHttpDatabase<typeof schema> | undefined;

export function getDb() {
  if (cached) return cached;
  const databaseUrl =
    process.env.DATABASE_URL ??
    "postgresql://placeholder:placeholder@localhost:5432/outbound_placeholder";
  cached = drizzle(neon(databaseUrl), { schema });
  return cached;
}

export function assertDatabaseConfigured() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL ist nicht gesetzt. Verbinde in Vercel zuerst eine Neon-Postgres-Datenbank.");
  }
}

export { schema };
