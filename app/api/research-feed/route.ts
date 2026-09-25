import { count, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { researchCandidates } from "@/db/schema";
import {
  getResearchFeedConfig,
  getResearchFeedLastRun,
  listResearchCandidates,
  normalizeResearchConfig,
  researchCandidatesForIntake,
  runResearchFeed,
  restoreResearchCandidates,
  saveResearchFeedConfig,
  setResearchCandidateStatus,
} from "@/lib/research-feed";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const statusSchema = z.enum(["call_ready", "new", "shortlisted", "dismissed", "imported"]);

async function counts(workspaceId: string) {
  const rows = await getDb()
    .select({
      status: researchCandidates.status,
      count: count(),
    })
    .from(researchCandidates)
    .where(eq(researchCandidates.workspaceId, workspaceId))
    .groupBy(researchCandidates.status);
  return Object.fromEntries(rows.map((row) => [row.status, Number(row.count || 0)]));
}

export async function GET(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const url = new URL(request.url);
    const status = statusSchema.catch("call_ready").parse(url.searchParams.get("status") || "call_ready");

    const [config, candidates, statusCounts, lastRun] = await Promise.all([
      getResearchFeedConfig(workspace.workspaceId),
      listResearchCandidates(workspace.workspaceId, status, 200),
      counts(workspace.workspaceId),
      getResearchFeedLastRun(workspace.workspaceId),
    ]);

    return Response.json({
      config,
      candidates,
      status,
      counts: {
        call_ready: statusCounts.call_ready || 0,
        new: statusCounts.new || 0,
        shortlisted: statusCounts.shortlisted || 0,
        dismissed: statusCounts.dismissed || 0,
        imported: statusCounts.imported || 0,
      },
      latestRunAt: lastRun?.finishedAt || null,
      latestSource: lastRun?.source || null,
      lastRun,
      capabilities: {
        googlePlaces: Boolean(process.env.GOOGLE_PLACES_API_KEY?.trim()),
        dailyCron: Boolean(process.env.CRON_SECRET?.trim()),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}

const configInput = z.object({
  enabled: z.boolean(),
  target: z.number().int().min(20).max(100),
  queries: z.array(z.string().trim().min(3).max(160)).max(10),
});

export async function PUT(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const input = configInput.parse(await request.json());
    const config = await saveResearchFeedConfig(workspace.workspaceId, normalizeResearchConfig(input));
    return Response.json({ config });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Suchprofil ist ungültig.", issues: error.issues }, { status: 400 });
    return apiError(error);
  }
}

const actionInput = z.discriminatedUnion("action", [
  z.object({ action: z.literal("generate") }),
  z.object({ action: z.literal("dismiss"), ids: z.array(z.string().uuid()).min(1).max(100) }),
  z.object({ action: z.literal("restore"), ids: z.array(z.string().uuid()).min(1).max(100) }),
  z.object({ action: z.literal("mark_imported"), ids: z.array(z.string().uuid()).min(1).max(100) }),
  z.object({ action: z.literal("prepare_intake"), ids: z.array(z.string().uuid()).min(1).max(30) }),
]);

export async function POST(request: Request) {
  try {
    const workspace = await requirePermission("manage_leads");
    const input = actionInput.parse(await request.json());

    if (input.action === "generate") {
      const result = await runResearchFeed(workspace.workspaceId);
      return Response.json(result);
    }

    if (input.action === "dismiss") {
      const updated = await setResearchCandidateStatus(workspace.workspaceId, input.ids, "dismissed");
      return Response.json({ ok: true, updated });
    }

    if (input.action === "restore") {
      const updated = await restoreResearchCandidates(workspace.workspaceId, input.ids);
      return Response.json({ ok: true, updated });
    }

    if (input.action === "mark_imported") {
      const updated = await setResearchCandidateStatus(workspace.workspaceId, input.ids, "imported");
      return Response.json({ ok: true, updated });
    }

    const raw = await researchCandidatesForIntake(workspace.workspaceId, input.ids);
    if (!raw.length) return Response.json({ error: "Keine geeigneten Kandidaten mehr vorhanden." }, { status: 409 });
    await setResearchCandidateStatus(workspace.workspaceId, input.ids, "shortlisted");
    return Response.json({
      ok: true,
      source: "Recherche-Feed",
      raw,
      candidateIds: input.ids,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Recherche-Aktion ist ungültig.", issues: error.issues }, { status: 400 });
    return apiError(error);
  }
}
