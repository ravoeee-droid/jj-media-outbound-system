import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assets, leads, settings } from "@/db/schema";
import { parseLandingStudioConfig } from "@/lib/landing-studio";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ id: string; slug: string }> }) {
  try {
    const { id, slug } = await context.params;
    const db = getDb();
    const [asset, lead] = await Promise.all([
      db.select().from(assets).where(eq(assets.id, id)).limit(1).then((rows) => rows[0]),
      db.select().from(leads).where(eq(leads.slug, slug)).limit(1).then((rows) => rows[0]),
    ]);
    if (!asset || !lead || asset.workspaceId !== lead.workspaceId || (!asset.contentType.startsWith("video/") && !asset.contentType.startsWith("image/"))) {
      return new Response("Medium nicht gefunden.", { status: 404 });
    }
    const settingRows = await db
      .select()
      .from(settings)
      .where(eq(settings.workspaceId, lead.workspaceId));
    const values = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
    const config = parseLandingStudioConfig(values[`landing_studio_config:${lead.id}`] || values.landing_studio_config);
    if (!config.segments.some((segment) => segment.assetId === asset.id)) {
      return new Response("Video ist für diese Landingpage nicht freigegeben.", { status: 403 });
    }

    const forwardedHeaders = new Headers();
    const range = request.headers.get("range");
    if (range) forwardedHeaders.set("range", range);
    const result = await get(asset.blobUrl, { access: "private", headers: forwardedHeaders });
    if (!result?.stream) return new Response("Medium nicht gefunden.", { status: 404 });
    const headers = new Headers();
    result.headers.forEach((value, key) => headers.set(key, value));
    headers.set("content-type", asset.contentType);
    headers.set("content-disposition", `inline; filename="${asset.filename.replaceAll('"', "")}"`);
    headers.set("cache-control", "public, max-age=3600, s-maxage=86400");
    headers.set("accept-ranges", "bytes");
    return new Response(result.stream, { status: result.statusCode, headers });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Medium konnte nicht geladen werden.", { status: 500 });
  }
}
