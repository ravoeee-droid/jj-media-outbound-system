"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import styles from "./DailyQueueWorkspace.module.css";

type QueueLead = {
  id: string;
  company: string;
  contact: string;
  ceo: string;
  phone: string;
  email: string;
  instagramUrl: string;
  websiteUrl: string;
  city: string;
  region: string;
  summary: string;
  pitch: string;
  recommendedOffer: string;
  notes: string;
  pipelineStage: string;
  callStatus: string;
  emailStatus: string;
  whatsappStatus: string;
  nextAction: string;
  nextActionAt: string | null;
  salesPriority: number;
  confidence: number;
  ownerId: string | null;
  createdAt: string;
};

type QueuePayload = {
  leads: QueueLead[];
  stats: { total: number; callbacks: number; highPriority: number };
  ownerId: string;
  currentUser: { id: string; name: string | null; email: string | null };
  permissions: {
    canViewAll: boolean;
    canSendEmail: boolean;
    canUseWhatsapp: boolean;
    canBookMeetings: boolean;
  };
  members: Array<{ userId: string; name: string; role: string }>;
  error?: string;
};

type ScheduleMode = "callback" | "meeting" | null;

function toLocalInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultFuture(hours: number) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(date);
}

function displayTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function phoneHref(phone: string) {
  return "tel:" + phone.replace(/[^+\d]/g, "");
}

export default function DailyQueueWorkspace() {
  const [data, setData] = useState<QueuePayload | null>(null);
  const [ownerId, setOwnerId] = useState("mine");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [callStarted, setCallStarted] = useState(false);
  const [scheduleMode, setScheduleMode] = useState<ScheduleMode>(null);
  const [scheduleValue, setScheduleValue] = useState(defaultFuture(2));
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async (selectedOwner = ownerId, silent = false) => {
    if (!silent) setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/daily-queue?owner=" + encodeURIComponent(selectedOwner), { cache: "no-store" });
      const payload = await response.json() as QueuePayload;
      if (!response.ok) throw new Error(payload.error || "Tages-Queue konnte nicht geladen werden.");
      setData(payload);
      if (selectedOwner === "mine") setOwnerId(payload.ownerId);
      setCallStarted(false);
      setScheduleMode(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Tages-Queue konnte nicht geladen werden.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [ownerId]);

  useEffect(() => {
    void load("mine");
  }, []);

  const current = data?.leads[0] || null;
  const upcoming = useMemo(() => (data?.leads || []).slice(1, 6), [data]);

  function switchOwner(value: string) {
    setOwnerId(value);
    setMessage("");
    setCallStarted(false);
    setScheduleMode(null);
    void load(value);
  }

  function startCall() {
    if (!current?.phone || busy) return;
    setCallStarted(true);
    window.location.href = phoneHref(current.phone);
  }

  async function submitSimple(action: "no_answer" | "info_requested" | "whatsapp_requested" | "no_interest") {
    if (!current || busy) return;
    if (action === "info_requested" && !current.email) {
      setError("Für „Info gewünscht“ fehlt noch die E-Mail-Adresse. Bitte zuerst in der Lead-Akte ergänzen.");
      return;
    }
    if (action === "whatsapp_requested" && !data?.permissions.canUseWhatsapp) {
      setError("Für diesen Zugang ist WhatsApp nicht freigegeben.");
      return;
    }

    setBusy(action);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/daily-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, leadId: current.id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Call-Ergebnis konnte nicht gespeichert werden.");

      const success =
        action === "no_answer" ? "Nicht erreicht gespeichert. Der Lead ist für heute erledigt."
        : action === "info_requested" ? "Info gewünscht gespeichert. Nächster Schritt: Info-Mail."
        : action === "whatsapp_requested" ? "WhatsApp gewünscht gespeichert."
        : "Kein Interesse gespeichert. Weiterer Kontakt ist gesperrt.";
      setMessage(success);
      await load(ownerId, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Call-Ergebnis konnte nicht gespeichert werden.");
    } finally {
      setBusy("");
    }
  }

  async function submitSchedule(event: FormEvent) {
    event.preventDefault();
    if (!current || !scheduleMode || !scheduleValue || busy) return;
    const date = new Date(scheduleValue);
    if (Number.isNaN(date.getTime())) {
      setError("Bitte Datum und Uhrzeit prüfen.");
      return;
    }

    setBusy(scheduleMode);
    setError("");
    setMessage("");
    try {
      const body = scheduleMode === "callback"
        ? { action: "callback", leadId: current.id, dueAt: date.toISOString() }
        : { action: "meeting", leadId: current.id, scheduledAt: date.toISOString() };
      const response = await fetch("/api/daily-queue", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Zeitpunkt konnte nicht gespeichert werden.");
      setMessage(scheduleMode === "callback" ? "Rückruf ist eingeplant." : "Termin ist im CRM eingetragen.");
      await load(ownerId, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Zeitpunkt konnte nicht gespeichert werden.");
    } finally {
      setBusy("");
    }
  }

  async function openWhatsapp() {
    if (!current || busy || !data?.permissions.canUseWhatsapp) return;
    setBusy("open-whatsapp");
    setError("");
    try {
      const response = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "open", leadId: current.id, phone: current.phone }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "WhatsApp konnte nicht geöffnet werden.");
      window.location.assign("/dashboard/whatsapp?lead=" + current.id);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "WhatsApp konnte nicht geöffnet werden.");
      setBusy("");
    }
  }

  if (loading) {
    return <div className={styles.loading}><i /><span>Tages-Queue wird vorbereitet …</span></div>;
  }

  return (
    <div className={styles.root}>
      <section className={styles.topline}>
        <div className={styles.stats}>
          <div><small>OFFEN</small><strong>{data?.stats.total || 0}</strong><span>Calls in dieser Queue</span></div>
          <div><small>FÄLLIGE RÜCKRUFE</small><strong>{data?.stats.callbacks || 0}</strong><span>kommen immer zuerst</span></div>
          <div><small>PRIORITÄT 75+</small><strong>{data?.stats.highPriority || 0}</strong><span>starke Leads</span></div>
        </div>
        {data?.permissions.canViewAll && (
          <label className={styles.ownerSelect}>
            <span>Queue von</span>
            <select value={ownerId} onChange={(event) => switchOwner(event.target.value)}>
              <option value={data.currentUser.id}>Meine Queue · {data.currentUser.name || data.currentUser.email}</option>
              {data.members.filter((member) => member.userId !== data.currentUser.id).map((member) => (
                <option key={member.userId} value={member.userId}>{member.name}</option>
              ))}
            </select>
          </label>
        )}
      </section>

      {!current ? (
        <section className={styles.done}>
          <span>✓</span>
          <h2>Queue erledigt.</h2>
          <p>Aktuell ist kein kontaktbereiter Lead oder fälliger Rückruf offen.</p>
          <div>
            <a href="/dashboard/intake">Neue Leads in den Intake</a>
            <a href="/dashboard/research">Recherche-Feed öffnen</a>
          </div>
        </section>
      ) : (
        <div className={styles.layout}>
          <section className={styles.leadCard}>
            <header className={styles.leadHead}>
              <div>
                <small>{current.nextAction === "callback" ? "FÄLLIGER RÜCKRUF" : "NÄCHSTER LEAD"}</small>
                <h2>{current.company}</h2>
                <p>{[current.contact || current.ceo, current.city, current.region].filter(Boolean).join(" · ") || "Kontaktdaten geprüft"}</p>
              </div>
              <div className={styles.priority}>
                <span>Priorität</span>
                <strong>{current.salesPriority}</strong>
              </div>
            </header>

            {current.nextAction === "callback" && current.nextActionAt && (
              <div className={styles.callbackBanner}>↺ Rückruf fällig seit {displayTime(current.nextActionAt)}</div>
            )}

            <div className={styles.context}>
              <article>
                <small>WARUM ANRUFEN?</small>
                <p>{current.summary || current.pitch || current.recommendedOffer || "Kontaktbereit und für den nächsten Vertriebs-Schritt priorisiert."}</p>
              </article>
              <article>
                <small>ANGEBOT / PITCH</small>
                <p>{current.pitch || current.recommendedOffer || "Noch kein individueller Pitch hinterlegt. Kurz Situation und Bedarf qualifizieren."}</p>
              </article>
            </div>

            <div className={styles.contactLine}>
              <div><span>Telefon</span><strong>{current.phone}</strong></div>
              <div><span>E-Mail</span><strong>{current.email || "noch nicht vorhanden"}</strong></div>
            </div>

            <div className={styles.links}>
              {current.websiteUrl && <a href={current.websiteUrl} target="_blank" rel="noreferrer">Website ↗</a>}
              {current.instagramUrl && <a href={current.instagramUrl} target="_blank" rel="noreferrer">Instagram ↗</a>}
              <a href="/dashboard/crm">CRM öffnen ↗</a>
            </div>

            <button type="button" className={styles.callButton} onClick={startCall} disabled={Boolean(busy)}>
              <span>☎</span>
              <div><strong>{callStarted ? "Anruf läuft / Ergebnis eintragen" : "Jetzt anrufen"}</strong><small>{current.phone}</small></div>
              <b>→</b>
            </button>

            <section className={styles.outcomes} data-ready={callStarted ? "yes" : "no"}>
              <div className={styles.outcomeHead}>
                <div><small>CALL-ERGEBNIS</small><h3>Was ist passiert?</h3></div>
                {!callStarted && <span>Wird nach „Anrufen“ aktiv</span>}
              </div>
              <div className={styles.outcomeGrid}>
                <button disabled={!callStarted || Boolean(busy)} onClick={() => void submitSimple("no_answer")}><span>○</span><strong>Nicht erreicht</strong><small>morgen erneut</small></button>
                <button disabled={!callStarted || Boolean(busy) || !current.email} onClick={() => void submitSimple("info_requested")}><span>✉</span><strong>Info gewünscht</strong><small>{current.email ? "Mail als nächstes" : "E-Mail fehlt"}</small></button>
                <button disabled={!callStarted || Boolean(busy) || !data?.permissions.canUseWhatsapp} onClick={() => void submitSimple("whatsapp_requested")}><span>◉</span><strong>WhatsApp</strong><small>Kontakt wünscht WA</small></button>
                <button disabled={!callStarted || Boolean(busy)} onClick={() => { setScheduleMode("callback"); setScheduleValue(defaultFuture(2)); }}><span>↺</span><strong>Rückruf</strong><small>Zeit festlegen</small></button>
                <button disabled={!callStarted || Boolean(busy) || !data?.permissions.canBookMeetings} onClick={() => { setScheduleMode("meeting"); setScheduleValue(defaultFuture(24)); }}><span>◷</span><strong>Termin</strong><small>Datum eintragen</small></button>
                <button className={styles.danger} disabled={!callStarted || Boolean(busy)} onClick={() => void submitSimple("no_interest")}><span>×</span><strong>Kein Interesse</strong><small>Kontakt stoppen</small></button>
              </div>
            </section>

            {scheduleMode && (
              <form className={styles.schedule} onSubmit={submitSchedule}>
                <div>
                  <strong>{scheduleMode === "callback" ? "Wann zurückrufen?" : "Wann ist der Termin?"}</strong>
                  <small>{scheduleMode === "callback" ? "Bis dahin verschwindet der Lead automatisch aus der Queue." : "Termin wird direkt in der Lead-Akte dokumentiert."}</small>
                </div>
                <input type="datetime-local" value={scheduleValue} onChange={(event) => setScheduleValue(event.target.value)} required />
                <button type="submit" disabled={Boolean(busy)}>{busy === scheduleMode ? "Speichert …" : "Speichern"}</button>
                <button type="button" onClick={() => setScheduleMode(null)}>Abbrechen</button>
              </form>
            )}
          </section>

          <aside className={styles.upcoming}>
            <div className={styles.upcomingHead}>
              <small>DANACH</small>
              <h3>Die nächsten Leads</h3>
              <span>Automatisch sortiert</span>
            </div>
            <div className={styles.queueList}>
              {upcoming.map((lead, index) => (
                <div key={lead.id}>
                  <span>{String(index + 2).padStart(2, "0")}</span>
                  <div>
                    <strong>{lead.company}</strong>
                    <small>{lead.nextAction === "callback" ? "↺ Rückruf · " + displayTime(lead.nextActionAt) : (lead.contact || lead.city || "Kontaktbereit")}</small>
                  </div>
                  <b>{lead.salesPriority}</b>
                </div>
              ))}
              {!upcoming.length && <p>Nach diesem Lead ist die Queue leer.</p>}
            </div>
            <div className={styles.rule}>
              <strong>Sortierung</strong>
              <p>Fällige Rückrufe zuerst. Danach höchste Sales-Priorität. „Nicht erreicht“ taucht heute nicht noch einmal auf.</p>
            </div>
          </aside>
        </div>
      )}

      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
