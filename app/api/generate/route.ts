import { and, desc, eq } from "drizzle-orm";
import { del, get, put } from "@vercel/blob";
import sharp from "sharp";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, assets, jobs, leads, settings } from "@/db/schema";
import { parseLandingStudioConfig } from "@/lib/landing-studio";
import { internalCaptureHeader } from "@/lib/internal-capture-auth";
import { renderLeadVideo } from "@/lib/video-renderer";
import { sendTelegramMessage } from "@/lib/telegram";
import { apiError, requireWorkspace } from "@/lib/workspace";

const inputSchema = z.object({ leadId: z.string().uuid() });
export const runtime = "nodejs";
export const maxDuration = 300;

async function captureSocialProfile(request: Request, profileUrl: string) {
  let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      const captureUrl = new URL("/api/internal/social-profile-capture", request.url);
      const response = await fetch(captureUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...internalCaptureHeader(),
        },
        body: JSON.stringify({ url: profileUrl }),
        cache: "no-store",
        signal: AbortSignal.timeout(85_000),
      });
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error || `Browser-Aufnahme antwortet mit HTTP ${response.status}.`);
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      if (buffer.byteLength < 2_000) throw new Error("Browser-Aufnahme hat kein vollständiges Bild geliefert.");
      await sharp(buffer).metadata();
      return {
        buffer,
        consentClicks: Number(response.headers.get("x-consent-clicks") || 0),
        hiddenOverlays: Number(response.headers.get("x-hidden-overlays") || 0),
      };
    } catch (error) {
      lastError = error;
      if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 900));
    }
  }
  throw new Error(
    lastError instanceof Error
      ? `Das Instagram-Profil konnte nach zwei Versuchen nicht aufgenommen werden: ${lastError.message}`
      : "Das Instagram-Profil konnte nach zwei Versuchen nicht aufgenommen werden.",
  );
}

export async function POST(request: Request) {
  let jobId: string | undefined;
  let leadId: string | undefined;
  try {
    const workspace = await requireWorkspace();
    const input = inputSchema.parse(await request.json());
    leadId = input.leadId;
    const db = getDb();
    const [lead] = await db
      .select()
      .from(leads)
      .where(and(eq(leads.id, input.leadId), eq(leads.workspaceId, workspace.workspaceId)))
      .limit(1);
    if (!lead) return Response.json({ error: "Lead wurde nicht gefunden." }, { status: 404 });
    if (!lead.websiteUrl) return Response.json({ error: "Für diesen Lead fehlt das Instagram-Profil." }, { status: 400 });

    const [assetRows, settingRows] = await Promise.all([
      db
        .select()
        .from(assets)
        .where(eq(assets.workspaceId, workspace.workspaceId))
        .orderBy(desc(assets.createdAt))
        .limit(200),
      db.select().from(settings).where(eq(settings.workspaceId, workspace.workspaceId)),
    ]);
    const masterVideo = assetRows.find((asset) => asset.kind === "master_video");
    if (!masterVideo) {
      return Response.json(
        { error: "Bitte zuerst unter Integrationen ein Mastervideo hochladen." },
        { status: 400 },
      );
    }
    const settingValues = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
    const studioConfig = parseLandingStudioConfig(
      settingValues[`landing_studio_config:${lead.id}`] || settingValues.landing_studio_config,
    );

    const [job] = await db
      .insert(jobs)
      .values({
        workspaceId: workspace.workspaceId,
        leadId: lead.id,
        type: "lead_video_render",
        status: "running",
        attempts: 1,
        startedAt: new Date(),
        progress: 8,
      })
      .returning();
    jobId = job.id;
    await db
      .update(leads)
      .set({ videoStatus: "processing", updatedAt: new Date() })
      .where(eq(leads.id, lead.id));

    const manualProfilePreview = assetRows.find((asset) => asset.kind === `social_profile_upload:${lead.id}`);
    let screenshot: Buffer;
    let capture = { consentClicks: 0, hiddenOverlays: 0, source: "upload" as "upload" | "instagram" };
    if (manualProfilePreview) {
      const stored = await get(manualProfilePreview.blobUrl || manualProfilePreview.pathname, { access: "private", useCache: false });
      if (!stored?.stream) throw new Error("Der hinterlegte Instagram-Screenshot konnte nicht geladen werden.");
      screenshot = Buffer.from(await new Response(stored.stream).arrayBuffer());
    } else {
      const automaticCapture = await captureSocialProfile(request, lead.websiteUrl);
      screenshot = automaticCapture.buffer;
      capture = { consentClicks: automaticCapture.consentClicks, hiddenOverlays: automaticCapture.hiddenOverlays, source: "instagram" };
    }
    await db.update(jobs).set({ progress: 25, updatedAt: new Date() }).where(eq(jobs.id, job.id));

    const optimized = await sharp(screenshot)
      .resize({ width: 1280, withoutEnlargement: true })
      .webp({ quality: 82, effort: 4 })
      .toBuffer();
    const screenshotPathname = `workspaces/${workspace.workspaceId}/leads/${lead.slug}/instagram-profile-${Date.now()}.webp`;
    const screenshotBlob = await put(screenshotPathname, optimized, {
      access: "private",
      contentType: "image/webp",
      addRandomSuffix: false,
    });
    await db.insert(assets).values({
      workspaceId: workspace.workspaceId,
      kind: "social_profile_preview",
      blobUrl: screenshotBlob.url,
      pathname: screenshotBlob.pathname,
      filename: `${lead.slug}-instagram-profile.webp`,
      contentType: "image/webp",
      size: optimized.byteLength,
    });
    await db
      .update(leads)
      .set({ scrollVideoUrl: screenshotBlob.url, updatedAt: new Date() })
      .where(eq(leads.id, lead.id));
    await db.update(jobs).set({ progress: 35, updatedAt: new Date() }).where(eq(jobs.id, job.id));

    const rendered = await renderLeadVideo({
      screenshot: optimized,
      masterVideo,
      segments: studioConfig.segments,
      assetsById: new Map(assetRows.map((asset) => [asset.id, asset])),
      accentColor: studioConfig.accentColor,
      onProgress: async (progress) => {
        await db.update(jobs).set({ progress, updatedAt: new Date() }).where(eq(jobs.id, job.id));
      },
    });
    const renderedKind = `rendered_video:${lead.id}`;
    const renderedPathname = `workspaces/${workspace.workspaceId}/leads/${lead.slug}/final-${Date.now()}.mp4`;
    const renderedBlob = await put(renderedPathname, rendered.buffer, {
      access: "private",
      contentType: rendered.contentType,
      addRandomSuffix: false,
    });
    const [renderedAsset] = await db
      .insert(assets)
      .values({
        workspaceId: workspace.workspaceId,
        kind: renderedKind,
        blobUrl: renderedBlob.url,
        pathname: renderedBlob.pathname,
        filename: `${lead.slug}-personal-video.mp4`,
        contentType: rendered.contentType,
        size: rendered.buffer.byteLength,
      })
      .returning();

    const staleRenders = assetRows.filter((asset) => asset.kind === renderedKind && asset.id !== renderedAsset.id);
    for (const stale of staleRenders) {
      await del(stale.blobUrl).catch(() => undefined);
      await db
        .delete(assets)
        .where(and(eq(assets.id, stale.id), eq(assets.workspaceId, workspace.workspaceId)));
    }

    await Promise.all([
      db
        .update(leads)
        .set({ videoStatus: "ready", updatedAt: new Date() })
        .where(eq(leads.id, lead.id)),
      db
        .update(jobs)
        .set({ status: "completed", progress: 100, finishedAt: new Date(), updatedAt: new Date() })
        .where(eq(jobs.id, job.id)),
      db.insert(activities).values({
        workspaceId: workspace.workspaceId,
        leadId: lead.id,
        userId: workspace.user.id,
        type: "video_ready",
        title: "Persönliches MP4 gerendert",
        detail: `Instagram-Profil, Talking Head und Studio-Sequenz wurden zu einer echten Videodatei verbunden (${Math.round(rendered.duration)} Sekunden). Quelle: ${capture.source === "upload" ? "manueller Profil-Screenshot" : "automatische Instagram-Aufnahme"}. Bereinigung: ${capture.consentClicks} Klicks, ${capture.hiddenOverlays} Overlays entfernt.`,
      }),
    ]);
    const landingUrl = `${new URL(request.url).origin}/v/${lead.slug}`;
    await sendTelegramMessage(`✅ Persönliches Video fertig\n\nUnternehmen: ${lead.company}\nLaufzeit: ${Math.round(rendered.duration)} Sekunden\n\n${landingUrl}`, {
      buttons: [[{ text: "Video prüfen ↗", url: landingUrl }, { text: "Nächsten Lead", callback_data: "lead:next" }]],
    }).catch(() => undefined);

    return Response.json({
      ok: true,
      jobId: job.id,
      leadId: lead.id,
      renderedAssetId: renderedAsset.id,
      mediaUrl: `/v/${lead.slug}`,
      landingPath: lead.landingPath,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unbekannter Fehler";
    if (jobId || leadId) {
      const db = getDb();
      await Promise.all([
        jobId
          ? db
            .update(jobs)
            .set({ status: "failed", error: detail, finishedAt: new Date(), updatedAt: new Date() })
            .where(eq(jobs.id, jobId))
            .catch(() => undefined)
          : Promise.resolve(),
        leadId
          ? db
            .update(leads)
            .set({ videoStatus: "failed", updatedAt: new Date() })
            .where(eq(leads.id, leadId))
            .catch(() => undefined)
          : Promise.resolve(),
      ]);
    }
    if (leadId) {
      await sendTelegramMessage(`🚨 Video-Erstellung fehlgeschlagen\n\nLead-ID: ${leadId}\nFehler: ${detail}\n\nDer Fehler steht vollständig in den System-Logs.`, {
        buttons: [[{ text: "System-Logs öffnen ↗", url: `${new URL(request.url).origin}/system` }, { text: "Cockpit öffnen ↗", url: `${new URL(request.url).origin}/dashboard#leads` }]],
      }).catch(() => undefined);
    }
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Lead-ID." }, { status: 400 });
    return apiError(error);
  }
}
