export const runtime = "nodejs";

export async function GET() {
  const has = (name: string) => Boolean(process.env[name]);
  return Response.json({
    database: {
      DATABASE_URL: has("DATABASE_URL"),
      POSTGRES_URL: has("POSTGRES_URL"),
      POSTGRES_URL_NON_POOLING: has("POSTGRES_URL_NON_POOLING"),
      DATABASE_URL_UNPOOLED: has("DATABASE_URL_UNPOOLED"),
      NEON_DATABASE_URL: has("NEON_DATABASE_URL"),
      SUPABASE_URL: has("SUPABASE_URL"),
      NEXT_PUBLIC_SUPABASE_URL: has("NEXT_PUBLIC_SUPABASE_URL"),
      SUPABASE_ANON_KEY: has("SUPABASE_ANON_KEY"),
      SUPABASE_SERVICE_ROLE_KEY: has("SUPABASE_SERVICE_ROLE_KEY"),
    },
    storage: {
      BLOB_READ_WRITE_TOKEN: has("BLOB_READ_WRITE_TOKEN"),
    },
    auth: {
      COCKPIT_PASSWORD: has("COCKPIT_PASSWORD"),
      COCKPIT_AUTH_SECRET: has("COCKPIT_AUTH_SECRET"),
      AUTH_SECRET: has("AUTH_SECRET"),
    },
    integrations: {
      SCREENSHOTONE_API_KEY: has("SCREENSHOTONE_API_KEY"),
      AUTH_GOOGLE_ID: has("AUTH_GOOGLE_ID"),
      AUTH_GOOGLE_SECRET: has("AUTH_GOOGLE_SECRET"),
      CRON_SECRET: has("CRON_SECRET"),
    },
  });
}
