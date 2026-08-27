import { get } from "@vercel/blob";
import { eq } from "drizzle-orm";
import sharp from "sharp";
import { getDb } from "@/db";
import { leads } from "@/db/schema";

export const runtime = "nodejs";
export const maxDuration = 45;

async function createPoster(source: Buffer) {
  return sharp(source)
    .resize({ width: 1280, height: 720, fit: "cover", position: "top" })
    .webp({ quality: 84, effort: 4 })
    .toBuffer();
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const db = getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.slug, slug)).limit(1);
    if (!lead?.scrollVideoUrl) return new Response("Website-Vorschau fehlt.", { status: 404 });
    const posterRequested = new URL(request.url).searchParams.get("variant") === "poster";
    if (lead.scrollVideoUrl.includes("blob.vercel-storage.com")) {
      const result = await get(lead.scrollVideoUrl, { access: "private" });
      if (!result?.stream) return new Response("Website-Vorschau fehlt.", { status: 404 });
      if (posterRequested) {
        const source = Buffer.from(await new Response(result.stream).arrayBuffer());
        const poster = await createPoster(source);
        return new Response(new Uint8Array(poster), {
          headers: {
            "content-type": "image/webp",
            "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
            "content-disposition": "inline",
          },
        });
      }
      const headers = new Headers();
      result.headers.forEach((value, key) => headers.set(key, value));
      headers.set("content-type", result.blob.contentType || "image/webp");
      headers.set("cache-control", "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000");
      headers.set("content-disposition", "inline");
      return new Response(result.stream, { status: result.statusCode, headers });
    }

    const source = lead.scrollVideoUrl.includes("image.thum.io/")
      ? lead.scrollVideoUrl.replace("width/1200/crop/1600", "width/900/crop/1100")
      : lead.scrollVideoUrl;
    const response = await fetch(source, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) return new Response("Website-Vorschau konnte nicht geladen werden.", { status: 502 });
    const sourceBuffer = Buffer.from(await response.arrayBuffer());
    const optimized = posterRequested
      ? await createPoster(sourceBuffer)
      : await sharp(sourceBuffer)
        .resize({ width: 900, withoutEnlargement: true })
        .webp({ quality: 76, effort: 3 })
        .toBuffer();
    return new Response(new Uint8Array(optimized), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Website-Vorschau konnte nicht geladen werden.", { status: 500 });
  }
}
