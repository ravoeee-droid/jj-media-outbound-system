import { z } from "zod";
import { hasValidInternalCaptureKey } from "@/lib/internal-capture-auth";
import { captureInstagramProfile } from "@/lib/social-profile-capture";

export const runtime = "nodejs";
export const maxDuration = 90;

const inputSchema = z.object({ url: z.string().trim().min(1).max(2_048) });

export async function POST(request: Request) {
  try {
    if (!hasValidInternalCaptureKey(request)) {
      return Response.json({ error: "Nicht autorisiert." }, { status: 401 });
    }
    const input = inputSchema.parse(await request.json());
    const capture = await captureInstagramProfile(input.url);
    return new Response(new Uint8Array(capture.buffer), {
      headers: {
        "content-type": "image/webp",
        "cache-control": "no-store",
        "x-capture-height": String(capture.height),
        "x-consent-clicks": String(capture.consentClicks),
        "x-hidden-overlays": String(capture.hiddenOverlays),
        "x-instagram-username": capture.username,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Instagram-Profil konnte nicht aufgenommen werden.";
    const status = error instanceof z.ZodError ? 400 : 502;
    return Response.json({ error: detail }, { status });
  }
}
