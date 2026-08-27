import { and, asc, desc, eq, gte } from "drizzle-orm";
import { getDb } from "@/db";
import { jobs, leads, outreach, settings, workspaces } from "@/db/schema";
import { answerTelegramCallback, sendTelegramMessage, telegramWebhookSecret } from "@/lib/telegram";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

type TelegramUpdate = {
  message?: { text?: string; chat?: { id?: number }; from?: { id?: number } };
  callback_query?: {
    id: string;
    data?: string;
    from?: { id?: number };
    message?: { chat?: { id?: number }; message_id?: number };
  };
};

async function setSetting(workspaceId: string, key: string, value: string) {
  await getDb().insert(settings).values({ workspaceId, key, value }).onConflictDoUpdate({
    target: [settings.workspaceId, settings.key],
    set: { value, updatedAt: new Date() },
  });
}

async function logAction(workspaceId: string, type: string, detail?: string, leadId?: string) {
  const now = new Date();
  await getDb().insert(jobs).values({
    workspaceId,
    leadId: leadId || null,
    type,
    status: "completed",
    attempts: 1,
    progress: 100,
    error: detail || null,
    startedAt: now,
    finishedAt: now,
  });
}

function appUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL || "https://digitalegewinner-outbound.vercel.app").replace(/\/$/, "");
}

function commandHelp() {
  return [
    "🤖 Outbound-Steuerzentrale",
    "",
    "/status – Kampagne und Bestand",
    "/start – Start mit Sicherheitsbestätigung",
    "/stop – Sofort stoppen",
    "/pause 60 – Minuten pausieren",
    "/queue – nächste versandbereite Leads",
    "/next – nächsten Lead bearbeiten",
    "/best – heißeste Leads",
    "/errors – letzte Fehler",
    "/logs – letzte Prozesse",
    "/heute – Tagesergebnis",
    "/woche – Wochenergebnis",
    "/performance – Conversion-Kennzahlen",
    "/limit 25 – Tageslimit",
    "/zeiten 08:00 18:00 – Versandfenster",
    "/intervall 10 – Minutenabstand",
  ].join("\n");
}

async function workspaceContext() {
  const db = getDb();
  const configuredId = process.env.TELEGRAM_WORKSPACE_ID;
  const [workspace] = configuredId
    ? await db.select().from(workspaces).where(eq(workspaces.id, configuredId)).limit(1)
    : await db.select().from(workspaces).limit(1);
  if (!workspace) throw new Error("Kein Workspace gefunden.");
  const settingRows = await db.select().from(settings).where(eq(settings.workspaceId, workspace.id));
  return { workspace, values: Object.fromEntries(settingRows.map((row) => [row.key, row.value])) as Record<string, string> };
}

function allowedChat(chatId?: number) {
  return Boolean(chatId && String(chatId) === String(process.env.TELEGRAM_CHAT_ID || ""));
}

function eligibleLead(lead: typeof leads.$inferSelect) {
  const blocked = lead.tags.some((tag) => ["opt-out", "do-not-contact", "gesperrt", "skipped"].includes(tag.toLowerCase()));
  return Boolean(lead.email && lead.videoStatus === "ready" && lead.pipelineStage === "new" && !blocked);
}

function leadText(lead: typeof leads.$inferSelect) {
  return [
    `🏢 ${lead.company}`,
    lead.contact ? `Kontakt: ${lead.contact}` : "Kontakt: noch offen",
    `E-Mail: ${lead.email || "fehlt"}`,
    `Video: ${lead.videoStatus}`,
    `Watchtime: ${lead.watchPercent} %`,
    `Priorität: ${lead.salesPriority}`,
    "",
    `Landingpage: ${appUrl()}/v/${lead.slug}`,
  ].join("\n");
}

async function showNext(workspaceId: string) {
  const candidates = await getDb().select().from(leads).where(eq(leads.workspaceId, workspaceId)).orderBy(desc(leads.salesPriority), asc(leads.createdAt)).limit(300);
  const lead = candidates.find(eligibleLead);
  if (!lead) return sendTelegramMessage("✅ Kein weiterer versandbereiter Lead in der Warteschlange.");
  return sendTelegramMessage(leadText(lead), {
    buttons: [
      [{ text: "✅ Freigeben", callback_data: `approve:${lead.id}` }, { text: "⏭ Überspringen", callback_data: `skip:${lead.id}` }],
      [{ text: "🚫 Sperren", callback_data: `block:${lead.id}` }, { text: "🔄 Video zurücksetzen", callback_data: `retry:${lead.id}` }],
      [{ text: "Landingpage prüfen ↗", url: `${appUrl()}/v/${lead.slug}` }, { text: "CRM öffnen ↗", url: `${appUrl()}/dashboard#leads` }],
    ],
  });
}

async function handleLeadAction(workspaceId: string, action: string, leadId: string) {
  const db = getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId))).limit(1);
  if (!lead) return sendTelegramMessage("Lead wurde nicht gefunden.");
  if (action === "approve") {
    const tags = Array.from(new Set([...lead.tags.filter((tag) => tag !== "skipped"), "approved"]));
    await db.update(leads).set({ tags, salesPriority: Math.max(lead.salesPriority, 90), updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await logAction(workspaceId, "telegram_lead_approved", "Per Telegram freigegeben.", lead.id);
    return sendTelegramMessage(`✅ ${lead.company} wurde freigegeben und priorisiert.\n${appUrl()}/v/${lead.slug}`);
  }
  if (action === "skip") {
    const tags = Array.from(new Set([...lead.tags, "skipped"]));
    await db.update(leads).set({ tags, updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await logAction(workspaceId, "telegram_lead_skipped", "Per Telegram übersprungen.", lead.id);
    return sendTelegramMessage(`⏭ ${lead.company} wurde übersprungen.`);
  }
  if (action === "block") {
    const tags = Array.from(new Set([...lead.tags, "do-not-contact"]));
    await db.update(leads).set({ tags, pipelineStage: "lost", updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await logAction(workspaceId, "telegram_lead_blocked", "Per Telegram dauerhaft gesperrt.", lead.id);
    return sendTelegramMessage(`🚫 ${lead.company} wurde dauerhaft für den Versand gesperrt.`);
  }
  if (action === "retry") {
    await db.update(leads).set({ videoStatus: "not_started", updatedAt: new Date() }).where(eq(leads.id, lead.id));
    await logAction(workspaceId, "telegram_video_reset", "Video zur erneuten manuellen Erstellung zurückgesetzt.", lead.id);
    return sendTelegramMessage(`🔄 Video von ${lead.company} wurde zurückgesetzt. Starte die Erstellung bewusst im Cockpit.`, {
      buttons: [[{ text: "Cockpit öffnen ↗", url: `${appUrl()}/dashboard#leads` }]],
    });
  }
  return sendTelegramMessage("Unbekannte Lead-Aktion.");
}

async function executeCommand(workspaceId: string, values: Record<string, string>, raw: string) {
  const [commandRaw, ...args] = raw.trim().split(/\s+/);
  const command = commandRaw.toLowerCase().split("@")[0];
  const db = getDb();
  const allLeads = await db.select().from(leads).where(eq(leads.workspaceId, workspaceId)).orderBy(desc(leads.salesPriority)).limit(2000);

  if (command === "/start") {
    return sendTelegramMessage("Kampagne wirklich starten? Danach kann der 5-Minuten-Takt E-Mails versenden.", {
      buttons: [[{ text: "🟢 Ja, starten", callback_data: "campaign:start" }, { text: "Abbrechen", callback_data: "campaign:cancel" }]],
    });
  }
  if (command === "/stop") {
    await setSetting(workspaceId, "campaign_running", "false");
    await setSetting(workspaceId, "campaign_stopped_at", new Date().toISOString());
    await logAction(workspaceId, "campaign_stopped", "Per Telegram gestoppt.");
    return sendTelegramMessage("⏸ Kampagne sofort gestoppt. Es werden keine weiteren Kampagnen-Mails versendet.");
  }
  if (command === "/pause") {
    const minutes = Math.min(Math.max(Number(args[0]) || 60, 5), 1440);
    const until = new Date(Date.now() + minutes * 60_000);
    await setSetting(workspaceId, "campaign_paused_until", until.toISOString());
    await logAction(workspaceId, "campaign_paused", `${minutes} Minuten`);
    return sendTelegramMessage(`⏸ Versand für ${minutes} Minuten pausiert – bis ${until.toLocaleString("de-DE")}.`);
  }
  if (command === "/limit") {
    const limit = Math.min(Math.max(Number(args[0]) || 0, 1), 200);
    await setSetting(workspaceId, "campaign_daily_limit", String(limit));
    await logAction(workspaceId, "campaign_limit_changed", String(limit));
    return sendTelegramMessage(`✅ Tageslimit auf ${limit} E-Mails gesetzt.`);
  }
  if (command === "/intervall") {
    const minutes = Math.min(Math.max(Number(args[0]) || 0, 5), 240);
    await setSetting(workspaceId, "campaign_interval_minutes", String(minutes));
    await logAction(workspaceId, "campaign_interval_changed", String(minutes));
    return sendTelegramMessage(`✅ Versandabstand auf mindestens ${minutes} Minuten gesetzt.`);
  }
  if (command === "/zeiten") {
    const pattern = /^([01]\d|2[0-3]):[0-5]\d$/;
    if (!pattern.test(args[0] || "") || !pattern.test(args[1] || "")) return sendTelegramMessage("Format: /zeiten 08:00 18:00");
    await setSetting(workspaceId, "campaign_send_start", args[0]);
    await setSetting(workspaceId, "campaign_send_end", args[1]);
    await logAction(workspaceId, "campaign_hours_changed", `${args[0]}–${args[1]}`);
    return sendTelegramMessage(`✅ Versandfenster auf ${args[0]}–${args[1]} Uhr (Europe/Berlin) gesetzt.`);
  }
  if (command === "/next") return showNext(workspaceId);
  if (command === "/queue") {
    const queue = allLeads.filter(eligibleLead).slice(0, 10);
    return sendTelegramMessage(queue.length ? `📬 Versandbereit (${queue.length} angezeigt)\n\n${queue.map((lead, index) => `${index + 1}. ${lead.company} · ${lead.email}`).join("\n")}` : "✅ Keine versandbereiten Leads.");
  }
  if (command === "/best") {
    const best = [...allLeads].sort((a, b) => b.watchPercent - a.watchPercent || b.salesPriority - a.salesPriority).slice(0, 8);
    return sendTelegramMessage(`🔥 Heißeste Leads\n\n${best.map((lead, index) => `${index + 1}. ${lead.company} · ${lead.watchPercent}% · ${lead.pipelineStage}\n${appUrl()}/v/${lead.slug}`).join("\n\n")}`);
  }
  if (command === "/errors") {
    const rows = await db.select().from(jobs).where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, "failed"))).orderBy(desc(jobs.createdAt)).limit(6);
    return sendTelegramMessage(rows.length ? `🚨 Letzte Fehler\n\n${rows.map((row) => `• ${row.type}\n${(row.error || "Ohne Detail").slice(0, 500)}`).join("\n\n")}` : "✅ Keine protokollierten Fehler.");
  }
  if (command === "/logs") {
    const rows = await db.select().from(jobs).where(eq(jobs.workspaceId, workspaceId)).orderBy(desc(jobs.createdAt)).limit(10);
    return sendTelegramMessage(`📋 Letzte Prozesse\n\n${rows.map((row) => `• ${row.type} · ${row.status} · ${new Date(row.createdAt).toLocaleString("de-DE")}`).join("\n")}`);
  }

  const now = new Date();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const weekStart = new Date(now); weekStart.setDate(now.getDate() - 7);
  if (["/heute", "/woche", "/performance", "/status"].includes(command)) {
    const since = command === "/woche" ? weekStart : dayStart;
    const sentRows = await db.select().from(outreach).where(and(eq(outreach.workspaceId, workspaceId), eq(outreach.status, "sent"), gte(outreach.sentAt, since)));
    const ready = allLeads.filter((lead) => lead.videoStatus === "ready").length;
    const viewed = allLeads.filter((lead) => lead.watchPercent > 0).length;
    const hot = allLeads.filter((lead) => lead.watchPercent >= 60).length;
    const booked = allLeads.filter((lead) => lead.pipelineStage === "call_booked" || lead.pipelineStage === "won").length;
    if (command === "/status") {
      const pausedUntil = values.campaign_paused_until ? new Date(values.campaign_paused_until) : null;
      return sendTelegramMessage([
        values.campaign_running === "true" ? "🟢 Kampagne läuft" : "⏸ Kampagne gestoppt",
        pausedUntil && pausedUntil > now ? `Pausiert bis: ${pausedUntil.toLocaleString("de-DE")}` : "",
        `Versandbereit: ${allLeads.filter(eligibleLead).length}`,
        `Heute gesendet: ${sentRows.length} / ${values.campaign_daily_limit || "25"}`,
        `Intervall: ${values.campaign_interval_minutes || "5"} Minuten`,
        `Versandfenster: ${values.campaign_send_start || "08:00"}–${values.campaign_send_end || "18:00"}`,
        `Videos bereit: ${ready}`,
        `Hot Leads: ${hot}`,
      ].filter(Boolean).join("\n"), { buttons: [[{ text: "Nächsten Lead öffnen", callback_data: "lead:next" }, { text: "Cockpit ↗", url: `${appUrl()}/system` }]] });
    }
    const label = command === "/woche" ? "Letzte 7 Tage" : command === "/performance" ? "Performance" : "Heute";
    const viewRate = sentRows.length ? Math.round((viewed / sentRows.length) * 100) : 0;
    return sendTelegramMessage(`📊 ${label}\n\nE-Mails gesendet: ${sentRows.length}\nVideos bereit: ${ready}\nVideo angesehen: ${viewed}\nHot Leads (≥60%): ${hot}\nTermine: ${booked}\nView-Rate: ${viewRate}%`);
  }
  return sendTelegramMessage(commandHelp());
}

export async function POST(request: Request) {
  const secret = telegramWebhookSecret();
  if (!secret || request.headers.get("x-telegram-bot-api-secret-token") !== secret) return Response.json({ error: "Nicht autorisiert." }, { status: 401 });
  const update = await request.json() as TelegramUpdate;
  const chatId = update.message?.chat?.id || update.callback_query?.message?.chat?.id;
  if (!allowedChat(chatId)) return Response.json({ ok: true, ignored: true });

  try {
    const { workspace, values } = await workspaceContext();
    if (update.callback_query) {
      const callback = update.callback_query;
      await answerTelegramCallback(callback.id);
      const data = callback.data || "";
      if (data === "campaign:start") {
        await setSetting(workspace.id, "campaign_running", "true");
        await setSetting(workspace.id, "campaign_paused_until", "");
        await setSetting(workspace.id, "campaign_started_at", new Date().toISOString());
        await logAction(workspace.id, "campaign_started", "Per Telegram bestätigt.");
        await sendTelegramMessage("🟢 Kampagne gestartet. Sicherheitslimits und Versandzeiten bleiben aktiv.");
      } else if (data === "campaign:cancel") {
        await sendTelegramMessage("Start abgebrochen. Die Kampagne bleibt gestoppt.");
      } else if (data === "lead:next") {
        await showNext(workspace.id);
      } else {
        const [action, leadId] = data.split(":");
        if (leadId) await handleLeadAction(workspace.id, action, leadId);
      }
    } else {
      await executeCommand(workspace.id, values, update.message?.text || "/help");
    }
    return Response.json({ ok: true });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Unbekannter Telegram-Fehler";
    await sendTelegramMessage(`🚨 Telegram-Befehl fehlgeschlagen\n${detail}`);
    return Response.json({ error: detail }, { status: 500 });
  }
}
