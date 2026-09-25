import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { normalizeResearchConfig, runResearchFeed } from "@/lib/research-feed";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

function authorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret && request.headers.get("authorization") === `Bearer ${secret}`);
}

export async function GET(request: Request) {
  if (!authorized(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });

  const rows = await getDb()
    .select({ workspaceId: settings.workspaceId, value: settings.value })
    .from(settings)
    .where(and(eq(settings.key, "research_feed_config")));

  const enabled = rows.flatMap((row) => {
    try {
      const config = normalizeResearchConfig(JSON.parse(row.value));
      return config.enabled && config.queries.length ? [{ workspaceId: row.workspaceId, config }] : [];
    } catch {
      return [];
    }
  }).slice(0, 10);

  const results = [];
  for (const item of enabled) {
    try {
      const result = await runResearchFeed(item.workspaceId, item.config);
      results.push({ workspaceId: item.workspaceId, ok: true, inserted: result.inserted, discovered: result.discovered, callReady: result.callReady, readyAfter: result.readyAfter, target: result.config.target });
    } catch (error) {
      results.push({
        workspaceId: item.workspaceId,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 500) : "Research run failed",
      });
    }
  }

  return Response.json({ ok: true, workspaces: enabled.length, results });
}
