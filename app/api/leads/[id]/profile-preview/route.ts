import { and, eq } from "drizzle-orm";
import { put } from "@vercel/blob";
import sharp from "sharp";
import { getDb } from "@/db";
import { activities, assets, leads } from "@/db/schema";
import { apiError, requireWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await requireWorkspace();
    const { id } = await context.params;
    const [lead] = await getDb()
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.workspaceId, workspace.workspaceId)))
      .limit(1);
    if (!lead) return Response.json({ error: "Lead wurde nicht gefunden." }, { status: 404 });

    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File)) return Response.json({ error: "Bitte einen Screenshot auswählen." }, { status: 400 });
    if (!file.type.startsWith("image/")) return Response.json({ error: "Erlaubt sind nur JPG, PNG oder WebP." }, { status: 400 });
    if (file.size > 8 * 1024 * 1024) return Response.json({ error: "Der Screenshot darf maximal 8 MB groß sein." }, { status: 400 });

    const source = Buffer.from(await file.arrayBuffer());
    const optimized = await sharp(source)
      .rotate()
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 88, effort: 4 })
      .toBuffer();
    const pathname = `workspaces/${workspace.workspaceId}/leads/${lead.slug}/instagram-upload-${Date.now()}.webp`;
    const blob = await put(pathname, optimized, {
      access: "private",
      contentType: "image/webp",
      addRandomSuffix: false,
    });

    const db = getDb();
    await Promise.all([
      db.insert(assets).values({
        workspaceId: workspace.workspaceId,
        kind: `social_profile_upload:${lead.id}`,
        blobUrl: blob.url,
        pathname: blob.pathname,
        filename: `${lead.slug}-instagram-profile.webp`,
        contentType: "image/webp",
        size: optimized.byteLength,
      }),
      db.update(leads).set({ scrollVideoUrl: blob.url, videoStatus: "not_started", updatedAt: new Date() }).where(eq(leads.id, lead.id)),
      db.insert(activities).values({
        workspaceId: workspace.workspaceId,
        leadId: lead.id,
        userId: workspace.user.id,
        type: "social_profile_uploaded",
        title: "Instagram-Screenshot hinterlegt",
        detail: "Der manuelle Profil-Screenshot wird beim nächsten Video-Render verwendet.",
      }),
    ]);

    return Response.json({ ok: true, previewUrl: `/api/media/social/${lead.slug}` });
  } catch (error) {
    return apiError(error);
  }
}
