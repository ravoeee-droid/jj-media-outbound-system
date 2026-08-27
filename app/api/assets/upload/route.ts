import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { requireWorkspace } from "@/lib/workspace";

export async function POST(request: Request) {
  const body = (await request.json()) as HandleUploadBody;
  try {
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        const workspace = await requireWorkspace();
        const parsed = clientPayload ? (JSON.parse(clientPayload) as { kind?: string; filename?: string; size?: number; contentType?: string }) : {};
        if (!["master_video", "video_asset", "image_asset"].includes(parsed.kind ?? "")) throw new Error("Unbekannter Dateityp.");
        const isImage = parsed.kind === "image_asset";
        return {
          allowedContentTypes: isImage
            ? ["image/jpeg", "image/png", "image/webp"]
            : ["video/mp4", "video/webm", "video/quicktime"],
          maximumSizeInBytes: isImage ? 20 * 1024 * 1024 : 80 * 1024 * 1024,
          addRandomSuffix: true,
          tokenPayload: JSON.stringify({
            workspaceId: workspace.workspaceId,
            kind: parsed.kind,
            filename: parsed.filename ?? (isImage ? "proof-image.jpg" : "master-video.mp4"),
            size: parsed.size ?? 0,
            contentType: parsed.contentType ?? (isImage ? "image/jpeg" : "video/mp4"),
          }),
        };
      },
      onUploadCompleted: async () => undefined,
    });
    return Response.json(response);
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Upload fehlgeschlagen." }, { status: 400 });
  }
}
