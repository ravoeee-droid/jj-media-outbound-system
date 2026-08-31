import { get } from "@vercel/blob";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assets, leads } from "@/db/schema";

export const runtime = "nodejs";
export const maxDuration = 300;

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const db = getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.slug, slug)).limit(1);
    if (!lead) return new Response("Lead nicht gefunden.", { status: 404 });
    const [video] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.workspaceId, lead.workspaceId), eq(assets.kind, "master_video")))
      .orderBy(desc(assets.createdAt))
      .limit(1);
    if (!video) return new Response("Mastervideo nicht gefunden.", { status: 404 });

    const forwardedHeaders = new Headers();
    const range = request.headers.get("range");
    const ifNoneMatch = request.headers.get("if-none-match");
    if (range) forwardedHeaders.set("range", range);
    if (ifNoneMatch) forwardedHeaders.set("if-none-match", ifNoneMatch);
    const result = await get(video.blobUrl, {
      access: "private",
      headers: forwardedHeaders,
    });
    if (!result?.stream) {
      const emptyHeaders: Record<string, string> = {};
      result?.headers.forEach((value, key) => { emptyHeaders[key] = value; });
      return new Response(null, { status: result?.statusCode ?? 404, headers: emptyHeaders });
    }

    const headers = new Headers();
    result.headers.forEach((value, key) => headers.set(key, value));
    headers.set("content-type", video.contentType || result.blob.contentType || "video/mp4");
    headers.set("content-disposition", `inline; filename="${video.filename.replaceAll('"', "")}"`);
    headers.set("cache-control", "public, max-age=3600, s-maxage=86400");
    headers.set("accept-ranges", "bytes");
    return new Response(result.stream, { status: result.statusCode, headers });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Video konnte nicht geladen werden.", { status: 500 });
  }
}
