import { and, count, eq, gte, inArray, isNotNull } from "drizzle-orm";
import { getDb } from "@/db";
import {
  accounts,
  activities,
  bookings,
  jobs,
  leads,
  outreach,
  researchCandidates,
  tasks,
  users,
  whatsappMessages,
  whatsappQueue,
  whatsappThreads,
  workspaceMembers,
} from "@/db/schema";
import { getDailyQueueStatsForOwners } from "@/lib/daily-queue";
import { getLeadSupplyConfig, getLeadSupplyLastRun } from "@/lib/lead-supply";
import { getResearchFeedConfig, getResearchFeedLastRun } from "@/lib/research-feed";
import { hasPermission, normalizedPermissions, normalizedRole } from "@/lib/team";

export type ManagerRange = 1 | 7 | 30;

const TRACKED_CALL_TYPES = ["call_started", "call_result"] as const;
const CONNECTED_RESULTS = ["info_requested", "whatsapp_requested", "callback", "meeting", "no_interest"] as const;
const CALLER_ROLES = new Set(["owner", "admin", "sales", "setter"]);

function offsetMinutes(timeZone: string, date: Date) {
  const part = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
    year: "numeric",
  }).formatToParts(date).find((item) => item.type === "timeZoneName")?.value || "GMT+00:00";
  const match = part.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) return 0;
  const value = Number(match[2]) * 60 + Number(match[3]);
  return match[1] === "-" ? -value : value;
}

function berlinStart(range: ManagerRange) {
  const timeZone = "Europe/Berlin";
  const now = new Date();
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now).map((item) => [item.type, item.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day) - (range - 1);
  const utcMidnight = new Date(Date.UTC(year, month - 1, day, 0));
  const offset = offsetMinutes(timeZone, utcMidnight);
  return new Date(utcMidnight.getTime() - offset * 60_000);
}

type Member = {
  userId: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  calendarConnected: boolean;
};

async function loadMembers(workspaceId: string): Promise<Member[]> {
  const rows = await getDb()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      status: users.status,
      role: workspaceMembers.role,
      permissions: workspaceMembers.permissions,
      googleScope: accounts.scope,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .leftJoin(accounts, and(eq(accounts.userId, users.id), eq(accounts.provider, "google")))
    .where(eq(workspaceMembers.workspaceId, workspaceId));

  const unique = new Map<string, Member>();
  for (const row of rows) {
    if (row.status !== "active") continue;
    const role = normalizedRole(row.role);
    const calendarConnected = Boolean(
      row.googleScope?.includes("https://www.googleapis.com/auth/calendar.events")
      && row.googleScope?.includes("https://www.googleapis.com/auth/calendar.freebusy"),
    );
    const existing = unique.get(row.userId);
    if (existing) {
      existing.calendarConnected = existing.calendarConnected || calendarConnected;
      continue;
    }
    unique.set(row.userId, {
      userId: row.userId,
      name: row.name || row.email || "Mitarbeiter",
      email: row.email || "",
      role,
      permissions: normalizedPermissions(role, row.permissions),
      calendarConnected,
    });
  }
  return [...unique.values()];
}

function callResult(metadata: unknown, detail: string) {
  if (metadata && typeof metadata === "object" && !Array.isArray(metadata)) {
    const value = (metadata as { result?: unknown }).result;
    if (typeof value === "string") return value;
  }
  return detail || "";
}

function isStale(value: string | null | undefined, hours = 30) {
  if (!value) return true;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) || Date.now() - date.getTime() > hours * 3_600_000;
}

export async function getManagerDashboard(args: {
  workspaceId: string;
  currentUserId: string;
  role: string;
  permissions: string[];
  range: ManagerRange;
}) {
  const db = getDb();
  const start = berlinStart(args.range);
  const dayStart = berlinStart(1);
  const canViewTeam = hasPermission(args.role, args.permissions, "view_all_leads")
    && hasPermission(args.role, args.permissions, "view_kpis");

  const [
    allMembers,
    activityRows,
    outreachRows,
    bookingRows,
    taskRows,
    whatsappRows,
    failedJobRows,
    failedOutreachRows,
    failedWhatsappRows,
    callReadyRows,
    supplyConfig,
    supplyRun,
    researchConfig,
    researchRun,
  ] = await Promise.all([
    loadMembers(args.workspaceId),
    db.select({
      userId: activities.userId,
      leadId: activities.leadId,
      leadOwnerId: leads.ownerId,
      type: activities.type,
      detail: activities.detail,
      metadata: activities.metadata,
    })
      .from(activities)
      .innerJoin(leads, eq(leads.id, activities.leadId))
      .where(and(
        eq(activities.workspaceId, args.workspaceId),
        eq(leads.workspaceId, args.workspaceId),
        gte(activities.createdAt, start),
        inArray(activities.type, [...TRACKED_CALL_TYPES]),
      )),
    db.select({ leadId: outreach.leadId, ownerId: leads.ownerId, step: outreach.step })
      .from(outreach)
      .innerJoin(leads, eq(leads.id, outreach.leadId))
      .where(and(
        eq(outreach.workspaceId, args.workspaceId),
        eq(leads.workspaceId, args.workspaceId),
        eq(outreach.status, "sent"),
        isNotNull(outreach.sentAt),
        gte(outreach.sentAt, start),
      )),
    db.select({ leadId: bookings.leadId, ownerId: leads.ownerId })
      .from(bookings)
      .innerJoin(leads, eq(leads.id, bookings.leadId))
      .where(and(
        eq(leads.workspaceId, args.workspaceId),
        gte(bookings.createdAt, start),
        inArray(bookings.status, ["requested", "confirmed"]),
      )),
    db.select({ assigneeId: tasks.assigneeId, dueAt: tasks.dueAt })
      .from(tasks)
      .where(and(eq(tasks.workspaceId, args.workspaceId), eq(tasks.status, "open"))),
    db.select({ leadId: whatsappThreads.leadId, ownerId: leads.ownerId })
      .from(whatsappMessages)
      .innerJoin(whatsappThreads, eq(whatsappThreads.id, whatsappMessages.threadId))
      .innerJoin(leads, eq(leads.id, whatsappThreads.leadId))
      .where(and(
        eq(whatsappMessages.workspaceId, args.workspaceId),
        eq(leads.workspaceId, args.workspaceId),
        eq(whatsappMessages.direction, "outbound"),
        eq(whatsappMessages.status, "sent"),
        isNotNull(whatsappMessages.sentAt),
        gte(whatsappMessages.sentAt, start),
      )),
    db.select({ value: count() }).from(jobs).where(and(
      eq(jobs.workspaceId, args.workspaceId),
      eq(jobs.status, "failed"),
      gte(jobs.updatedAt, new Date(Date.now() - 86_400_000)),
    )),
    db.select({ value: count() }).from(outreach).where(and(
      eq(outreach.workspaceId, args.workspaceId),
      eq(outreach.status, "failed"),
      gte(outreach.updatedAt, new Date(Date.now() - 86_400_000)),
    )),
    db.select({ value: count() }).from(whatsappQueue).where(and(
      eq(whatsappQueue.workspaceId, args.workspaceId),
      eq(whatsappQueue.status, "failed"),
      gte(whatsappQueue.updatedAt, new Date(Date.now() - 86_400_000)),
    )),
    db.select({ value: count() }).from(researchCandidates).where(and(
      eq(researchCandidates.workspaceId, args.workspaceId),
      eq(researchCandidates.status, "call_ready"),
    )),
    getLeadSupplyConfig(args.workspaceId),
    getLeadSupplyLastRun(args.workspaceId),
    getResearchFeedConfig(args.workspaceId),
    getResearchFeedLastRun(args.workspaceId),
  ]);

  const members = canViewTeam
    ? allMembers
    : allMembers.filter((member) => member.userId === args.currentUserId);

  const activityByUser = new Map<string, { started: number; results: Map<string, number> }>();
  for (const row of activityRows) {
    const actorId = row.userId || row.leadOwnerId || "";
    if (!actorId) continue;
    const bucket = activityByUser.get(actorId) || { started: 0, results: new Map<string, number>() };
    if (row.type === "call_started") {
      bucket.started += 1;
    } else if (row.type === "call_result") {
      const result = callResult(row.metadata, row.detail);
      if (result) bucket.results.set(result, (bucket.results.get(result) || 0) + 1);
    }
    activityByUser.set(actorId, bucket);
  }

  const channelByOwner = new Map<string, { infoSent: number; followupsSent: number; whatsappSent: number; booked: number }>();
  const infoLeadSeen = new Set<string>();
  const whatsappLeadSeen = new Set<string>();
  function ownerBucket(ownerId: string) {
    const current = channelByOwner.get(ownerId) || { infoSent: 0, followupsSent: 0, whatsappSent: 0, booked: 0 };
    channelByOwner.set(ownerId, current);
    return current;
  }
  for (const row of outreachRows) {
    const ownerId = row.ownerId || "";
    if (!ownerId) continue;
    const bucket = ownerBucket(ownerId);
    if (row.step === 1) {
      const key = ownerId + ":" + row.leadId;
      if (!infoLeadSeen.has(key)) {
        infoLeadSeen.add(key);
        bucket.infoSent += 1;
      }
    } else {
      bucket.followupsSent += 1;
    }
  }
  for (const row of whatsappRows) {
    const ownerId = row.ownerId || "";
    if (!ownerId) continue;
    const key = ownerId + ":" + row.leadId;
    if (whatsappLeadSeen.has(key)) continue;
    whatsappLeadSeen.add(key);
    ownerBucket(ownerId).whatsappSent += 1;
  }
  for (const row of bookingRows) {
    const ownerId = row.ownerId || "";
    if (ownerId) ownerBucket(ownerId).booked += 1;
  }

  const tasksByUser = new Map<string, { open: number; overdue: number }>();
  for (const task of taskRows) {
    if (!task.assigneeId) continue;
    const bucket = tasksByUser.get(task.assigneeId) || { open: 0, overdue: 0 };
    bucket.open += 1;
    if (task.dueAt && task.dueAt < new Date()) bucket.overdue += 1;
    tasksByUser.set(task.assigneeId, bucket);
  }

  const queueEntries = await getDailyQueueStatsForOwners(args.workspaceId, members.map((member) => member.userId));
  const queueByUser = new Map(queueEntries.map((entry) => [entry.ownerId, {
    total: entry.total,
    callbacks: entry.callbacks,
    highPriority: entry.highPriority,
  }]));

  const people = members.map((member) => {
    const events = activityByUser.get(member.userId) || { started: 0, results: new Map<string, number>() };
    const channels = channelByOwner.get(member.userId) || { infoSent: 0, followupsSent: 0, whatsappSent: 0, booked: 0 };
    const task = tasksByUser.get(member.userId) || { open: 0, overdue: 0 };
    const queue = queueByUser.get(member.userId) || { total: 0, callbacks: 0, highPriority: 0 };
    const calls = events.started;
    const completedCalls = [...events.results.values()].reduce((sum, value) => sum + value, 0);
    const connected = CONNECTED_RESULTS.reduce((sum, result) => sum + (events.results.get(result) || 0), 0);
    const directBooked = events.results.get("meeting") || 0;

    return {
      userId: member.userId,
      name: member.name,
      email: member.email,
      role: member.role,
      isCaller: CALLER_ROLES.has(member.role),
      calendarConnected: member.calendarConnected,
      calls,
      completedCalls,
      inProgressCalls: Math.max(0, calls - completedCalls),
      connected,
      noAnswer: events.results.get("no_answer") || 0,
      infoRequested: events.results.get("info_requested") || 0,
      infoSent: channels.infoSent,
      followupsSent: channels.followupsSent,
      whatsappRequested: events.results.get("whatsapp_requested") || 0,
      whatsappSent: channels.whatsappSent,
      booked: channels.booked,
      directBooked,
      queue: queue.total,
      callbacks: queue.callbacks,
      highPriority: queue.highPriority,
      openTasks: task.open,
      overdueTasks: task.overdue,
      contactRate: completedCalls ? Math.round(connected / completedCalls * 100) : 0,
      bookingRate: connected ? Math.round(directBooked / connected * 100) : 0,
    };
  });

  const totals = people.reduce((acc, person) => {
    acc.calls += person.calls;
    acc.completedCalls += person.completedCalls;
    acc.inProgressCalls += person.inProgressCalls;
    acc.connected += person.connected;
    acc.noAnswer += person.noAnswer;
    acc.infoRequested += person.infoRequested;
    acc.infoSent += person.infoSent;
    acc.whatsappRequested += person.whatsappRequested;
    acc.whatsappSent += person.whatsappSent;
    acc.booked += person.booked;
    acc.directBooked += person.directBooked;
    acc.queue += person.queue;
    acc.openTasks += person.openTasks;
    acc.overdueTasks += person.overdueTasks;
    return acc;
  }, {
    calls: 0,
    completedCalls: 0,
    inProgressCalls: 0,
    connected: 0,
    noAnswer: 0,
    infoRequested: 0,
    infoSent: 0,
    whatsappRequested: 0,
    whatsappSent: 0,
    booked: 0,
    directBooked: 0,
    queue: 0,
    openTasks: 0,
    overdueTasks: 0,
  });

  const failedJobs = Number(failedJobRows[0]?.value || 0);
  const failedOutreach = Number(failedOutreachRows[0]?.value || 0);
  const failedWhatsapp = Number(failedWhatsappRows[0]?.value || 0);
  const callReadyPool = Number(callReadyRows[0]?.value || 0);
  const alerts: Array<{ tone: "critical" | "warn" | "good"; title: string; detail: string; href: string }> = [];
  const supplied = new Set(supplyConfig.assigneeIds);

  for (const person of people) {
    if (supplyConfig.enabled && supplied.has(person.userId) && person.queue < Math.ceil(supplyConfig.queueTarget * 0.4)) {
      alerts.push({
        tone: "critical",
        title: person.name + " hat zu wenig Call-Leads",
        detail: String(person.queue) + " / " + String(supplyConfig.queueTarget) + " offene Calls. Lead Scout bzw. Auto-Nachschub prüfen.",
        href: "/dashboard/research",
      });
    } else if (person.isCaller && person.queue < 5) {
      alerts.push({
        tone: "warn",
        title: person.name + " hat fast keine Tages-Queue",
        detail: "Nur " + String(person.queue) + " offene Calls vorhanden.",
        href: "/dashboard/queue?owner=" + person.userId,
      });
    }
    if (person.overdueTasks > 0) {
      alerts.push({
        tone: "warn",
        title: person.name + " hat überfällige Aufgaben",
        detail: String(person.overdueTasks) + " überfällig.",
        href: "/dashboard/crm",
      });
    }
  }

  const callersWithoutCalendar = people.filter((person) => person.isCaller && !person.calendarConnected);
  if (callersWithoutCalendar.length) {
    alerts.push({
      tone: "warn",
      title: callersWithoutCalendar.length === 1 ? "1 Caller ohne Google Kalender" : String(callersWithoutCalendar.length) + " Caller ohne Google Kalender",
      detail: callersWithoutCalendar.map((person) => person.name).slice(0, 4).join(", ") + ". Termin-Automation ist dort noch nicht vollständig einsatzbereit.",
      href: "/dashboard/team",
    });
  }

  if (researchConfig.enabled && isStale(researchRun?.finishedAt)) {
    alerts.push({
      tone: "warn",
      title: "Lead Scout läuft nicht aktuell",
      detail: researchRun?.finishedAt ? "Letzter erfolgreicher Lauf liegt über 30 Stunden zurück." : "Automatik ist aktiv, aber es gibt noch keinen erfolgreichen Lauf.",
      href: "/dashboard/research",
    });
  }
  if (supplyConfig.enabled && isStale(supplyRun?.finishedAt)) {
    alerts.push({
      tone: "warn",
      title: "Auto-Nachschub läuft nicht aktuell",
      detail: supplyRun?.finishedAt ? "Letzter Supply-Lauf liegt über 30 Stunden zurück." : "Auto-Nachschub ist aktiv, aber es gibt noch keinen erfolgreichen Lauf.",
      href: "/dashboard/research",
    });
  }

  const techErrors = failedJobs + failedOutreach + failedWhatsapp;
  if (techErrors > 0) {
    alerts.unshift({
      tone: "critical",
      title: "Technische Fehler in den letzten 24 Stunden",
      detail: String(failedJobs) + " Jobs · " + String(failedOutreach) + " E-Mail · " + String(failedWhatsapp) + " WhatsApp fehlgeschlagen.",
      href: "/system",
    });
  }
  if (supplyConfig.enabled && callReadyPool < Math.max(10, Math.ceil(Math.max(1, supplyConfig.assigneeIds.length) * supplyConfig.queueTarget * 0.25))) {
    alerts.push({
      tone: "warn",
      title: "Call-ready Vorrat wird knapp",
      detail: "Nur " + String(callReadyPool) + " validierte Kandidaten im Lead Scout verfügbar.",
      href: "/dashboard/research",
    });
  }
  if (!alerts.length) {
    alerts.push({
      tone: "good",
      title: "Keine akuten Blocker erkannt",
      detail: "Queues, Aufgaben und Technik zeigen aktuell keinen dringenden Eingriff.",
      href: "/dashboard/queue",
    });
  }

  return {
    range: args.range,
    canViewTeam,
    generatedAt: new Date().toISOString(),
    todayStartedAt: dayStart.toISOString(),
    totals: {
      ...totals,
      contactRate: totals.completedCalls ? Math.round(totals.connected / totals.completedCalls * 100) : 0,
      bookingRate: totals.connected ? Math.round(totals.directBooked / totals.connected * 100) : 0,
    },
    people,
    alerts: alerts.slice(0, 8),
    system: {
      failedJobs,
      failedOutreach,
      failedWhatsapp,
      techErrors,
      callReadyPool,
      researchEnabled: researchConfig.enabled,
      researchLastRun: researchRun?.finishedAt || null,
      supplyEnabled: supplyConfig.enabled,
      supplyTarget: supplyConfig.queueTarget,
      supplySelectedCallers: supplyConfig.assigneeIds.length,
      supplyLastRun: supplyRun?.finishedAt || null,
    },
  };
}
