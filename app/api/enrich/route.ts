import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, jobs, leads } from "@/db/schema";
import { domainFromUrl, normalizeWebsite } from "@/lib/leads";
import { apiError, requireWorkspace } from "@/lib/workspace";

export const maxDuration = 120;

const inputSchema = z.object({ leadId: z.string().uuid() });

export async function POST(request: Request) {
  let jobId: string | undefined;
  try {
    const workspace = await requireWorkspace();
    const input = inputSchema.parse(await request.json());
    const db = getDb();
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.workspaceId, workspace.workspaceId)))
      .limit(1);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });
    const [job] = await db
      .insert(jobs)
      .values({ workspaceId: workspace.workspaceId, leadId: lead.id, type: "enrichment", status: "running", attempts: 1, startedAt: new Date() })
      .returning();
    jobId = job.id;

    let websiteUrl = lead.websiteUrl;
    let phone = lead.phone;
    let city = lead.city;
    let websiteScore = lead.websiteScore;
    const evidence = [...lead.evidence];

    if (process.env.GOOGLE_PLACES_API_KEY) {
      const query = [lead.company, lead.city].filter(Boolean).join(" ");
      const searchUrl = new URL("https://maps.googleapis.com/maps/api/place/findplacefromtext/json");
      searchUrl.searchParams.set("input", query);
      searchUrl.searchParams.set("inputtype", "textquery");
      searchUrl.searchParams.set("fields", "place_id,name,formatted_address");
      searchUrl.searchParams.set("key", process.env.GOOGLE_PLACES_API_KEY);
      const searchResponse = await fetch(searchUrl);
      const searchResult = (await searchResponse.json()) as {
        candidates?: Array<{ place_id?: string; formatted_address?: string }>;
      };
      const place = searchResult.candidates?.[0];
      if (place?.place_id) {
        const detailUrl = new URL("https://maps.googleapis.com/maps/api/place/details/json");
        detailUrl.searchParams.set("place_id", place.place_id);
        detailUrl.searchParams.set("fields", "name,formatted_address,formatted_phone_number,website,rating,user_ratings_total");
        detailUrl.searchParams.set("key", process.env.GOOGLE_PLACES_API_KEY);
        const details = (await (await fetch(detailUrl)).json()) as {
          result?: {
            website?: string;
            formatted_phone_number?: string;
            formatted_address?: string;
            rating?: number;
            user_ratings_total?: number;
          };
        };
        websiteUrl = websiteUrl || normalizeWebsite(details.result?.website ?? "");
        phone = phone || details.result?.formatted_phone_number || "";
        city = city || details.result?.formatted_address || place.formatted_address || "";
        if (details.result?.rating) {
          evidence.push(`Google: ${details.result.rating.toFixed(1)} Sterne bei ${details.result.user_ratings_total ?? 0} Bewertungen`);
        }
      }
    }

    if (websiteUrl && process.env.GOOGLE_PAGESPEED_API_KEY) {
      const pageSpeedUrl = new URL("https://www.googleapis.com/pagespeedonline/v5/runPagespeed");
      pageSpeedUrl.searchParams.set("url", websiteUrl);
      pageSpeedUrl.searchParams.set("strategy", "mobile");
      pageSpeedUrl.searchParams.set("category", "PERFORMANCE");
      pageSpeedUrl.searchParams.set("key", process.env.GOOGLE_PAGESPEED_API_KEY);
      const response = await fetch(pageSpeedUrl);
      if (response.ok) {
        const result = (await response.json()) as {
          lighthouseResult?: { categories?: { performance?: { score?: number } } };
        };
        websiteScore = Math.round((result.lighthouseResult?.categories?.performance?.score ?? 0) * 100);
        evidence.push(`Mobile PageSpeed: ${websiteScore}/100`);
      }
    }

    const salesPriority = Math.max(
      lead.salesPriority,
      Math.min(100, Math.round(100 - websiteScore * 0.55 + Math.min(lead.jobCount * 6, 30))),
    );
    const [updated] = await db
      .update(leads)
      .set({
        websiteUrl,
        domain: domainFromUrl(websiteUrl),
        phone,
        city,
        websiteScore,
        salesPriority,
        score: Math.max(lead.score, salesPriority),
        confidence: Math.max(lead.confidence, 80),
        evidence: evidence.slice(0, 30),
        updatedAt: new Date(),
      })
      .where(eq(leads.id, lead.id))
      .returning();
    await Promise.all([
      db.update(jobs).set({ status: "completed", progress: 100, finishedAt: new Date(), updatedAt: new Date() }).where(eq(jobs.id, job.id)),
      db.insert(activities).values({
        workspaceId: workspace.workspaceId,
        leadId: lead.id,
        userId: workspace.user.id,
        type: "enriched",
        title: "Lead Intelligence aktualisiert",
        detail: `Priorität ${salesPriority}/100 · Website ${websiteScore}/100`,
      }),
    ]);
    return Response.json({ lead: updated });
  } catch (error) {
    if (jobId) {
      await getDb()
        .update(jobs)
        .set({ status: "failed", error: error instanceof Error ? error.message : "Fehler", finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(jobs.id, jobId))
        .catch(() => undefined);
    }
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Lead-ID." }, { status: 400 });
    return apiError(error);
  }
}
