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
import { getDailyQueue } from "@/lib/daily-queue";
import { getLeadSupplyConfig, getLeadSupplyLastRun } from "@/lib/lead-supply";
import { getResearchFeedConfig, getResearchFeedLastRun } from "@/lib/research-feed";
import { hasPermission, normalizedPermissions, normalizedRole } from "@/lib/team";

export type ManagerRange = 1 | 7 | 30;

const CALL_TYPES = [
  "call_no_answer",
  "call_info_requested",
  "call_whatsapp_requested",
  "callback_scheduled",
  "meeting_scheduled",
  "calendar",
  "no_interest",
] as const;

const CONNECTED_TYPES = [
  "call_info_requested",
  "call_whatsapp_requested",
  "callback_scheduled",
  "meeting_scheduled",
  "calendar",
  "no_interest",
] as const;

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
  const noon = new Date(Date.UTC(year, month - 1, day, 12));
  const offset = offsetMinutes(timeZone, noon);
  return new Date(Date.UTC(year, month - 1, day, 0) - offset * 60_000);
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
    if (row.status !== "active" || unique.has(row.userId)) continue;
    const role = normalizedRole(row.role);
    unique.set(row.userId, {
      userId: row.userId,
      name: row.name || row.email || "Mitarbeiter",
      email: row.email || "",
      role,
      permissions: normalizedPermissions(role, row.permissions),
      calendarConnected: Boolean(
        row.googleScope?.includes("https://www.googleapis.com/auth/calendar.events")
        && row.googleScope?.includes("https://www.googleapis.com/auth/calendar.freebusy"),
      ),
    });
  }
  return [...unique.values()];
}

function countTypes(bucket: Map<string, number>, types: readonly string[]) {
  return types.reduce((sum, type) => sum + (bucket.get(type) || 0), 0);
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
    leadRows,
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
    db.select({ userId: activities.userId, leadId: activities.leadId, type: activities.type })
      .from(activities)
      .where(and(
        eq(activities.workspaceId, args.workspaceId),
        gte(activities.createdAt, start),
        inArray(activities.type, [...CALL_TYPES]),
      )),
    db.select({ id: leads.id, ownerId: leads.ownerId })
      .from(leads)
      .where(eq(leads.workspaceId, args.workspaceId)),
    db.select({ leadId: outreach.leadId, step: outreach.step })
      .from(outreach)
      .where(and(
        eq(outreach.workspaceId, args.workspaceId),
        eq(outreach.status, "sent"),
        isNotNull(outreach.sentAt),
        gte(outreach.sentAt, start),
      )),
    db.select({ leadId: bookings.leadId })
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
    db.select({ leadId: whatsappThreads.leadId })
      .from(whatsappMessages)
      .innerJoin(whatsappThreads, eq(whatsappThreads.id, whatsappMessages.threadId))
      .where(and(
        eq(whatsappMessages.workspaceId, args.workspaceId),
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

  const ownerByLead = new Map(leadRows.map((lead) => [lead.id, lead.ownerId || ""]));
  const activityByUser = new Map<string, Map<string, number>>();
  for (const row of activityRows) {
    const ownerId = ownerByLead.get(row.leadId) || row.userId || "";
    if (!ownerId) continue;
    const bucket = activityByUser.get(ownerId) || new Map<string, number>();
    bucket.set(row.type, (bucket.get(row.type) || 0) + 1);
    activityByUser.set(ownerId, bucket);
  }

  const channelByOwner = new Map<string, { infoSent: number; followupsSent: number; whatsappSent: number; booked: number }>();
  function ownerBucket(ownerId: string) {
    const current = channelByOwner.get(ownerId) || { infoSent: 0, followupsSent: 0, whatsappSent: 0, booked: 0 };
    channelByOwner.set(ownerId, current);
    return current;
  }
  for (const row of outreachRows) {
    const ownerId = ownerByLead.get(row.leadId) || "";
    if (!ownerId) continue;
    const bucket = ownerBucket(ownerId);
    if (row.step === 1) bucket.infoSent += 1;
    else bucket.followupsSent += 1;
  }
  for (const row of whatsappRows) {
    const ownerId = ownerByLead.get(row.leadId) || "";
    if (ownerId) ownerBucket(ownerId).whatsappSent += 1;
  }
  for (const row of bookingRows) {
    const ownerId = ownerByLead.get(row.leadId) || "";
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

  const queueEntries = await Promise.all(members.map(async (member) => ({
    userId: member.userId,
    value: await getDailyQueue(args.workspaceId, member.userId, 1),
  })));
  const queueByUser = new Map(queueEntries.map((entry) => [entry.userId, entry.value.stats]));

  const people = members.map((member) => {
    const events = activityByUser.get(member.userId) || new Map<string, number>();
    const channels = channelByOwner.get(member.userId) || { infoSent: 0, followupsSent: 0, whatsappSent: 0, booked: 0 };
    const task = tasksByUser.get(member.userId) || { open: 0, overdue: 0 };
    const queue = queueByUser.get(member.userId) || { total: 0, callbacks: 0, highPriority: 0 };
    const calls = countTypes(events, CALL_TYPES);
    const connected = countTypes(events, CONNECTED_TYPES);

    return {
      userId: member.userId,
      name: member.name,
      email: member.email,
      role: member.role,
      calendarConnected: member.calendarConnected,
      calls,
      connected,
      noAnswer: events.get("call_no_answer") || 0,
      infoRequested: events.get("call_info_requested") || 0,
      infoSent: channels.infoSent,
      followupsSent: channels.followupsSent,
      whatsappRequested: events.get("call_whatsapp_requested") || 0,
      whatsappSent: channels.whatsappSent,
      booked: channels.booked,
      queue: queue.total,
      callbacks: queue.callbacks,
      highPriority: queue.highPriority,
      openTasks: task.open,
      overdueTasks: task.overdue,
      contactRate: calls ? Math.round(connected / calls * 100) : 0,
      bookingRate: connected ? Math.round(channels.booked / connected * 100) : 0,
    };
  });

  const totals = people.reduce((acc, person) => {
    acc.calls += person.calls;
    acc.connected += person.connected;
    acc.noAnswer += person.noAnswer;
    acc.infoRequested += person.infoRequested;
    acc.infoSent += person.infoSent;
    acc.whatsappRequested += person.whatsappRequested;
    acc.whatsappSent += person.whatsappSent;
    acc.booked += person.booked;
    acc.queue += person.queue;
    acc.openTasks += person.openTasks;
    acc.overdueTasks += person.overdueTasks;
    return acc;
  }, {
    calls: 0,
    connected: 0,
    noAnswer: 0,
    infoRequested: 0,
    infoSent: 0,
    whatsappRequested: 0,
    whatsappSent: 0,
    booked: 0,
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
    } else if (person.queue < 5 && ["owner", "admin", "sales", "setter"].includes(person.role)) {
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
      contactRate: totals.calls ? Math.round(totals.connected / totals.calls * 100) : 0,
      bookingRate: totals.connected ? Math.round(totals.booked / totals.connected * 100) : 0,
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
