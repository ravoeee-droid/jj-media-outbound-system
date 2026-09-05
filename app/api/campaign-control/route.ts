import { and, asc, eq, gte } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { jobs, leads, outreach, settings, workspaces } from "@/db/schema";
import { listRecentStratoInboxMessages, sendStratoMessage } from "@/lib/strato-mail";
import { defaultSettings, renderEmailHtml, renderTemplate } from "@/lib/templates";
import { notifyTelegram, sendTelegramMessage, telegramConfigured } from "@/lib/telegram";
import { apiError, requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";
export const maxDuration = 60;
const controlSchema = z.object({ action: z.enum(["start", "stop"]) });

async function setSetting(workspaceId: string, key: string, value: string) {
  await getDb().insert(settings).values({ workspaceId, key, value }).onConflictDoUpdate({ target: [settings.workspaceId, settings.key], set: { value, updatedAt: new Date() } });
}

async function writeLog(workspaceId: string, type: string, status: string, error?: string, leadId?: string) {
  const now = new Date();
  await getDb().insert(jobs).values({ workspaceId, leadId: leadId || null, type, status, attempts: 1, progress: status === "completed" ? 100 : 0, error: error || null, startedAt: now, finishedAt: status === "running" ? null : now });
}

function berlinClock() {
  const parts = new Intl.DateTimeFormat("de-DE", { timeZone: "Europe/Berlin", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date());
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { day: `${value.year}-${value.month}-${value.day}`, time: `${value.hour}:${value.minute}` };
}

function inWindow(now: string, start: string, end: string) {
  return start <= end ? now >= start && now <= end : now >= start || now <= end;
}

async function maybeDailyReport(workspaceId: string, values: Record<string, string>) {
  const clock = berlinClock();
  const reportTime = values.telegram_daily_report_time || "18:00";
  if (clock.time < reportTime || values.telegram_last_daily_report === clock.day) return;
  const db = getDb();
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [leadRows, sentRows] = await Promise.all([
    db.select().from(leads).where(eq(leads.workspaceId, workspaceId)).limit(3000),
    db.select().from(outreach).where(and(eq(outreach.workspaceId, workspaceId), eq(outreach.status, "sent"), gte(outreach.sentAt, since))),
  ]);
  const viewed = leadRows.filter((lead) => lead.watchPercent > 0).length;
  const hot = leadRows.filter((lead) => lead.watchPercent >= 60).length;
  const booked = leadRows.filter((lead) => lead.pipelineStage === "call_booked" || lead.pipelineStage === "won").length;
  await sendTelegramMessage(`📊 Tagesabschluss\n\nE-Mails gesendet: ${sentRows.length}\nVideos angesehen: ${viewed}\nHot Leads: ${hot}\nTermine gesamt: ${booked}\nVersandbereit: ${leadRows.filter((lead) => lead.videoStatus === "ready" && lead.pipelineStage === "new" && lead.email).length}`, {
    buttons: [[{ text: "Hot Leads öffnen", callback_data: "lead:next" }, { text: "System-Logs ↗", url: `${process.env.NEXT_PUBLIC_APP_URL || "https://digitalegewinner-outbound.vercel.app"}/system` }]],
  });
  await setSetting(workspaceId, "telegram_last_daily_report", clock.day);
  await writeLog(workspaceId, "telegram_daily_report", "completed");
}

async function detectStratoReplies(workspaceId: string, values: Record<string, string>) {
  if (values.telegram_reply_scan === "false") return;
  const db = getDb();
  const inbox = await listRecentStratoInboxMessages(2);
  if (!inbox.length) return;
  const sentRows = await db.select().from(outreach).where(and(eq(outreach.workspaceId, workspaceId), eq(outreach.status, "sent"))).limit(500);
  for (const row of sentRows.filter((item) => item.step === 1 && item.providerMessageId)) {
    const messageId = row.providerMessageId || "";
    const replied = inbox.some((message) => [message.inReplyTo, message.references].some((value) => value.includes(messageId)));
    if (!replied) continue;
    const key = `telegram_reply:${row.leadId}`;
    if (values[key]) continue;
    const [lead] = await db.select().from(leads).where(eq(leads.id, row.leadId)).limit(1);
    if (!lead) continue;
    await Promise.all([
      setSetting(workspaceId, key, new Date().toISOString()),
      db.update(leads).set({ pipelineStage: "replied", lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, lead.id)),
      writeLog(workspaceId, "strato_reply_detected", "completed", lead.email, lead.id),
    ]);
    await sendTelegramMessage(`💬 Neue Antwort erhalten\n\nUnternehmen: ${lead.company}\nVon: ${lead.email}\n\nJetzt persönlich reagieren.`, {
      buttons: [[{ text: "STRATO Mail öffnen ↗", url: `${process.env.NEXT_PUBLIC_APP_URL || "https://jj-media-social-outbound.vercel.app"}/dashboard/email` }, { text: "CRM öffnen ↗", url: `${process.env.NEXT_PUBLIC_APP_URL || "https://jj-media-social-outbound.vercel.app"}/dashboard#leads` }]],
    });
  }
}

export async function GET() {
  try {
    const { workspaceId } = await requireWorkspace();
    const rows = await getDb().select().from(settings).where(eq(settings.workspaceId, workspaceId));
    const values = Object.fromEntries(rows.map((row) => [row.key, row.value]));
    return Response.json({
      running: values.campaign_running === "true",
      startedAt: values.campaign_started_at || null,
      stoppedAt: values.campaign_stopped_at || null,
      pausedUntil: values.campaign_paused_until || null,
      intervalMinutes: Number(values.campaign_interval_minutes || 5),
      dailyLimit: Number(values.campaign_daily_limit || 25),
      sendStart: values.campaign_send_start || "08:00",
      sendEnd: values.campaign_send_end || "18:00",
      requiresExternalScheduler: true,
      telegramConnected: telegramConfigured(),
    }, { headers: { "cache-control": "no-store" } });
  } catch (error) { return apiError(error); }
}

export async function POST(request: Request) {
  try {
    const { workspaceId } = await requireWorkspace();
    const { action } = controlSchema.parse(await request.json());
    const running = action === "start";
    await setSetting(workspaceId, "campaign_running", String(running));
    await setSetting(workspaceId, running ? "campaign_started_at" : "campaign_stopped_at", new Date().toISOString());
    if (running) await setSetting(workspaceId, "campaign_paused_until", "");
    await writeLog(workspaceId, running ? "campaign_started" : "campaign_stopped", "completed");
    const telegram = await notifyTelegram(running ? "🟢 Outbound-Kampagne gestartet\nTageslimit, Versandzeiten und Mindestabstand sind aktiv." : "⏸ Outbound-Kampagne wurde manuell gestoppt.\nEs werden keine weiteren Kampagnen-Mails versendet.");
    return Response.json({ ok: true, running, telegram });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültige Kampagnenaktion." }, { status: 400 });
    return apiError(error);
  }
}

export async function PUT(request: Request) {
  const secret = process.env.AUTOMATION_SECRET || process.env.CRON_SECRET;
  const supplied = request.headers.get("x-automation-key") || request.headers.get("authorization")?.replace(/^Bearer\s+/i, "");
  if (!secret || supplied !== secret) return Response.json({ error: "Automation nicht autorisiert." }, { status: 401 });
  const db = getDb();
  const workspaceRows = await db.select().from(workspaces).limit(100);
  let activeCount = 0;

  for (const workspace of workspaceRows) {
    const workspaceId = workspace.id;
    const settingRows = await db.select().from(settings).where(eq(settings.workspaceId, workspaceId));
    const stored = Object.fromEntries(settingRows.map((row) => [row.key, row.value])) as Record<string, string>;
    const values = { ...defaultSettings, ...stored };
    await maybeDailyReport(workspaceId, values).catch(() => undefined);
    await detectStratoReplies(workspaceId, values).catch(() => undefined);
    if (values.campaign_running !== "true") continue;
    activeCount += 1;

    const now = new Date();
    const pausedUntil = values.campaign_paused_until ? new Date(values.campaign_paused_until) : null;
    if (pausedUntil && pausedUntil > now) continue;
    const clock = berlinClock();
    if (!inWindow(clock.time, values.campaign_send_start || "08:00", values.campaign_send_end || "18:00")) continue;

    const intervalMinutes = Math.min(Math.max(Number(values.campaign_interval_minutes || 5), 5), 240);
    const lastSentAt = values.campaign_last_sent_at ? new Date(values.campaign_last_sent_at) : null;
    if (lastSentAt && now.getTime() - lastSentAt.getTime() < intervalMinutes * 60_000) continue;

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const sentToday = await db.select().from(outreach).where(and(eq(outreach.workspaceId, workspaceId), eq(outreach.status, "sent"), gte(outreach.sentAt, since)));
    const dailyLimit = Math.min(Math.max(Number(values.campaign_daily_limit || 25), 1), 200);
    if (sentToday.length >= dailyLimit) {
      if (values.campaign_limit_notified_day !== clock.day) {
        await sendTelegramMessage(`🛑 Tageslimit erreicht: ${sentToday.length}/${dailyLimit}.\nMorgen kann die Kampagne im Versandfenster weiterlaufen.`);
        await setSetting(workspaceId, "campaign_limit_notified_day", clock.day);
      }
      continue;
    }

    const candidates = await db.select().from(leads).where(and(eq(leads.workspaceId, workspaceId), eq(leads.videoStatus, "ready"), eq(leads.pipelineStage, "new"))).orderBy(asc(leads.createdAt)).limit(300);
    for (const lead of candidates) {
      if (!lead.email || lead.tags.some((tag) => ["opt-out", "do-not-contact", "gesperrt", "skipped"].includes(tag.toLowerCase()))) continue;
      const [existing] = await db.select().from(outreach).where(and(eq(outreach.leadId, lead.id), eq(outreach.step, 1))).limit(1);
      if (existing?.status === "sent" || existing?.status === "sending") continue;
      const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL || new URL(request.url).origin).replace(/\/$/, "");
      const landingUrl = `${baseUrl}/v/${lead.slug}`;
      const subject = renderTemplate(values.email_subject, lead, baseUrl);
      const body = renderTemplate(values.email_body, lead, baseUrl);
      const html = renderEmailHtml(body, lead, baseUrl);
      let outreachId = existing?.id;
      try {
        if (existing) await db.update(outreach).set({ subject, body, status: "sending", updatedAt: new Date() }).where(eq(outreach.id, existing.id));
        else { const [created] = await db.insert(outreach).values({ workspaceId, leadId: lead.id, step: 1, subject, body, status: "sending" }).returning(); outreachId = created.id; }
        await writeLog(workspaceId, "campaign_email_send", "running", undefined, lead.id);
        const message = await sendStratoMessage({ to: lead.email, subject, body, html });
        await Promise.all([
          db.update(outreach).set({ status: "sent", sentAt: new Date(), providerMessageId: message.id, providerThreadId: message.threadId, updatedAt: new Date() }).where(eq(outreach.id, outreachId!)),
          db.update(leads).set({ pipelineStage: "contacted", lastContactAt: new Date(), lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, lead.id)),
          writeLog(workspaceId, "campaign_email_send", "completed", `Gesendet an ${lead.email} · ${landingUrl}`, lead.id),
          setSetting(workspaceId, "campaign_last_sent_at", new Date().toISOString()),
        ]);
        const telegram = await sendTelegramMessage(`✅ E-Mail erfolgreich versendet\n\nUnternehmen: ${lead.company}\nEmpfänger: ${lead.email}\nBetreff: ${subject}\n\nLandingpage prüfen:\n${landingUrl}`, {
          buttons: [[{ text: "Landingpage prüfen ↗", url: landingUrl }, { text: "Nächster Lead", callback_data: "lead:next" }]],
        });
        return Response.json({ ok: true, sent: true, leadId: lead.id, company: lead.company, landingUrl, telegram });
      } catch (error) {
        const detail = error instanceof Error ? error.message : "Unbekannter Versandfehler";
        if (outreachId) await db.update(outreach).set({ status: "failed", updatedAt: new Date() }).where(eq(outreach.id, outreachId)).catch(() => undefined);
        await setSetting(workspaceId, "campaign_running", "false").catch(() => undefined);
        await setSetting(workspaceId, "campaign_stopped_at", new Date().toISOString()).catch(() => undefined);
        await writeLog(workspaceId, "campaign_email_send", "failed", detail, lead.id).catch(() => undefined);
        const telegram = await sendTelegramMessage(`🚨 Kampagne wegen Fehler automatisch gestoppt\n\nUnternehmen: ${lead.company}\nEmpfänger: ${lead.email}\nFehler: ${detail}\n\nLead-Seite:\n${landingUrl}`, {
          buttons: [[{ text: "System-Logs öffnen ↗", url: `${baseUrl}/system` }, { text: "Lead prüfen ↗", url: landingUrl }]],
        });
        return Response.json({ error: detail, stopped: true, leadId: lead.id, company: lead.company, landingUrl, telegram }, { status: 500 });
      }
    }
  }
  return Response.json({ ok: true, sent: false, reason: activeCount ? "Aktiv, aber aktuell kein Versand nötig." : "Keine Kampagne aktiv." });
}
