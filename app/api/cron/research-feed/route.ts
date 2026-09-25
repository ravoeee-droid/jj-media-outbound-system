import { inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { settings } from "@/db/schema";
import { normalizeResearchConfig, runResearchFeed } from "@/lib/research-feed";
import { normalizeLeadSupplyConfig, runLeadSupply } from "@/lib/lead-supply";

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
    .select({ workspaceId: settings.workspaceId, key: settings.key, value: settings.value })
    .from(settings)
    .where(inArray(settings.key, ["research_feed_config", "lead_supply_config"]));

  const byWorkspace = new Map<string, { research?: ReturnType<typeof normalizeResearchConfig>; supply?: ReturnType<typeof normalizeLeadSupplyConfig> }>();
  for (const row of rows) {
    try {
      const current = byWorkspace.get(row.workspaceId) || {};
      if (row.key === "research_feed_config") current.research = normalizeResearchConfig(JSON.parse(row.value));
      if (row.key === "lead_supply_config") current.supply = normalizeLeadSupplyConfig(JSON.parse(row.value));
      byWorkspace.set(row.workspaceId, current);
    } catch {
      // Ignore malformed legacy setting rows; UI can overwrite them.
    }
  }

  const enabled = [...byWorkspace.entries()]
    .filter(([, item]) =>
      Boolean(item.research?.enabled && item.research.queries.length)
      || Boolean(item.supply?.enabled && item.supply.assigneeIds.length)
    )
    .slice(0, 10);

  const results = [];
  for (const [workspaceId, item] of enabled) {
    try {
      let researchResult: Awaited<ReturnType<typeof runResearchFeed>> | null = null;
      let supplyResult: Awaited<ReturnType<typeof runLeadSupply>> | null = null;

      if (item.research?.enabled && item.research.queries.length) {
        researchResult = await runResearchFeed(workspaceId, item.research);
      }
      if (item.supply?.enabled && item.supply.assigneeIds.length) {
        supplyResult = await runLeadSupply(workspaceId, item.supply);
      }

      results.push({
        workspaceId,
        ok: true,
        research: researchResult ? {
          inserted: researchResult.inserted,
          discovered: researchResult.discovered,
          callReady: researchResult.callReady,
          readyAfter: researchResult.readyAfter,
          target: researchResult.config.target,
        } : null,
        supply: supplyResult?.summary || null,
      });
    } catch (error) {
      results.push({
        workspaceId,
        ok: false,
        error: error instanceof Error ? error.message.slice(0, 500) : "Research/supply run failed",
      });
    }
  }

  return Response.json({ ok: true, workspaces: enabled.length, results });
}
