import { z } from "zod";
import { hasValidInternalCaptureKey } from "@/lib/internal-capture-auth";
import { captureExternalWebsite } from "@/lib/website-capture";

export const runtime = "nodejs";
export const maxDuration = 90;

const inputSchema = z.object({ url: z.string().url().max(2_048) });

export async function POST(request: Request) {
  try {
    if (!hasValidInternalCaptureKey(request)) {
      return Response.json({ error: "Nicht autorisiert." }, { status: 401 });
    }
    const input = inputSchema.parse(await request.json());
    const capture = await captureExternalWebsite(input.url);
    return new Response(new Uint8Array(capture.buffer), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "no-store",
        "x-capture-height": String(capture.height),
        "x-cookie-clicks": String(capture.cookieClicks),
        "x-cookie-overlays-hidden": String(capture.hiddenOverlays),
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Website-Aufnahme fehlgeschlagen.";
    const status = error instanceof z.ZodError ? 400 : 502;
    return Response.json({ error: detail }, { status });
  }
}
