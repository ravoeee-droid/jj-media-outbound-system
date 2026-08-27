import { issueSignedToken, presignUrl } from "@vercel/blob";
import { desc, eq } from "drizzle-orm";
import { assertDatabaseConfigured, getDb } from "@/db";
import { assets, leads, settings } from "@/db/schema";
import { parseLandingStudioConfig } from "@/lib/landing-studio";

type StoredAsset = typeof assets.$inferSelect;

async function signedVideoUrl(asset: StoredAsset) {
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
  return presignedUrl;
}

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    assertDatabaseConfigured();
    const { slug } = await context.params;
    const db = getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.slug, slug)).limit(1);
    if (!lead) return Response.json({ error: "Landingpage nicht gefunden." }, { status: 404 });

    const [videoAssets, settingRows] = await Promise.all([
      db.select().from(assets).where(eq(assets.workspaceId, lead.workspaceId)).orderBy(desc(assets.createdAt)).limit(100),
      db.select().from(settings).where(eq(settings.workspaceId, lead.workspaceId)),
    ]);
    const values = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
    const renderedVideo = videoAssets.find((asset) => asset.kind === `rendered_video:${lead.id}`);
    const storedConfig = values[`landing_studio_config:${lead.id}`] || values.landing_studio_config;
    const studioConfig = parseLandingStudioConfig(storedConfig);
    const renderedVideoUrl = renderedVideo ? await signedVideoUrl(renderedVideo) : null;

    return Response.json({
      lead: { company: lead.company, slug: lead.slug },
      scrollVideoUrl: lead.scrollVideoUrl ? `/api/media/social/${lead.slug}` : null,
      posterUrl: lead.scrollVideoUrl
        ? `/api/media/social/${lead.slug}?variant=poster&v=${lead.updatedAt.getTime()}`
        : null,
      renderedVideoUrl,
      calendarEmbedUrl: values.calendar_embed_url || null,
      bookingCta: values.booking_cta || "15 Minuten Kennenlernen",
      offerName: values.offer_name || "JJ-Media",
      studioConfig,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Landingpage konnte nicht geladen werden." }, { status: 500 });
  }
}
