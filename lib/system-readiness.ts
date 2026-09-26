import { and, count, eq, gte, inArray, isNotNull, lt, ne } from "drizzle-orm";
import { getDb } from "@/db";
import {
  accounts,
  assets,
  jobs,
  leads,
  outreach,
  researchCandidates,
  settings,
  tasks,
  users,
  whatsappQueue,
  workspaceMembers,
} from "@/db/schema";
import { getDailyQueueStatsForOwners } from "@/lib/daily-queue";
import { stratoMailStatus, listRecentStratoInboxMessages } from "@/lib/strato-mail";
import { verifyVideoRenderer } from "@/lib/video-renderer";
import { getBridgeStatus } from "@/lib/whatsapp/worker-status";
import { getAgentConfig } from "@/lib/whatsapp/config";
import { normalizedPermissions, normalizedRole } from "@/lib/team";

export type ReadinessLevel = "required" | "automation" | "recommended";

export type ReadinessCheck = {
  key: string;
  ok: boolean;
  level: ReadinessLevel;
  label: string;
  detail: string;
  actionHref?: string;
};

type JsonObject = Record<string, unknown>;

function parseJson(value: string | undefined): JsonObject {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed as JsonObject : {};
  } catch {
    return {};
  }
}

function stringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function stale(value: unknown, hours = 30) {
  if (typeof value !== "string" || !value) return true;
  const stamp = Date.parse(value);
  return !Number.isFinite(stamp) || Date.now() - stamp > hours * 3_600_000;
}

export async function getSystemReadiness(workspaceId: string, deep = false) {
  const db = getDb();
  const now = new Date();
  const since24h = new Date(now.getTime() - 24 * 60 * 60_000);

  const [
    settingRows,
    masterVideoRows,
    leadCounts,
    callReadyCounts,
    openTaskCounts,
    overdueTaskCounts,
    scheduledFollowupCounts,
    failedJobCounts,
    failedOutreachCounts,
    failedWhatsappCounts,
    researchPoolCounts,
    memberRows,
  ] = await Promise.all([
    db.select({ key: settings.key, value: settings.value })
      .from(settings)
      .where(eq(settings.workspaceId, workspaceId)),
    db.select({ id: assets.id, filename: assets.filename, size: assets.size })
      .from(assets)
      .where(and(eq(assets.workspaceId, workspaceId), eq(assets.kind, "master_video")))
      .limit(1),
    db.select({ value: count() })
      .from(leads)
      .where(eq(leads.workspaceId, workspaceId)),
    db.select({ value: count() })
      .from(leads)
      .where(and(
        eq(leads.workspaceId, workspaceId),
        eq(leads.contactLocked, false),
        ne(leads.phone, ""),
        inArray(leads.nextAction, ["call", "retry_call", "callback"]),
      )),
    db.select({ value: count() })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.status, "open"))),
    db.select({ value: count() })
      .from(tasks)
      .where(and(
        eq(tasks.workspaceId, workspaceId),
        eq(tasks.status, "open"),
        isNotNull(tasks.dueAt),
        lt(tasks.dueAt, now),
      )),
    db.select({ value: count() })
      .from(outreach)
      .where(and(eq(outreach.workspaceId, workspaceId), eq(outreach.status, "scheduled"))),
    db.select({ value: count() })
      .from(jobs)
      .where(and(eq(jobs.workspaceId, workspaceId), eq(jobs.status, "failed"), gte(jobs.updatedAt, since24h))),
    db.select({ value: count() })
      .from(outreach)
      .where(and(eq(outreach.workspaceId, workspaceId), eq(outreach.status, "failed"), gte(outreach.updatedAt, since24h))),
    db.select({ value: count() })
      .from(whatsappQueue)
      .where(and(
        eq(whatsappQueue.workspaceId, workspaceId),
        inArray(whatsappQueue.status, ["failed", "unknown"]),
        gte(whatsappQueue.updatedAt, since24h),
      )),
    db.select({ value: count() })
      .from(researchCandidates)
      .where(and(eq(researchCandidates.workspaceId, workspaceId), eq(researchCandidates.status, "call_ready"))),
    db.select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: workspaceMembers.role,
      permissions: workspaceMembers.permissions,
      googleScope: accounts.scope,
    })
      .from(workspaceMembers)
      .innerJoin(users, eq(users.id, workspaceMembers.userId))
      .leftJoin(accounts, and(eq(accounts.userId, users.id), eq(accounts.provider, "google")))
      .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.status, "active"))),
  ]);

  const settingMap = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
  const researchConfig = parseJson(settingMap.research_feed_config);
  const researchRun = parseJson(settingMap.research_feed_last_run);
  const supplyConfig = parseJson(settingMap.lead_supply_config);
  const supplyRun = parseJson(settingMap.lead_supply_last_run);

  const researchEnabled = researchConfig.enabled === true;
  const researchQueries = stringArray(researchConfig.queries);
  const supplyEnabled = supplyConfig.enabled === true;
  const supplyAssigneeIds = stringArray(supplyConfig.assigneeIds);
  const supplyTarget = Math.max(10, Math.min(60, Number(supplyConfig.queueTarget) || 30));

  const callerMap = new Map<string, {
    userId: string;
    name: string;
    role: string;
    calendarConnected: boolean;
  }>();

  for (const row of memberRows) {
    const role = normalizedRole(row.role);
    const permissions = normalizedPermissions(role, row.permissions);
    const isCaller = ["owner", "admin", "sales", "setter"].includes(role)
      && permissions.includes("view_own_leads")
      && permissions.includes("manage_leads");
    if (!isCaller) continue;

    const calendarConnected = Boolean(
      row.googleScope?.includes("https://www.googleapis.com/auth/calendar.events")
      && row.googleScope?.includes("https://www.googleapis.com/auth/calendar.freebusy"),
    );
    const existing = callerMap.get(row.userId);
    if (existing) {
      existing.calendarConnected = existing.calendarConnected || calendarConnected;
      continue;
    }
    callerMap.set(row.userId, {
      userId: row.userId,
      name: row.name || row.email || "Mitarbeiter",
      role,
      calendarConnected,
    });
  }

  const callers = [...callerMap.values()];
  const selectedCallers = callers.filter((caller) => supplyAssigneeIds.includes(caller.userId));
  const queueRows = await getDailyQueueStatsForOwners(workspaceId, callers.map((caller) => caller.userId));
  const queueByOwner = new Map(queueRows.map((row) => [row.ownerId, row]));

  const bridge = await getBridgeStatus(workspaceId).catch(() => ({
    configured: false,
    connected: false,
    aiReady: false,
    aiModel: "",
    message: "WhatsApp-Status konnte nicht gelesen werden",
    aiMessage: "Lokale KI nicht geprüft",
  }));
  const whatsappAgent = await getAgentConfig(workspaceId).catch(() => null);
  const whatsappEnabled = Boolean(whatsappAgent?.enabled || whatsappAgent?.dailyOutreachEnabled);

  const mail = stratoMailStatus();
  let mailLiveOk: boolean | null = null;
  let mailLiveDetail = "";
  let rendererOk: boolean | null = null;
  let rendererDetail = "";

  if (deep) {
    const probes = await Promise.allSettled([
      mail.configured ? listRecentStratoInboxMessages(1) : Promise.reject(new Error("STRATO Mail nicht konfiguriert")),
      verifyVideoRenderer(),
    ]);
    const mailProbe = probes[0];
    const rendererProbe = probes[1];

    mailLiveOk = mailProbe.status === "fulfilled";
    mailLiveDetail = mailProbe.status === "fulfilled"
      ? "IMAP-Login erfolgreich."
      : mailProbe.reason instanceof Error ? mailProbe.reason.message : "IMAP-Prüfung fehlgeschlagen.";

    rendererOk = rendererProbe.status === "fulfilled" && rendererProbe.value.ok === true;
    rendererDetail = rendererProbe.status === "fulfilled"
      ? rendererProbe.value.format + " · " + rendererProbe.value.resolution
      : rendererProbe.reason instanceof Error ? rendererProbe.reason.message : "Renderer-Prüfung fehlgeschlagen.";
  }

  const checks: ReadinessCheck[] = [
    {
      key: "database",
      ok: true,
      level: "required",
      label: "Datenbank",
      detail: "Workspace-Daten und Betriebsmetriken konnten gelesen werden.",
    },
    {
      key: "storage",
      ok: Boolean(process.env.BLOB_READ_WRITE_TOKEN),
      level: "required",
      label: "Medien-Speicher",
      detail: process.env.BLOB_READ_WRITE_TOKEN ? "Vercel Blob ist konfiguriert." : "BLOB_READ_WRITE_TOKEN fehlt.",
      actionHref: "/dashboard/integrations",
    },
    {
      key: "mail",
      ok: mail.configured && mailLiveOk !== false,
      level: "required",
      label: "STRATO Mail",
      detail: deep
        ? mailLiveDetail || (mail.configured ? "Konfiguriert." : "Zugangsdaten fehlen.")
        : mail.configured ? mail.email + " ist konfiguriert." : "STRATO_MAIL_EMAIL / STRATO_MAIL_PASSWORD fehlen.",
      actionHref: "/dashboard/email",
    },
    {
      key: "cron",
      ok: Boolean(process.env.CRON_SECRET),
      level: "required",
      label: "Cron & Automationen",
      detail: process.env.CRON_SECRET ? "CRON_SECRET vorhanden." : "CRON_SECRET fehlt – zeitgesteuerte Prozesse sind nicht sicher startklar.",
      actionHref: "/system",
    },
    {
      key: "master_video",
      ok: Boolean(masterVideoRows[0]),
      level: "required",
      label: "Jessica Mastervideo",
      detail: masterVideoRows[0]
        ? masterVideoRows[0].filename + " · " + Math.max(1, Math.round(masterVideoRows[0].size / 1024 / 1024)) + " MB"
        : "Kein Mastervideo vorhanden – personalisierte Videos können nicht vollständig gerendert werden.",
      actionHref: "/dashboard/integrations",
    },
    {
      key: "renderer",
      ok: deep ? rendererOk === true : true,
      level: "required",
      label: "Video-Renderer",
      detail: deep
        ? rendererDetail
        : "Standardcheck: nicht ausgeführt. Der Tiefencheck rendert sichere Testsegmente ohne Kundendaten.",
      actionHref: "/system",
    },
    {
      key: "callers",
      ok: callers.length > 0,
      level: "required",
      label: "Mitarbeiter / Caller",
      detail: callers.length
        ? String(callers.length) + " aktiver Caller-Zugang verfügbar."
        : "Kein aktiver Vertrieb-/Setter-Zugang mit Lead-Rechten vorhanden.",
      actionHref: "/dashboard/team",
    },
    {
      key: "queue",
      ok: Number(callReadyCounts[0]?.value || 0) > 0 || Number(leadCounts[0]?.value || 0) === 0,
      level: "recommended",
      label: "Tages-Queue",
      detail: String(Number(callReadyCounts[0]?.value || 0)) + " call-bereite oder fällige Leads im CRM.",
      actionHref: "/dashboard/queue",
    },
    {
      key: "calendar",
      ok: callers.length === 0 || callers.every((caller) => caller.calendarConnected),
      level: "recommended",
      label: "Google Kalender",
      detail: callers.length
        ? String(callers.filter((caller) => caller.calendarConnected).length) + "/" + String(callers.length) + " Caller verbunden. Manuelle Terminierung bleibt als Fallback verfügbar."
        : "Noch keine Caller vorhanden.",
      actionHref: "/dashboard/team",
    },
    {
      key: "research",
      ok: !researchEnabled || (researchQueries.length > 0 && !stale(researchRun.finishedAt)),
      level: "automation",
      label: "Lead Scout",
      detail: !researchEnabled
        ? "Automatische Recherche pausiert; manuelle Recherche bleibt möglich."
        : researchQueries.length === 0
          ? "Automatik aktiv, aber es fehlen Suchprofile."
          : stale(researchRun.finishedAt)
            ? "Automatik aktiv, aber letzter erfolgreicher Lauf fehlt oder ist älter als 30 Stunden."
            : "Letzter Lauf: " + String(researchRun.finishedAt) + ".",
      actionHref: "/dashboard/research",
    },
    {
      key: "supply",
      ok: !supplyEnabled || (
        selectedCallers.length === supplyAssigneeIds.length
        && selectedCallers.length > 0
        && !stale(supplyRun.finishedAt)
      ),
      level: "automation",
      label: "Auto-Nachschub",
      detail: !supplyEnabled
        ? "Automatische Verteilung pausiert; Queues können manuell aufgefüllt werden."
        : selectedCallers.length !== supplyAssigneeIds.length || selectedCallers.length === 0
          ? "Mindestens ein ausgewählter Caller ist nicht mehr aktiv oder nicht berechtigt."
          : stale(supplyRun.finishedAt)
            ? String(selectedCallers.length) + " Caller · Ziel " + String(supplyTarget) + "; letzter erfolgreicher Lauf fehlt oder ist älter als 30 Stunden."
            : String(selectedCallers.length) + " Caller · Ziel " + String(supplyTarget) + " offene Calls je Mitarbeiter.",
      actionHref: "/dashboard/research",
    },
    {
      key: "whatsapp",
      ok: !whatsappEnabled || (bridge.connected && bridge.aiReady),
      level: "automation",
      label: "WhatsApp & lokale KI",
      detail: !whatsappEnabled
        ? "WhatsApp-Automation ist nicht aktiv; manueller WhatsApp-Modus bleibt nutzbar."
        : bridge.message + " · " + bridge.aiMessage,
      actionHref: "/dashboard/whatsapp",
    },
    {
      key: "errors",
      ok: Number(failedJobCounts[0]?.value || 0) + Number(failedOutreachCounts[0]?.value || 0) + Number(failedWhatsappCounts[0]?.value || 0) === 0,
      level: "recommended",
      label: "Fehler letzte 24h",
      detail: String(Number(failedJobCounts[0]?.value || 0)) + " Jobs · "
        + String(Number(failedOutreachCounts[0]?.value || 0)) + " E-Mails · "
        + String(Number(failedWhatsappCounts[0]?.value || 0)) + " WhatsApp unklar/fehlgeschlagen.",
      actionHref: "/system",
    },
    {
      key: "tasks",
      ok: Number(overdueTaskCounts[0]?.value || 0) === 0,
      level: "recommended",
      label: "Offene Aufgaben",
      detail: String(Number(openTaskCounts[0]?.value || 0)) + " offen · "
        + String(Number(overdueTaskCounts[0]?.value || 0)) + " überfällig.",
      actionHref: "/dashboard",
    },
  ];

  const enabledAutomationChecks = checks.filter((item) =>
    item.level === "automation"
    && (
      (item.key === "research" && researchEnabled)
      || (item.key === "supply" && supplyEnabled)
      || (item.key === "whatsapp" && whatsappEnabled)
    )
  );
  const launchReady = checks.filter((item) => item.level === "required").every((item) => item.ok);
  const automationReady = launchReady && enabledAutomationChecks.every((item) => item.ok);
  const warnings = checks.filter((item) => !item.ok && item.level === "recommended").length;
  const blockers = checks.filter((item) => !item.ok && (item.level === "required" || item.level === "automation")).length;

  return {
    ok: true,
    deep,
    launchReady,
    automationReady,
    warnings,
    blockers,
    status: blockers ? "blocked" : warnings ? "ready_with_warnings" : "ready",
    checks,
    counts: {
      leads: Number(leadCounts[0]?.value || 0),
      callReadyLeads: Number(callReadyCounts[0]?.value || 0),
      callReadyPool: Number(researchPoolCounts[0]?.value || 0),
      openTasks: Number(openTaskCounts[0]?.value || 0),
      overdueTasks: Number(overdueTaskCounts[0]?.value || 0),
      scheduledFollowups: Number(scheduledFollowupCounts[0]?.value || 0),
      callers: callers.length,
      calendarsConnected: callers.filter((caller) => caller.calendarConnected).length,
    },
    callerQueues: callers.map((caller) => {
      const queue = queueByOwner.get(caller.userId);
      return {
        userId: caller.userId,
        name: caller.name,
        total: queue?.total || 0,
        callbacks: queue?.callbacks || 0,
        highPriority: queue?.highPriority || 0,
        calendarConnected: caller.calendarConnected,
        autoSupplySelected: supplyAssigneeIds.includes(caller.userId),
      };
    }),
    automation: {
      researchEnabled,
      supplyEnabled,
      whatsappEnabled,
    },
  };
}
