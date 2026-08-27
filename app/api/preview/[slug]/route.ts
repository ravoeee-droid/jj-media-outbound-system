import { eq } from "drizzle-orm";
import sharp from "sharp";
import { getDb } from "@/db";
import { leads } from "@/db/schema";
import { get } from "@vercel/blob";

export const runtime = "nodejs";
export const maxDuration = 30;

function playButton() {
  return Buffer.from(`<svg width="600" height="338" xmlns="http://www.w3.org/2000/svg">
    <defs><filter id="s"><feDropShadow dx="0" dy="8" stdDeviation="10" flood-opacity=".28"/></filter></defs>
    <circle cx="300" cy="169" r="55" fill="white" fill-opacity=".96" filter="url(#s)"/>
    <path d="M286 137 L286 201 L334 169 Z" fill="#f23f7b"/>
    <rect x="18" y="18" width="190" height="34" rx="17" fill="#111827" fill-opacity=".82"/>
    <text x="34" y="40" font-family="Arial,sans-serif" font-size="14" font-weight="700" fill="white">PERSÖNLICHES VIDEO</text>
  </svg>`);
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const [lead] = await getDb().select().from(leads).where(eq(leads.slug, slug)).limit(1);
    if (!lead?.scrollVideoUrl) return new Response("Vorschau noch nicht erstellt.", { status: 404 });

    let source: Buffer;
    if (lead.scrollVideoUrl.includes("blob.vercel-storage.com")) {
      const screenshot = await get(lead.scrollVideoUrl, { access: "private" });
      if (!screenshot?.stream) throw new Error("Instagram-Profilvorschau konnte nicht geladen werden.");
      source = Buffer.from(await new Response(screenshot.stream).arrayBuffer());
    } else {
      const screenshot = await fetch(lead.scrollVideoUrl, { signal: AbortSignal.timeout(20_000) });
      if (!screenshot.ok) throw new Error("Instagram-Profilvorschau konnte nicht geladen werden.");
      source = Buffer.from(await screenshot.arrayBuffer());
    }
    const width = 600;
    const height = 338;
    const offsets = [0, 55, 110, 165, 220, 165, 110, 55];
    const frames = await Promise.all(
      offsets.map(async (top) =>
        sharp(source)
          .resize({ width, height: height + Math.max(...offsets), fit: "cover", position: "top" })
          .extract({ left: 0, top, width, height })
          .composite([{ input: playButton(), left: 0, top: 0 }])
          .png()
          .toBuffer(),
      ),
    );
    const gif = await sharp({
      create: {
        width,
        height: height * frames.length,
        channels: 4,
        background: { r: 245, g: 247, b: 250, alpha: 1 },
        pageHeight: height,
      },
    })
      .composite(frames.map((input, index) => ({ input, left: 0, top: index * height })))
      .gif({ loop: 0, delay: offsets.map(() => 650), effort: 3 })
      .toBuffer();

    return new Response(new Uint8Array(gif), {
      headers: {
        "content-type": "image/gif",
        "cache-control": "public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800",
        "content-disposition": `inline; filename="${slug}-video-preview.gif"`,
      },
    });
  } catch (error) {
    return new Response(error instanceof Error ? error.message : "Vorschau konnte nicht erstellt werden.", { status: 500 });
  }
}
