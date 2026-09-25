import { and, desc, eq } from "drizzle-orm";
import sharp from "sharp";
import { getDb } from "@/db";
import { activities, assets, leads } from "@/db/schema";
import { deleteMedia, uploadMedia } from "@/lib/media-store";
import { captureInstagramProfile } from "@/lib/social-profile-capture";
import { hasPermission } from "@/lib/team";
import { apiError, requirePermission } from "@/lib/workspace";

export const runtime = "nodejs";
export const maxDuration = 120;

export async function POST(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await requirePermission("generate_video");
    const { id } = await context.params;
    const db = getDb();

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.workspaceId, workspace.workspaceId), eq(leads.id, id)))
      .limit(1);
    if (!lead) return Response.json({ error: "Lead nicht gefunden." }, { status: 404 });

    if (!hasPermission(workspace.role, workspace.permissions, "view_all_leads") && lead.ownerId !== workspace.user.id) {
      throw new Error("FORBIDDEN");
    }

    const profileUrl = lead.instagramUrl || (/instagram\.com/i.test(lead.websiteUrl) ? lead.websiteUrl : "");
    if (!profileUrl) return Response.json({ error: "Für diesen Lead fehlt das Instagram-Profil." }, { status: 400 });

    const capture = await captureInstagramProfile(profileUrl);
    const optimized = await sharp(capture.buffer)
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();

    const pathname = `workspaces/${workspace.workspaceId}/leads/${lead.slug}/instagram-profile-manual-${Date.now()}.webp`;
    const blob = await uploadMedia(pathname, optimized, "image/webp");

    const previous = await db
      .select({ id: assets.id, pathname: assets.pathname, blobUrl: assets.blobUrl })
      .from(assets)
      .where(and(eq(assets.workspaceId, workspace.workspaceId), eq(assets.kind, `social_profile_upload:${lead.id}`)))
      .orderBy(desc(assets.createdAt))
      .limit(1);

    const [asset] = await db.insert(assets).values({
      workspaceId: workspace.workspaceId,
      kind: `social_profile_upload:${lead.id}`,
      blobUrl: blob.url,
      pathname: blob.pathname,
      filename: `${lead.slug}-instagram-profile.webp`,
      contentType: "image/webp",
      size: optimized.byteLength,
    }).returning();

    const stale = previous[0];
    if (stale) {
      await deleteMedia(stale.pathname || stale.blobUrl).catch(() => undefined);
      await db.delete(assets).where(and(eq(assets.id, stale.id), eq(assets.workspaceId, workspace.workspaceId)));
    }

    await Promise.all([
      db.update(leads).set({
        scrollVideoUrl: blob.url,
        videoStatus: lead.videoStatus === "failed" ? "not_started" : lead.videoStatus,
        updatedAt: new Date(),
      }).where(eq(leads.id, lead.id)),
      db.insert(activities).values({
        workspaceId: workspace.workspaceId,
        leadId: lead.id,
        userId: workspace.user.id,
        type: "profile_capture_manual",
        title: "Instagram-Screenshot erstellt",
        detail: `Profilaufnahme gespeichert · ${capture.hiddenOverlays} Overlays entfernt.`,
        metadata: {
          assetId: asset.id,
          previousAssetId: previous[0]?.id || null,
          consentClicks: capture.consentClicks,
          hiddenOverlays: capture.hiddenOverlays,
        },
      }),
    ]);

    return Response.json({ ok: true, assetId: asset.id, capturedAt: new Date().toISOString() });
  } catch (error) {
    return apiError(error);
  }
}
