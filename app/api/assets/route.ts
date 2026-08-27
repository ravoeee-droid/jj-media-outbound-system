import { and, desc, eq } from "drizzle-orm";
import { del, issueSignedToken, presignUrl } from "@vercel/blob";
import { z } from "zod";
import { getDb } from "@/db";
import { assets } from "@/db/schema";
import { apiError, requireWorkspace } from "@/lib/workspace";

const assetInput = z.object({
  kind: z.enum(["master_video", "video_asset", "image_asset"]),
  blobUrl: z.string().url(),
  pathname: z.string().trim().min(1).max(1000),
  filename: z.string().trim().min(1).max(500),
  contentType: z.enum(["video/mp4", "video/webm", "video/quicktime", "image/jpeg", "image/png", "image/webp"]),
  size: z.number().int().min(1).max(80 * 1024 * 1024),
});

type StoredAsset = typeof assets.$inferSelect;

async function addPreviewUrl(asset: StoredAsset) {
  const validUntil = Date.now() + 6 * 60 * 60 * 1000;
  const token = await issueSignedToken({
    pathname: asset.pathname,
    operations: ["get"],
    validUntil,
  });
  const { presignedUrl } = await presignUrl(token, {
    pathname: asset.pathname,
    operation: "get",
    access: "private",
    validUntil,
  });
  return { ...asset, previewUrl: presignedUrl };
}

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();
    const rows = await getDb()
      .select()
      .from(assets)
      .where(eq(assets.workspaceId, workspaceId))
      .orderBy(desc(assets.createdAt))
      .limit(100);
    return Response.json({ assets: await Promise.all(rows.map(addPreviewUrl)) });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const input = assetInput.parse(await request.json());
    const db = getDb();
    const [existing] = await db
      .select()
      .from(assets)
      .where(and(eq(assets.workspaceId, workspaceId), eq(assets.blobUrl, input.blobUrl)))
      .limit(1);
    if (existing) return Response.json({ asset: await addPreviewUrl(existing) });

    const [asset] = await db
      .insert(assets)
      .values({ workspaceId, ...input })
      .returning();
    return Response.json({ asset: await addPreviewUrl(asset) }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return Response.json({ error: "Die Mediendaten sind unvollständig oder ungültig." }, { status: 400 });
    }
    return apiError(error);
  }
}

export async function DELETE(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const id = new URL(request.url).searchParams.get("id");
    if (!id) return Response.json({ error: "Asset-ID fehlt." }, { status: 400 });
    const [asset] = await getDb()
      .select()
      .from(assets)
      .where(and(eq(assets.id, id), eq(assets.workspaceId, workspaceId)))
      .limit(1);
    if (!asset) return Response.json({ error: "Datei nicht gefunden." }, { status: 404 });
    await del(asset.blobUrl);
    await getDb().delete(assets).where(eq(assets.id, asset.id));
    return Response.json({ ok: true });
  } catch (error) {
    return apiError(error);
  }
}
