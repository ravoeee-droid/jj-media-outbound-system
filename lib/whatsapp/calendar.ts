import { createHash } from "node:crypto";
import { and, eq, gt, inArray, lt } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts, bookings, leads, whatsappReservations, whatsappThreads, type Lead } from "@/db/schema";
import { getGoogleAccessToken } from "@/lib/google";
import { getAgentConfig, withLease } from "./config";
import { effectiveMode, isSuppressed, type AgentConfig, type CalendarSlot } from "./policy";

const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const FREEBUSY_SCOPE = "https://www.googleapis.com/auth/calendar.freebusy";

export async function calendarConnected(userId: string) {
  const [account] = await getDb().select({ scope: accounts.scope }).from(accounts).where(and(eq(accounts.userId, userId), eq(accounts.provider, "google"))).limit(1);
  return Boolean(account?.scope?.includes(CALENDAR_SCOPE) && account?.scope?.includes(FREEBUSY_SCOPE));
}

async function calendarRequest(userId: string, path: string, body?: unknown, method?: string) {
  if (!await calendarConnected(userId)) throw new Error("Google Kalender ist noch nicht für Verfügbarkeit und Buchung verbunden.");
  const token = await getGoogleAccessToken(userId);
  return fetch(`https://www.googleapis.com/calendar/v3/${path}`, {
    method: method ?? (body ? "POST" : "GET"),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}),
    cache: "no-store", signal: AbortSignal.timeout(15_000),
  });
}

type Busy = { start: string; end: string };
async function busyPeriods(userId: string, workspaceId: string, config: AgentConfig, start: Date, end: Date): Promise<Busy[]> {
  const response = await calendarRequest(userId, "freeBusy", { timeMin: start.toISOString(), timeMax: end.toISOString(), timeZone: config.timezone, items: [{ id: config.calendarId }] });
  if (!response.ok) throw new Error("Der Kalender konnte nicht geprüft werden. Es werden keine freien Zeiten angenommen.");
  const data = await response.json() as { calendars?: Record<string, { busy?: Busy[]; errors?: unknown[] }> };
  const result = data.calendars?.[config.calendarId];
  if (!result || result.errors?.length || !Array.isArray(result.busy)) throw new Error("Für diesen Kalender sind keine verlässlichen Verfügbarkeiten abrufbar.");
  const reserved = await getDb().select().from(whatsappReservations).where(and(
    eq(whatsappReservations.workspaceId, workspaceId), eq(whatsappReservations.calendarId, config.calendarId),
    inArray(whatsappReservations.status, ["reserved", "unknown", "confirmed"]),
    lt(whatsappReservations.startAt, end), gt(whatsappReservations.endAt, start),
  ));
  return [...result.busy, ...reserved.map((r) => ({ start: r.startAt.toISOString(), end: r.endAt.toISOString() }))];
}

export function localClock(date: Date, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, weekday: ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].indexOf(parts.weekday) + 1, hour: Number(parts.hour), minute: Number(parts.minute) };
}

export async function availableSlots(userId: string, workspaceId: string, config: AgentConfig): Promise<CalendarSlot[]> {
  if (!config.allowBooking) throw new Error("Die automatische Terminierung ist in den KI-Regeln noch deaktiviert.");
  const start = new Date(Math.ceil((Date.now() + config.noticeHours * 3_600_000) / 900_000) * 900_000);
  const end = new Date(start.getTime() + 14 * 86_400_000);
  const busy = await busyPeriods(userId, workspaceId, config, start, end);
  const slots: CalendarSlot[] = [];
  const duration = config.durationMinutes * 60_000;
  const buffer = config.bufferMinutes * 60_000;
  for (let t = start.getTime(); t < end.getTime() && slots.length < 3; t += 900_000) {
    const date = new Date(t);
    const clock = localClock(date, config.timezone);
    const minutes = clock.hour * 60 + clock.minute;
    if (!config.weekdays.includes(clock.weekday) || minutes < config.startHour * 60 || minutes + config.durationMinutes > config.endHour * 60) continue;
    if (busy.some((item) => t - buffer < Date.parse(item.end) && t + duration + buffer > Date.parse(item.start))) continue;
    // Offer meaningfully different times, not three adjacent slots.
    if (slots.some((s) => Math.abs(t - Date.parse(s.start)) < 90 * 60_000)) continue;
    slots.push({
      id: createHash("sha256").update(`${config.calendarId}:${t}`).digest("hex").slice(0, 32),
      start: date.toISOString(), end: new Date(t + duration).toISOString(),
      label: new Intl.DateTimeFormat("de-DE", { timeZone: config.timezone, weekday: "short", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(date),
      expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
      configVersion: config.version, calendarId: config.calendarId,
    });
  }
  return slots;
}

export async function bookSlot(args: { userId: string; workspaceId: string; threadId: string; lead: Lead; config: AgentConfig; slot: CalendarSlot; expectedVersion: number; automatic?: boolean }) {
  if (!args.config.allowBooking) throw new Error("Automatische Terminierung ist deaktiviert.");
  const { userId, workspaceId, threadId, lead, config, slot } = args;
  return withLease(workspaceId, `calendar:${config.calendarId}`, async () => {
    const db = getDb();
    async function verifyCurrentPermission() {
      const currentConfig = await getAgentConfig(workspaceId);
      const [current] = await db.select({ thread: whatsappThreads, lead: leads }).from(whatsappThreads).innerJoin(leads, and(eq(leads.id, whatsappThreads.leadId), eq(leads.workspaceId, whatsappThreads.workspaceId))).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, threadId))).limit(1);
      if (!current || current.thread.version !== args.expectedVersion || current.thread.consent !== "granted" || current.thread.status === "closed" || isSuppressed(current.lead.tags) || current.lead.pipelineStage === "lost") throw new Error("Die Unterhaltung wurde geändert oder gestoppt. Bitte vor der Buchung prüfen.");
      if (!currentConfig.allowBooking || currentConfig.version !== config.version || slot.configVersion !== config.version || slot.calendarId !== config.calendarId) throw new Error("Die Terminregeln wurden geändert. Bitte neue Zeiten abrufen.");
      if (args.automatic && (effectiveMode(currentConfig, current.thread.mode) !== "autopilot" || current.thread.status !== "open")) throw new Error("Die automatische Terminierung wurde angehalten.");
    }
    await verifyCurrentPermission();
    const eventId = `jj${createHash("sha256").update(`${workspaceId}:${threadId}:${config.calendarId}:${slot.start}`).digest("hex").slice(0, 40)}`;
    const [existing] = await db.select().from(whatsappReservations).where(and(eq(whatsappReservations.workspaceId, workspaceId), eq(whatsappReservations.eventId, eventId))).limit(1);
    let event: { id?: string; status?: string; hangoutLink?: string; start?: { dateTime?: string }; end?: { dateTime?: string } } | undefined;
    const path = `calendars/${encodeURIComponent(config.calendarId)}/events`;
    if (existing) {
      const check = await calendarRequest(userId, `${path}/${eventId}`);
      if (check.ok) event = await check.json();
      else if (check.status !== 404) throw new Error("Der bestehende Terminstatus konnte nicht sicher geprüft werden.");
    }
    if (!event) {
      if (Date.parse(slot.expiresAt) <= Date.now() || Date.parse(slot.start) < Date.now() + config.noticeHours * 3_600_000) throw new Error("Dieser Terminvorschlag ist abgelaufen. Bitte neue Zeiten abrufen.");
      if (existing) {
        await db.update(whatsappReservations).set({ status: "retrying", updatedAt: new Date() }).where(eq(whatsappReservations.id, existing.id));
      }
      const busy = await busyPeriods(userId, workspaceId, config, new Date(Date.parse(slot.start) - config.bufferMinutes * 60_000), new Date(Date.parse(slot.end) + config.bufferMinutes * 60_000));
      if (busy.length) throw new Error("Der Termin ist inzwischen belegt. Bitte einen anderen Vorschlag auswählen.");
      await verifyCurrentPermission();
      await db.insert(whatsappReservations).values({ workspaceId, threadId, calendarId: config.calendarId, eventId, startAt: new Date(slot.start), endAt: new Date(slot.end), status: "reserved" }).onConflictDoUpdate({ target: [whatsappReservations.workspaceId, whatsappReservations.eventId], set: { status: "reserved", updatedAt: new Date() } });
      try {
        const response = await calendarRequest(userId, `${path}?conferenceDataVersion=1&sendUpdates=none`, {
          id: eventId,
          summary: `JJ-Media Potenzialgespräch · ${lead.company}`,
          description: `Kontakt: ${lead.contact || lead.company}\nTelefon: ${lead.phone}\nE-Mail: ${lead.email}\nAnliegen: ${lead.summary.slice(0, 1_000)}`,
          start: { dateTime: slot.start, timeZone: config.timezone }, end: { dateTime: slot.end, timeZone: config.timezone },
          conferenceData: { createRequest: { requestId: eventId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
          extendedProperties: { private: { jjThreadId: threadId } },
        });
        if (response.status === 409) {
          const check = await calendarRequest(userId, `${path}/${eventId}`);
          if (check.ok) event = await check.json();
        } else if (response.ok) event = await response.json();
        if (!event?.id) throw new Error("Google hat die Terminbuchung nicht eindeutig bestätigt.");
      } catch (error) {
        await db.update(whatsappReservations).set({ status: "unknown", updatedAt: new Date() }).where(and(eq(whatsappReservations.workspaceId, workspaceId), eq(whatsappReservations.eventId, eventId)));
        throw error;
      }
    }
    if (event?.status === "cancelled" || Date.parse(event?.start?.dateTime ?? "") !== Date.parse(slot.start) || Date.parse(event?.end?.dateTime ?? "") !== Date.parse(slot.end)) throw new Error("Der Kalendertermin stimmt nicht mit der ausgewählten Zeit überein. Bitte persönlich prüfen.");
    await db.update(whatsappReservations).set({ status: "confirmed", joinUrl: event?.hangoutLink ?? "", updatedAt: new Date() }).where(and(eq(whatsappReservations.workspaceId, workspaceId), eq(whatsappReservations.eventId, eventId)));
    const [record] = await db.select().from(bookings).where(and(eq(bookings.leadId, lead.id), eq(bookings.externalId, eventId))).limit(1);
    if (!record) await db.insert(bookings).values({ leadId: lead.id, scheduledAt: new Date(slot.start), provider: "google_whatsapp", externalId: eventId, status: "confirmed" });
    await db.update(leads).set({ pipelineStage: "call_booked", probability: Math.max(lead.probability, 60), lastActivityAt: new Date(), updatedAt: new Date() }).where(and(eq(leads.id, lead.id), eq(leads.workspaceId, workspaceId)));
    await db.update(whatsappThreads).set({ status: "booked", intent: "booking", offeredSlots: [], operatorSlots: [], updatedAt: new Date() }).where(and(eq(whatsappThreads.id, threadId), eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.version, args.expectedVersion), eq(whatsappThreads.consent, "granted")));
    return { eventId, start: slot.start, label: slot.label, joinUrl: event?.hangoutLink ?? "" };
  });
}
