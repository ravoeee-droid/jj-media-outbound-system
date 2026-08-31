import { z } from "zod";
import { enrichLeadManually } from "@/lib/manual-lead-enrichment";
import { apiError, requireWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 300;

const inputSchema = z.object({
  leadId: z.string().uuid().optional(),
  leadIds: z.array(z.string().uuid()).max(10).optional(),
  force: z.boolean().optional().default(false),
}).refine((input) => Boolean(input.leadId || input.leadIds?.length), {
  message: "Mindestens eine Lead-ID ist erforderlich.",
});

type EnrichmentResult = {
  leadId: string;
  ok: boolean;
  lead?: unknown;
  websiteResolutionSource?: string;
  error?: string;
};

async function processWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>,
) {
  const results = new Array<R>(items.length);
  let cursor = 0;

  async function runWorker() {
    while (cursor < items.length) {
      const index = cursor;
      cursor += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, runWorker));
  return results;
}

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const input = inputSchema.parse(await request.json());
    const leadIds = [...new Set([...(input.leadId ? [input.leadId] : []), ...(input.leadIds ?? [])])];

    const results = await processWithConcurrency<string, EnrichmentResult>(leadIds, 3, async (leadId) => {
      try {
        const result = await enrichLeadManually({
          workspaceId: workspace.workspaceId,
          leadId,
          userId: workspace.user.id,
          force: input.force,
        });
        return {
          leadId,
          ok: true,
          lead: result.lead,
          websiteResolutionSource: result.websiteResolutionSource,
        };
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Enrichment fehlgeschlagen.";
        return { leadId, ok: false, error: detail };
      }
    });

    const enriched = results.filter((result) => result.ok).length;
    return Response.json({
      ok: results.every((result) => result.ok),
      mode: "manual",
      enriched,
      failed: results.length - enriched,
      results,
    }, { status: enriched > 0 ? 200 : 502 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Ungültige Enrichment-Anfrage.", issues: error.issues }, { status: 400 });
    }
    return apiError(error);
  }
}
