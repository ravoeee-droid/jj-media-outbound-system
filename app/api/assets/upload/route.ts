import { z } from "zod";
import { createMediaUpload, mediaStorageUrl } from "@/lib/media-store";
import { requireWorkspace } from "@/lib/workspace";

const requestSchema = z.object({
  pathname: z.string().trim().min(1).max(700),
  clientPayload: z.string().optional().default(""),
  contentType: z.string().trim().min(1).max(120),
  size: z.number().int().min(1).max(100 * 1024 * 1024),
});

function safeName(value: string) {
  return value.replace(/[^a-zA-Z0-9._/-]+/g, "-").replace(/\.\./g, "").replace(/^\/+/, "");
}

function randomize(pathname: string) {
  const dot = pathname.lastIndexOf(".");
  const suffix = crypto.randomUUID().slice(0, 10);
  return dot > pathname.lastIndexOf("/")
    ? `${pathname.slice(0, dot)}-${suffix}${pathname.slice(dot)}`
    : `${pathname}-${suffix}`;
}

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const input = requestSchema.parse(await request.json());
    const parsed = input.clientPayload
      ? JSON.parse(input.clientPayload) as { kind?: string; filename?: string; size?: number; contentType?: string }
      : {};
    if (!["master_video", "video_asset", "image_asset"].includes(parsed.kind ?? "")) {
      throw new Error("Unbekannter Dateityp.");
    }
    const isImage = parsed.kind === "image_asset";
    const allowed = isImage
      ? ["image/jpeg", "image/png", "image/webp"]
      : ["video/mp4", "video/webm", "video/quicktime"];
    if (!allowed.includes(input.contentType)) throw new Error("Dieses Dateiformat ist nicht erlaubt.");
    const maximum = isImage ? 20 * 1024 * 1024 : 80 * 1024 * 1024;
    if (input.size > maximum) throw new Error(isImage ? "Das Bild ist größer als 20 MB." : "Das Video ist größer als 80 MB.");

    const desired = randomize(safeName(input.pathname));
    const pathname = `workspaces/${workspace.workspaceId}/uploads/${desired}`;
    const signed = await createMediaUpload(pathname);
    return Response.json({
      signedUrl: signed.signedUrl,
      pathname,
      url: mediaStorageUrl(pathname),
    });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Upload-Daten sind ungültig." }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Upload fehlgeschlagen." }, { status: 400 });
  }
}
