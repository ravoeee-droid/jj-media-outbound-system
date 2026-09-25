import { createHash } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { getDb } from "@/db";
import { activities, bookings, leads, settings, tasks, users } from "@/db/schema";
import { getGoogleAccessToken } from "@/lib/google";
import { cancelPendingEmailFollowups } from "@/lib/outreach-lifecycle";
import { calendarConnected } from "@/lib/whatsapp/calendar";
import { withLease } from "@/lib/whatsapp/config";

export const calendarProfileSchema = z.object({
  calendarId: z.string().trim().min(1).max(250).default("primary"),
  timezone: z.string().trim().min(1).max(100).default("Europe/Berlin"),
  durationMinutes: z.number().int().min(15).max(120).default(30),
  noticeHours: z.number().int().min(0).max(168).default(2),
  startHour: z.number().int().min(0).max(22).default(9),
  endHour: z.number().int().min(1).max(24).default(18),
  bufferMinutes: z.number().int().min(0).max(120).default(15),
  weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7).default([1, 2, 3, 4, 5]),
}).refine((value) => value.endHour > value.startHour, { message: "Endzeit muss nach der Startzeit liegen." });

export type CalendarProfile = z.infer<typeof calendarProfileSchema>;

export type MeetingSlot = {
  id: string;
  start: string;
  end: string;
  label: string;
  dayLabel: string;
};

const DEFAULT_PROFILE: CalendarProfile = {
  calendarId: "primary",
  timezone: "Europe/Berlin",
  durationMinutes: 30,
  noticeHours: 2,
  startHour: 9,
  endHour: 18,
  bufferMinutes: 15,
  weekdays: [1, 2, 3, 4, 5],
};

function profileKey(userId: string) {
  return "calendar_profile:" + userId;
}

export async function getCalendarProfile(workspaceId: string, userId: string): Promise<CalendarProfile> {
  const [row] = await getDb()
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, profileKey(userId))))
    .limit(1);
  if (!row) return structuredClone(DEFAULT_PROFILE);
  try {
    return calendarProfileSchema.parse(JSON.parse(row.value));
  } catch {
    return structuredClone(DEFAULT_PROFILE);
  }
}

export async function saveCalendarProfile(workspaceId: string, userId: string, input: unknown) {
  const profile = calendarProfileSchema.parse(input);
  await getDb().insert(settings).values({
    workspaceId,
    key: profileKey(userId),
    value: JSON.stringify(profile),
  }).onConflictDoUpdate({
    target: [settings.workspaceId, settings.key],
    set: { value: JSON.stringify(profile), updatedAt: new Date() },
  });
  return profile;
}

export async function getCalendarOwner(userId: string) {
  const [user] = await getDb()
    .select({ id: users.id, name: users.name, email: users.email, status: users.status })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);
  return user || null;
}

type Busy = { start: string; end: string };

async function calendarFetch(userId: string, path: string, init: RequestInit = {}) {
  const token = await getGoogleAccessToken(userId);
  const response = await fetch("https://www.googleapis.com/calendar/v3/" + path, {
    ...init,
    headers: {
      authorization: "Bearer " + token,
      "content-type": "application/json",
      ...(init.headers || {}),
    },
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15_000),
  });
  return response;
}

async function busyPeriods(userId: string, profile: CalendarProfile, start: Date, end: Date): Promise<Busy[]> {
  const response = await calendarFetch(userId, "freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      timeZone: profile.timezone,
      items: [{ id: profile.calendarId }],
    }),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Kalender-Verfügbarkeit konnte nicht geprüft werden (" + response.status + "): " + detail.slice(0, 180));
  }
  const payload = await response.json() as { calendars?: Record<string, { busy?: Busy[]; errors?: unknown[] }> };
  const calendar = payload.calendars?.[profile.calendarId];
  if (!calendar || calendar.errors?.length || !Array.isArray(calendar.busy)) {
    throw new Error("Für diesen Kalender sind keine verlässlichen freien Zeiten abrufbar.");
  }
  return calendar.busy;
}

function localClock(date: Date, timeZone: string) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    }).formatToParts(date).map((part) => [part.type, part.value]),
  );
  return {
    day: String(parts.year) + "-" + String(parts.month) + "-" + String(parts.day),
    weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(String(parts.weekday)) + 1,
    hour: Number(parts.hour),
    minute: Number(parts.minute),
  };
}

function withinWorkingHours(start: Date, profile: CalendarProfile) {
  const clock = localClock(start, profile.timezone);
  const minutes = clock.hour * 60 + clock.minute;
  return profile.weekdays.includes(clock.weekday)
    && minutes >= profile.startHour * 60
    && minutes + profile.durationMinutes <= profile.endHour * 60;
}

function slotId(userId: string, profile: CalendarProfile, start: string) {
  return createHash("sha256")
    .update([userId, profile.calendarId, profile.timezone, profile.durationMinutes, start].join(":"))
    .digest("hex")
    .slice(0, 24);
}

function slotLabels(start: Date, profile: CalendarProfile) {
  const label = new Intl.DateTimeFormat("de-DE", {
    timeZone: profile.timezone,
    weekday: "short",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(start);
  const dayLabel = new Intl.DateTimeFormat("de-DE", {
    timeZone: profile.timezone,
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
  }).format(start);
  return { label, dayLabel };
}

export async function listMeetingSlots(args: {
  workspaceId: string;
  userId: string;
  limit?: number;
  days?: number;
}) {
  if (!await calendarConnected(args.userId)) {
    return { connected: false as const, profile: await getCalendarProfile(args.workspaceId, args.userId), slots: [] as MeetingSlot[] };
  }

  const profile = await getCalendarProfile(args.workspaceId, args.userId);
  const limit = Math.max(1, Math.min(args.limit || 9, 18));
  const days = Math.max(1, Math.min(args.days || 14, 30));
  const noticeMs = profile.noticeHours * 3_600_000;
  const start = new Date(Math.ceil((Date.now() + noticeMs) / 900_000) * 900_000);
  const end = new Date(start.getTime() + days * 86_400_000);
  const busy = await busyPeriods(args.userId, profile, start, end);

  const slots: MeetingSlot[] = [];
  const slotsPerDay = new Map<string, number>();
  const durationMs = profile.durationMinutes * 60_000;
  const bufferMs = profile.bufferMinutes * 60_000;

  for (let time = start.getTime(); time < end.getTime() && slots.length < limit; time += 15 * 60_000) {
    const candidate = new Date(time);
    if (!withinWorkingHours(candidate, profile)) continue;
    const clock = localClock(candidate, profile.timezone);
    if ((slotsPerDay.get(clock.day) || 0) >= 3) continue;
    if (busy.some((item) => time - bufferMs < Date.parse(item.end) && time + durationMs + bufferMs > Date.parse(item.start))) continue;
    if (slots.some((slot) => {
      const slotClock = localClock(new Date(slot.start), profile.timezone);
      return slotClock.day === clock.day && Math.abs(time - Date.parse(slot.start)) < 90 * 60_000;
    })) continue;
    const labels = slotLabels(candidate, profile);
    slots.push({
      id: slotId(args.userId, profile, candidate.toISOString()),
      start: candidate.toISOString(),
      end: new Date(time + durationMs).toISOString(),
      label: labels.label,
      dayLabel: labels.dayLabel,
    });
    slotsPerDay.set(clock.day, (slotsPerDay.get(clock.day) || 0) + 1);
  }

  return { connected: true as const, profile, slots };
}

function meetLink(event: { hangoutLink?: string; conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> } }) {
  return event.hangoutLink
    || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video" && entry.uri)?.uri
    || "";
}

async function getCalendarEvent(userId: string, profile: CalendarProfile, eventId: string) {
  const response = await calendarFetch(userId, "calendars/" + encodeURIComponent(profile.calendarId) + "/events/" + eventId);
  if (response.status === 404) return null;
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error("Kalendertermin konnte nicht geprüft werden (" + response.status + "): " + detail.slice(0, 180));
  }
  return response.json() as Promise<{
    id?: string;
    status?: string;
    hangoutLink?: string;
    start?: { dateTime?: string };
    end?: { dateTime?: string };
    conferenceData?: { entryPoints?: Array<{ entryPointType?: string; uri?: string }> };
  }>;
}

export async function bookMeetingSlot(args: {
  workspaceId: string;
  calendarUserId: string;
  actorUserId: string;
  leadId: string;
  start: string;
}) {
  if (!await calendarConnected(args.calendarUserId)) throw new Error("Der Google Kalender dieses Mitarbeiters ist noch nicht verbunden.");

  const db = getDb();
  const [lead] = await db
    .select()
    .from(leads)
    .where(and(eq(leads.workspaceId, args.workspaceId), eq(leads.id, args.leadId)))
    .limit(1);
  if (!lead) throw new Error("Lead nicht gefunden.");
  if (lead.contactLocked || lead.pipelineStage === "lost") throw new Error("Dieser Lead ist für weiteren Kontakt gesperrt.");

  const profile = await getCalendarProfile(args.workspaceId, args.calendarUserId);
  const startAt = new Date(args.start);
  if (Number.isNaN(startAt.getTime())) throw new Error("Ungültiger Termin.");
  if (startAt.getTime() < Date.now() + profile.noticeHours * 3_600_000 - 60_000) throw new Error("Dieser Termin liegt zu kurzfristig.");
  if (!withinWorkingHours(startAt, profile)) throw new Error("Dieser Termin liegt außerhalb der eingestellten Arbeitszeiten.");

  const endAt = new Date(startAt.getTime() + profile.durationMinutes * 60_000);
  const expectedSlotId = slotId(args.calendarUserId, profile, startAt.toISOString());
  const eventId = "jj" + createHash("sha256")
    .update([args.workspaceId, args.calendarUserId, lead.id, profile.calendarId, startAt.toISOString()].join(":"))
    .digest("hex")
    .slice(0, 40);

  return withLease(args.workspaceId, "meeting:" + args.calendarUserId + ":" + profile.calendarId, async () => {
    let event = await getCalendarEvent(args.calendarUserId, profile, eventId);
    if (!event) {
      const bufferMs = profile.bufferMinutes * 60_000;
      const busy = await busyPeriods(
        args.calendarUserId,
        profile,
        new Date(startAt.getTime() - bufferMs),
        new Date(endAt.getTime() + bufferMs),
      );
      if (busy.length) throw new Error("Dieser Termin ist inzwischen belegt. Bitte einen anderen freien Slot auswählen.");

      const attendeeEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email) ? lead.email : "";
      const path = "calendars/" + encodeURIComponent(profile.calendarId) + "/events?conferenceDataVersion=1&sendUpdates=" + (attendeeEmail ? "all" : "none");
      const response = await calendarFetch(args.calendarUserId, path, {
        method: "POST",
        body: JSON.stringify({
          id: eventId,
          summary: "JJ-Media Potenzialgespräch · " + lead.company,
          description: [
            "Unternehmen: " + lead.company,
            "Kontakt: " + (lead.contact || lead.ceo || "offen"),
            "Telefon: " + (lead.phone || "offen"),
            "E-Mail: " + (lead.email || "offen"),
            lead.websiteUrl ? "Website: " + lead.websiteUrl : "",
            lead.summary ? "Kontext: " + lead.summary.slice(0, 1200) : "",
          ].filter(Boolean).join("\n"),
          start: { dateTime: startAt.toISOString(), timeZone: profile.timezone },
          end: { dateTime: endAt.toISOString(), timeZone: profile.timezone },
          ...(attendeeEmail ? { attendees: [{ email: attendeeEmail }] } : {}),
          conferenceData: {
            createRequest: {
              requestId: eventId,
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
          reminders: {
            useDefault: false,
            overrides: [
              { method: "email", minutes: 60 },
              { method: "popup", minutes: 10 },
            ],
          },
          extendedProperties: {
            private: {
              jjWorkspaceId: args.workspaceId,
              jjLeadId: lead.id,
              jjSlotId: expectedSlotId,
            },
          },
        }),
      });

      if (response.status === 409) {
        event = await getCalendarEvent(args.calendarUserId, profile, eventId);
      } else {
        if (!response.ok) {
          const detail = await response.text().catch(() => "");
          throw new Error("Google-Termin konnte nicht erstellt werden (" + response.status + "): " + detail.slice(0, 220));
        }
        event = await response.json();
      }
    }

    if (!event?.id || event.status === "cancelled") throw new Error("Google hat den Termin nicht eindeutig bestätigt.");

    let joinUrl = meetLink(event);
    if (!joinUrl) {
      for (const delay of [250, 650, 1200]) {
        await new Promise((resolve) => setTimeout(resolve, delay));
        const refreshed = await getCalendarEvent(args.calendarUserId, profile, eventId);
        if (!refreshed) break;
        event = refreshed;
        joinUrl = meetLink(refreshed);
        if (joinUrl) break;
      }
    }
    if (!joinUrl) throw new Error("Der Kalendertermin wurde angelegt, aber Google hat den Meet-Link noch nicht bestätigt. Bitte den Kalender prüfen; es wird kein zweiter Termin erstellt.");

    const [stored] = await db
      .select({ id: bookings.id })
      .from(bookings)
      .where(and(eq(bookings.leadId, lead.id), eq(bookings.externalId, eventId)))
      .limit(1);

    if (!stored) {
      await db.insert(bookings).values({
        leadId: lead.id,
        scheduledAt: startAt,
        provider: "google_calendar",
        externalId: eventId,
        status: "confirmed",
      });
    } else {
      await db.update(bookings)
        .set({ scheduledAt: startAt, provider: "google_calendar", status: "confirmed" })
        .where(eq(bookings.id, stored.id));
    }

    await Promise.all([
      db.update(leads).set({
        pipelineStage: "call_booked",
        callStatus: "completed",
        nextAction: "meeting",
        nextActionAt: startAt,
        nextFollowUpAt: null,
        probability: Math.max(lead.probability, 60),
        lastContactAt: new Date(),
        lastActivityAt: new Date(),
        updatedAt: new Date(),
      }).where(and(eq(leads.workspaceId, args.workspaceId), eq(leads.id, lead.id))),
      db.update(tasks).set({ status: "done", updatedAt: new Date() })
        .where(and(
          eq(tasks.workspaceId, args.workspaceId),
          eq(tasks.leadId, lead.id),
          inArray(tasks.type, ["callback", "send_info", "whatsapp_followup"]),
          eq(tasks.status, "open"),
        )),
      db.insert(activities).values({
        workspaceId: args.workspaceId,
        leadId: lead.id,
        userId: args.actorUserId,
        type: "calendar",
        title: "Google-Meet-Termin gebucht",
        detail: slotLabels(startAt, profile).label,
        metadata: {
          eventId,
          joinUrl,
          startAt: startAt.toISOString(),
          endAt: endAt.toISOString(),
          attendeeInvited: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email),
          calendarUserId: args.calendarUserId,
        },
      }),
    ]);

    await cancelPendingEmailFollowups({
      workspaceId: args.workspaceId,
      leadId: lead.id,
      reason: "Google-Meet-Termin wurde gebucht.",
      userId: args.actorUserId,
    });

    return {
      eventId,
      joinUrl,
      start: startAt.toISOString(),
      end: endAt.toISOString(),
      label: slotLabels(startAt, profile).label,
      attendeeInvited: /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(lead.email),
      profile,
    };
  });
}
