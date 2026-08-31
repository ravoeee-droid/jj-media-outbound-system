import { verifyVideoRenderer } from "@/lib/video-renderer";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET() {
  try {
    const renderer = await verifyVideoRenderer();
    return Response.json({
      ...renderer,
      pipeline: "single-rendered-video",
      playback: "native-html5",
    });
  } catch (error) {
    return Response.json(
      {
        ok: false,
        error: error instanceof Error ? error.message : "Video-Renderer nicht verfügbar.",
      },
      { status: 503 },
    );
  }
}
