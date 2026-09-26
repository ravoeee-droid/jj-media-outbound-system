import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { assets, leads, settings } from "@/db/schema";
import { getStratoMailStatus } from "@/lib/strato-mail";
import { requireWorkspace } from "@/lib/workspace";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const workspace = await requireWorkspace();
    const { id } = await context.params;
    const db = getDb();

    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, id), eq(leads.workspaceId, workspace.workspaceId)))
      .limit(1);
    if (!lead) return Response.json({ error: "Lead wurde nicht gefunden." }, { status: 404 });

    const [assetRows, settingRows, mail] = await Promise.all([
      db.select().from(assets)
        .where(eq(assets.workspaceId, workspace.workspaceId))
        .orderBy(desc(assets.createdAt))
        .limit(300),
      db.select().from(settings).where(eq(settings.workspaceId, workspace.workspaceId)),
      getStratoMailStatus(workspace.workspaceId),
    ]);

    const values = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
    const manualProfile = assetRows.some((asset) => asset.kind === `social_profile_upload:${lead.id}`);
    const masterVideo = assetRows.some((asset) => asset.kind === "master_video");
    const renderedVideo = assetRows.some((asset) => asset.kind === `rendered_video:${lead.id}`);
    const profileReady = Boolean(lead.instagramUrl || manualProfile);
    const calendarReady = Boolean(String(values.calendar_embed_url || "").trim());
    const emailReady = Boolean(lead.email.trim());
    const mailboxReady = Boolean(mail.configured);
    const videoReady = lead.videoStatus === "ready" && renderedVideo;
    const landingReady = videoReady && Boolean(lead.slug);

    const checks = {
      profile: profileReady,
      masterVideo,
      video: videoReady,
      landing: landingReady,
      calendar: calendarReady,
      email: emailReady,
      mailbox: mailboxReady,
    };

    const blockers: string[] = [];
    if (!profileReady) blockers.push("Instagram-Profil oder Profil-Screenshot fehlt.");
    if (!masterVideo) blockers.push("Jessica-Mastervideo fehlt.");
    if (!calendarReady) blockers.push("Termin-Kalender fehlt.");
    if (!emailReady) blockers.push("E-Mail-Adresse beim Lead fehlt.");
    if (!mailboxReady) blockers.push("E-Mail-Postfach ist nicht verbunden.");

    return Response.json({
      lead: { id: lead.id, company: lead.company, slug: lead.slug, email: lead.email, videoStatus: lead.videoStatus },
      checks,
      blockers,
      readyToRender: profileReady && masterVideo,
      readyToSend: landingReady && calendarReady && emailReady && mailboxReady,
      landingUrl: `/v/${lead.slug}`,
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Produktionsstatus konnte nicht geladen werden." }, { status: 500 });
  }
}
