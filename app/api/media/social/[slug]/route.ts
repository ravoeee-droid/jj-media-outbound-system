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
    .webp({ quality: 86, effort: 4 })
    .toBuffer();
}

export async function GET(request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const [lead] = await getDb().select().from(leads).where(eq(leads.slug, slug)).limit(1);
    if (!lead?.scrollVideoUrl) return new Response("Instagram-Profilvorschau fehlt.", { status: 404 });
    const posterRequested = new URL(request.url).searchParams.get("variant") === "poster";

    let source: Buffer;
    if (lead.scrollVideoUrl.includes("blob.vercel-storage.com")) {
      const result = await get(lead.scrollVideoUrl, { access: "private" });
      if (!result?.stream) return new Response("Instagram-Profilvorschau fehlt.", { status: 404 });
      source = Buffer.from(await new Response(result.stream).arrayBuffer());
    } else {
      const response = await fetch(lead.scrollVideoUrl, { signal: AbortSignal.timeout(30_000) });
      if (!response.ok) return new Response("Instagram-Profilvorschau konnte nicht geladen werden.", { status: 502 });
      source = Buffer.from(await response.arrayBuffer());
    }

    const optimized = posterRequested
      ? await createPoster(source)
      : await sharp(source).resize({ width: 1080, withoutEnlargement: true }).webp({ quality: 82, effort: 3 }).toBuffer();
    return new Response(new Uint8Array(optimized), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=2592000",
        "content-disposition": "inline",
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Instagram-Profilvorschau konnte nicht geladen werden.", { status: 500 });
  }
}
