import { and, count, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts, assets, leads, outreach, settings, tasks } from "@/db/schema";
import { apiError, requireWorkspace } from "@/lib/workspace";

export async function GET() {
  try {
    const workspace = await requireWorkspace();
    const db = getDb();
    const [settingRows, masterVideos, googleAccounts, leadCount, readyLeadCount, openTaskCount, scheduledCount] = await Promise.all([
      db.select().from(settings).where(eq(settings.workspaceId, workspace.workspaceId)),
      db
        .select({ id: assets.id, filename: assets.filename })
        .from(assets)
        .where(and(eq(assets.workspaceId, workspace.workspaceId), eq(assets.kind, "master_video")))
        .limit(1),
      db
        .select({
          id: accounts.providerAccountId,
          scope: accounts.scope,
          refreshToken: accounts.refresh_token,
        })
        .from(accounts)
        .where(and(eq(accounts.userId, workspace.user.id), eq(accounts.provider, "google")))
        .limit(1),
      db.select({ value: count() }).from(leads).where(eq(leads.workspaceId, workspace.workspaceId)),
      db.select({ value: count() }).from(leads).where(and(eq(leads.workspaceId, workspace.workspaceId), eq(leads.videoStatus, "ready"))),
      db.select({ value: count() }).from(tasks).where(and(eq(tasks.workspaceId, workspace.workspaceId), eq(tasks.status, "open"))),
      db.select({ value: count() }).from(outreach).where(and(eq(outreach.workspaceId, workspace.workspaceId), eq(outreach.status, "scheduled"))),
    ]);
    const values = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
    const google = googleAccounts[0];
    const gmailConfigured = Boolean(process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET);
    const gmailConnected = Boolean(
      google?.refreshToken &&
      google.scope?.includes("gmail.send"),
    );
    const checks = {
      database: { ok: true, label: "Neon-Datenbank", detail: "Verbunden" },
      blob: {
        ok: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
        label: "Video-Speicher",
        detail: process.env.BLOB_READ_WRITE_TOKEN ? "Verbunden" : "BLOB_READ_WRITE_TOKEN fehlt",
      },
      masterVideo: {
        ok: Boolean(masterVideos[0]),
        label: "Mastervideo",
        detail: masterVideos[0]?.filename || "Noch nicht hochgeladen",
      },
      calendar: {
        ok: Boolean(values.calendar_embed_url),
        label: "Kalender",
        detail: values.calendar_embed_url ? "Link gespeichert" : "Kalender-Link fehlt",
      },
      gmailConfig: {
        ok: gmailConfigured,
        label: "Google-OAuth",
        detail: gmailConfigured ? "Zugangsdaten vorhanden" : "Google Client-ID/Secret fehlen",
      },
      gmail: {
        ok: gmailConnected,
        label: "Gmail",
        detail: gmailConnected ? "Versandkonto verbunden" : "Noch nicht verbunden",
      },
      cron: {
        ok: Boolean(process.env.CRON_SECRET),
        label: "Follow-up Runner",
        detail: process.env.CRON_SECRET ? "CRON_SECRET vorhanden" : "CRON_SECRET fehlt",
      },
      autoFollowups: {
        ok: values.auto_followups === "true",
        label: "Automatische Follow-ups",
        detail: values.auto_followups === "true" ? "Aktiv" : "Sicherheitsmodus: aus",
      },
    };
    const manualReady = checks.database.ok && checks.blob.ok && checks.masterVideo.ok && checks.calendar.ok;
    const automaticReady = manualReady && checks.gmailConfig.ok && checks.gmail.ok && checks.cron.ok && checks.autoFollowups.ok;
    return Response.json({
      ok: true,
      manualReady,
      automaticReady,
      checks,
      counts: {
        leads: Number(leadCount[0]?.value || 0),
        readyLeads: Number(readyLeadCount[0]?.value || 0),
        openTasks: Number(openTaskCount[0]?.value || 0),
        scheduledFollowups: Number(scheduledCount[0]?.value || 0),
      },
    });
  } catch (error) {
    return apiError(error);
  }
}
