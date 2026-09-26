"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import MeetingPicker from "./MeetingPicker";
import styles from "./LeadCrmPanel.module.css";

type LeadDetail = {
  id: string;
  slug: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  instagramUrl: string;
  websiteUrl: string;
  city: string;
  region: string;
  ceo: string;
  pipelineStage: string;
  researchStatus: string;
  validationStatus: string;
  analysisStatus: string;
  callStatus: string;
  emailStatus: string;
  whatsappStatus: string;
  videoStatus: string;
  nextAction: string;
  nextActionAt: string | null;
  contactLocked: boolean;
  contactLockReason: string;
  notes: string;
  objection: string;
  pitch: string;
  recommendedOffer: string;
  dealValue: number;
  probability: number;
  salesPriority: number;
  websiteScore: number;
  jobCount: number;
  jobTitles: string[];
  tags: string[];
  summary: string;
  confidence: number;
  scrollVideoUrl: string | null;
  landingPath: string;
};

type Activity = { id: string; type: string; title: string; detail: string; createdAt: string };
type Task = { id: string; title: string; dueAt: string | null; status: string; priority: string; type: string };
type Outreach = { id: string; step: number; subject: string; status: string; scheduledAt: string | null; sentAt: string | null };
type Booking = { id: string; scheduledAt: string; provider: string; status: string };
type Permissions = {
  canManageLeads: boolean;
  canSendEmail: boolean;
  canUseWhatsapp: boolean;
  canGenerateVideo: boolean;
  canBookMeetings: boolean;
};
type DetailPayload = {
  lead: LeadDetail;
  activities: Activity[];
  tasks: Task[];
  outreach: Outreach[];
  bookings: Booking[];
  permissions: Permissions;
  error?: string;
};

type EmailDraft = {
  subject: string;
  body: string;
  html: string;
  mailUrl: string;
  friendlyVideoUrl: string;
};

const stages = [
  ["new", "Neu"],
  ["qualified", "Qualifiziert"],
  ["contact_ready", "Kontaktbereit"],
  ["contacted", "Kontaktiert"],
  ["replied", "Reagiert"],
  ["call_booked", "Termin"],
  ["won", "Gewonnen"],
  ["lost", "Verloren"],
] as const;

const statusLabel: Record<string, string> = {
  pending: "Offen",
  enriched: "Erledigt",
  failed: "Fehler",
  contact_found: "Kontakt gefunden",
  needs_review: "Prüfen",
  validated: "Validiert",
  ready: "Bereit",
  not_started: "Offen",
  queued: "Geplant",
  attempted: "Versucht",
  connected: "Verbunden",
  callback: "Rückruf",
  completed: "Erledigt",
  sent: "Gesendet",
  replied: "Antwort",
  opened: "Geöffnet",
  active: "Aktiv",
  stopped: "Gestoppt",
  processing: "Läuft",
};

function toLocalInput(date: Date) {
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function defaultFuture(hours: number) {
  const date = new Date(Date.now() + hours * 60 * 60 * 1000);
  date.setMinutes(Math.ceil(date.getMinutes() / 15) * 15, 0, 0);
  return toLocalInput(date);
}

function displayDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function LeadCrmPanel({
  leadId,
  onClose,
  onUpdated,
}: {
  leadId: string;
  onClose: () => void;
  onUpdated: (lead: Record<string, unknown>) => void;
}) {
  const [payload, setPayload] = useState<DetailPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [busyAction, setBusyAction] = useState("");
  const [message, setMessage] = useState("");
  const [scheduleMode, setScheduleMode] = useState<"callback" | "meeting" | null>(null);
  const [meetingPicker, setMeetingPicker] = useState(false);
  const [scheduleValue, setScheduleValue] = useState(defaultFuture(2));
  const [emailDraft, setEmailDraft] = useState<EmailDraft | null>(null);

  const loadDetails = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const response = await fetch(`/api/crm/${leadId}`, { cache: "no-store" });
      const next = await response.json() as DetailPayload;
      if (!response.ok) throw new Error(next.error || "CRM-Daten konnten nicht geladen werden.");
      setPayload(next);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "CRM-Daten konnten nicht geladen werden.");
    } finally {
      if (!silent) setLoading(false);
    }
  }, [leadId]);

  useEffect(() => {
    void loadDetails();
  }, [loadDetails]);

  const lead = payload?.lead;
  const permissions: Permissions = payload?.permissions ?? {
    canManageLeads: false,
    canSendEmail: false,
    canUseWhatsapp: false,
    canGenerateVideo: false,
    canBookMeetings: false,
  };

  function patch<K extends keyof LeadDetail>(key: K, value: LeadDetail[K]) {
    setPayload((current) => current ? { ...current, lead: { ...current.lead, [key]: value } } : current);
  }

  async function refreshAfterAction(updated?: Record<string, unknown>) {
    if (updated) onUpdated(updated);
    await loadDetails(true);
  }

  async function runWorkflow(action: "validate" | "analyze" | "no_interest", success: string) {
    if (!lead || busyAction) return;
    setBusyAction(action);
    setMessage("");
    try {
      const response = await fetch(`/api/crm/${lead.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const result = await response.json() as { lead?: Record<string, unknown>; error?: string };
      if (!response.ok) throw new Error(result.error || "Aktion fehlgeschlagen.");
      await refreshAfterAction(result.lead);
      setMessage(success);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusyAction("");
    }
  }

  async function runEnrichment() {
    if (!lead || busyAction) return;
    setBusyAction("enrich");
    setMessage("");
    try {
      const response = await fetch("/api/leads/enrich", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const result = await response.json() as { results?: Array<{ lead?: Record<string, unknown>; error?: string }>; error?: string };
      const first = result.results?.[0];
      if (!response.ok || !first?.lead) throw new Error(first?.error || result.error || "Enrichment fehlgeschlagen.");
      await refreshAfterAction(first.lead);
      setMessage("Unternehmensdaten wurden aktualisiert.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Enrichment fehlgeschlagen.");
    } finally {
      setBusyAction("");
    }
  }

  async function captureProfile() {
    if (!lead || busyAction) return;
    setBusyAction("capture");
    setMessage("");
    try {
      const response = await fetch(`/api/leads/${lead.id}/capture-profile`, { method: "POST" });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Screenshot konnte nicht erstellt werden.");
      await loadDetails(true);
      setMessage("Instagram-Screenshot ist vorbereitet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Screenshot konnte nicht erstellt werden.");
    } finally {
      setBusyAction("");
    }
  }

  async function generateVideo() {
    if (!lead || busyAction) return;
    setBusyAction("video");
    setMessage("");
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Video konnte nicht erstellt werden.");
      await loadDetails(true);
      setMessage("Persönliches Video ist fertig.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Video konnte nicht erstellt werden.");
    } finally {
      setBusyAction("");
    }
  }

  async function prepareEmail() {
    if (!lead || busyAction) return;
    setBusyAction("email");
    setMessage("");
    try {
      const response = await fetch("/api/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, action: "prepare", step: 1 }),
      });
      const result = await response.json() as EmailDraft & { error?: string };
      if (!response.ok) throw new Error(result.error || "E-Mail konnte nicht vorbereitet werden.");
      setEmailDraft(result);
      setMessage("Info-Mail ist vorbereitet. Noch nichts wurde versendet.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "E-Mail konnte nicht vorbereitet werden.");
    } finally {
      setBusyAction("");
    }
  }

  async function sendPreparedEmail(action: "send" | "mark_sent") {
    if (!lead || !emailDraft || busyAction) return;
    setBusyAction(action);
    setMessage("");
    try {
      const response = await fetch("/api/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId: lead.id,
          action,
          step: 1,
          subject: emailDraft.subject,
          body: emailDraft.body,
        }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Versandstatus konnte nicht gespeichert werden.");
      setEmailDraft(null);
      await loadDetails(true);
      setMessage(action === "send" ? "E-Mail wurde versendet." : "Manueller Versand wurde gespeichert.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Versand fehlgeschlagen.");
    } finally {
      setBusyAction("");
    }
  }

  async function openWhatsapp() {
    if (!lead || busyAction) return;
    setBusyAction("whatsapp");
    setMessage("");
    try {
      const response = await fetch("/api/whatsapp", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "open", leadId: lead.id, phone: lead.phone || undefined }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "WhatsApp konnte nicht geöffnet werden.");
      window.location.assign(`/admin/dashboard/whatsapp?lead=${lead.id}`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "WhatsApp konnte nicht geöffnet werden.");
      setBusyAction("");
    }
  }

  async function schedule(event: FormEvent) {
    event.preventDefault();
    if (!lead || !scheduleMode || !scheduleValue || busyAction) return;
    setBusyAction(scheduleMode);
    setMessage("");
    try {
      const date = new Date(scheduleValue);
      if (Number.isNaN(date.getTime())) throw new Error("Bitte Datum und Uhrzeit prüfen.");
      const body = scheduleMode === "callback"
        ? { action: "callback", dueAt: date.toISOString() }
        : { action: "meeting", scheduledAt: date.toISOString() };
      const response = await fetch(`/api/crm/${lead.id}/actions`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as { lead?: Record<string, unknown>; error?: string };
      if (!response.ok) throw new Error(result.error || "Termin konnte nicht gespeichert werden.");
      setScheduleMode(null);
      await refreshAfterAction(result.lead);
      setMessage(scheduleMode === "callback" ? "Rückruf wurde eingeplant." : "Termin wurde im CRM eingetragen.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Termin konnte nicht gespeichert werden.");
    } finally {
      setBusyAction("");
    }
  }

  async function saveLead(event: FormEvent) {
    event.preventDefault();
    if (!lead || saving || !permissions?.canManageLeads) return;
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/crm", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          id: lead.id,
          pipelineStage: lead.pipelineStage,
          contact: lead.contact,
          email: lead.email,
          phone: lead.phone,
          whatsappStatus: lead.whatsappStatus,
          notes: lead.notes,
          objection: lead.objection,
          pitch: lead.pitch,
          recommendedOffer: lead.recommendedOffer,
          dealValue: Number(lead.dealValue),
          probability: Number(lead.probability),
        }),
      });
      const result = await response.json() as { lead?: Record<string, unknown>; error?: string };
      if (!response.ok || !result.lead) throw new Error(result.error || "Speichern fehlgeschlagen.");
      onUpdated(result.lead);
      setMessage("CRM-Akte gespeichert.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!permissions?.canManageLeads) return;
    const form = event.currentTarget;
    const data = new FormData(form);
    const detail = String(data.get("detail") || "").trim();
    if (!detail) return;
    const response = await fetch(`/api/crm/${leadId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", title: "CRM-Notiz", detail }),
    });
    const result = await response.json() as { activity?: Activity; error?: string };
    if (response.ok && result.activity) {
      setPayload((current) => current ? { ...current, activities: [result.activity!, ...current.activities] } : current);
      form.reset();
    } else {
      setMessage(result.error || "Notiz konnte nicht gespeichert werden.");
    }
  }

  async function copyEmail() {
    if (!emailDraft) return;
    await navigator.clipboard.writeText(`${emailDraft.subject}\n\n${emailDraft.body}`);
    setMessage("E-Mail wurde kopiert.");
  }

  if (loading) {
    return <div className={styles.backdrop} role="presentation"><aside className={styles.panel}><div className={styles.loading}><i /><span>Lead-Akte wird geladen …</span></div></aside></div>;
  }

  if (!lead || !payload) {
    return <div className={styles.backdrop} role="presentation" onMouseDown={onClose}><aside className={styles.panel} onMouseDown={(event) => event.stopPropagation()}><button className={styles.close} onClick={onClose}>×</button><div className={styles.loading}>{message || "Lead nicht gefunden."}</div></aside></div>;
  }

  const profileUrl = lead.instagramUrl || lead.websiteUrl;
  const canContact = !lead.contactLocked;
  const hasWhatsapp = ["ready", "active", "sent", "replied"].includes(lead.whatsappStatus);

  return (
    <div className={styles.backdrop} role="presentation" onMouseDown={onClose}>
      <aside className={styles.panel} role="dialog" aria-modal="true" aria-label={"Lead-Akte " + lead.company} onMouseDown={(event) => event.stopPropagation()}>
        <button className={styles.close} onClick={onClose} aria-label="Lead-Akte schließen">×</button>

        <header className={styles.hero}>
          <div>
            <p>LEAD WORKSPACE</p>
            <h2>{lead.company}</h2>
            <div className={styles.heroMeta}>
              <span>{[lead.city, lead.region].filter(Boolean).join(", ") || "Standort offen"}</span>
              <i />
              <span>Priorität {lead.salesPriority}/100</span>
              {lead.contactLocked && <><i /><strong>Kontakt gesperrt</strong></>}
            </div>
          </div>
          <div className={styles.heroLinks}>
            {profileUrl && <a href={profileUrl} target="_blank" rel="noreferrer">Profil ↗</a>}
            {lead.videoStatus === "ready" && <a href={`/v/${lead.slug}`} target="_blank" rel="noreferrer">Video ↗</a>}
          </div>
        </header>

        <section className={styles.workflow}>
          <StatusPill label="Recherche" value={lead.researchStatus} />
          <StatusPill label="Validierung" value={lead.validationStatus} />
          <StatusPill label="Analyse" value={lead.analysisStatus} />
          <StatusPill label="Call" value={lead.callStatus} />
          <StatusPill label="E-Mail" value={lead.emailStatus} />
          <StatusPill label="WhatsApp" value={lead.whatsappStatus} />
          <StatusPill label="Video" value={lead.videoStatus} />
        </section>

        <section className={styles.actions}>
          <div className={styles.sectionHead}><div><small>MANUELLE AKTIONEN</small><h3>Nächster Schritt ohne Umwege</h3></div><span>{lead.nextAction === "none" ? "Kein Schritt offen" : "Als Nächstes: " + lead.nextAction}</span></div>
          <div className={styles.actionGrid}>
            <ActionButton icon="☎" title="Anrufen" note={lead.phone || "Telefon fehlt"} disabled={!lead.phone || !canContact} href={lead.phone ? `tel:${lead.phone.replace(/[^+\d]/g, "")}` : undefined} />
            <ActionButton icon="◉" title="WhatsApp" note={!lead.phone ? "Telefon fehlt" : hasWhatsapp ? "Thread öffnen" : "Keine WhatsApp-Nummer bestätigt"} disabled={!permissions.canUseWhatsapp || !lead.phone || !hasWhatsapp || !canContact} busy={busyAction === "whatsapp"} onClick={() => void openWhatsapp()} />
            <ActionButton icon="⌕" title="Enrichen" note="Website & Kontakt" disabled={!permissions.canManageLeads} busy={busyAction === "enrich"} onClick={() => void runEnrichment()} />
            <ActionButton icon="✓" title="Validieren" note={statusLabel[lead.validationStatus] || lead.validationStatus} disabled={!permissions.canManageLeads} busy={busyAction === "validate"} onClick={() => void runWorkflow("validate", "Lead wurde validiert.")} />
            <ActionButton icon="◇" title="Analysieren" note="Readiness & Priorität" disabled={!permissions.canManageLeads} busy={busyAction === "analyze"} onClick={() => void runWorkflow("analyze", "Lead-Readiness wurde aktualisiert.")} />
            <ActionButton icon="▣" title="Screenshot" note={lead.scrollVideoUrl ? "Vorhanden · neu erstellen" : "Instagram aufnehmen"} disabled={!permissions.canGenerateVideo || !lead.instagramUrl} busy={busyAction === "capture"} onClick={() => void captureProfile()} />
            <ActionButton icon="▶" title="Video" note={lead.videoStatus === "ready" ? "Neu rendern" : "Persönlich rendern"} disabled={!permissions.canGenerateVideo || !lead.instagramUrl} busy={busyAction === "video"} onClick={() => void generateVideo()} />
            <ActionButton icon="✉" title="Info-Mail" note={lead.email || "E-Mail fehlt"} disabled={!permissions.canSendEmail || !lead.email || !canContact} busy={busyAction === "email"} onClick={() => void prepareEmail()} />
            <ActionButton icon="↺" title="Rückruf" note={lead.nextActionAt ? displayDate(lead.nextActionAt) : "Zeit festlegen"} disabled={!permissions.canManageLeads || !canContact} onClick={() => { setScheduleMode("callback"); setScheduleValue(defaultFuture(2)); }} />
            <ActionButton icon="◷" title="Termin" note="Freie Zeiten laden" disabled={!permissions.canBookMeetings || !canContact} onClick={() => { setScheduleMode(null); setMeetingPicker(true); }} />
          </div>

          {meetingPicker && (
            <MeetingPicker
              leadId={lead.id}
              onBooked={(booking) => {
                setMeetingPicker(false);
                onUpdated({
                  id: lead.id,
                  pipelineStage: "call_booked",
                  callStatus: "completed",
                  nextAction: "meeting",
                  nextActionAt: booking.start,
                });
                setMessage(booking.attendeeInvited
                  ? "Google Meet gebucht und Kalendereinladung an den Kontakt gesendet."
                  : "Google Meet gebucht. Für den Kontakt fehlt eine E-Mail; Meet-Link liegt in der Aktivität.");
                void loadDetails(true);
              }}
              onManual={() => {
                setMeetingPicker(false);
                setScheduleMode("meeting");
                setScheduleValue(defaultFuture(24));
              }}
              onCancel={() => setMeetingPicker(false)}
            />
          )}

          {scheduleMode && (
            <form className={styles.scheduleBox} onSubmit={schedule}>
              <div><strong>{scheduleMode === "callback" ? "Rückruf planen" : "Termin manuell eintragen"}</strong><small>{scheduleMode === "meeting" ? "Fallback ohne Google-Kalender: der Termin wird nur im CRM dokumentiert." : "Die Aufgabe landet beim Lead-Owner."}</small></div>
              <input type="datetime-local" value={scheduleValue} onChange={(event) => setScheduleValue(event.target.value)} required />
              <button type="button" onClick={() => setScheduleMode(null)}>Abbrechen</button>
              <button className={styles.darkButton} disabled={busyAction === scheduleMode}>{busyAction === scheduleMode ? "Speichert …" : "Speichern"}</button>
            </form>
          )}

          {emailDraft && (
            <div className={styles.emailDraft}>
              <div className={styles.emailDraftHead}><div><small>MAIL VORSCHAU</small><strong>{emailDraft.subject}</strong></div><button onClick={() => setEmailDraft(null)}>×</button></div>
              <textarea value={emailDraft.body} onChange={(event) => setEmailDraft({ ...emailDraft, body: event.target.value })} rows={8} />
              <div className={styles.emailActions}>
                <button onClick={() => void copyEmail()}>Kopieren</button>
                <button onClick={() => { void copyEmail(); window.open("https://webmail.strato.de/", "_blank", "noopener,noreferrer"); }}>STRATO öffnen ↗</button>
                <button disabled={busyAction === "mark_sent"} onClick={() => void sendPreparedEmail("mark_sent")}>Als gesendet markieren</button>
                <button className={styles.darkButton} disabled={busyAction === "send"} onClick={() => void sendPreparedEmail("send")}>{busyAction === "send" ? "Sendet …" : "Direkt senden"}</button>
              </div>
            </div>
          )}
        </section>

        {message && <div className={styles.message}>{message}</div>}

        <form className={styles.details} onSubmit={saveLead}>
          <div className={styles.sectionHead}><div><small>CRM-DATEN</small><h3>Kontakt & Verkauf</h3></div><span>{lead.contactLocked ? lead.contactLockReason || "Kontakt gesperrt" : "Bearbeitbar"}</span></div>
          <div className={styles.formGrid}>
            <label><span>Pipeline</span><select disabled={!permissions.canManageLeads} value={lead.pipelineStage} onChange={(event) => patch("pipelineStage", event.target.value)}>{stages.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label><span>Ansprechpartner</span><input disabled={!permissions.canManageLeads} value={lead.contact} onChange={(event) => patch("contact", event.target.value)} /></label>
            <label><span>Telefon</span><input disabled={!permissions.canManageLeads} value={lead.phone} onChange={(event) => patch("phone", event.target.value)} /></label>
            <label><span>WhatsApp verfügbar</span><select disabled={!permissions.canManageLeads || !lead.phone} value={hasWhatsapp ? "yes" : "no"} onChange={(event) => patch("whatsappStatus", event.target.value === "yes" ? "ready" : "not_started")}><option value="no">Nein / Festnetz / unbekannt</option><option value="yes">Ja, WhatsApp-Nummer bestätigt</option></select></label>
            <label><span>E-Mail</span><input disabled={!permissions.canManageLeads} type="email" value={lead.email} onChange={(event) => patch("email", event.target.value)} /></label>
            <label><span>Geschäftsführer / Inhaber</span><input value={lead.ceo || "Noch nicht ermittelt"} readOnly /></label>
            <label><span>Standort</span><input value={[lead.city, lead.region].filter(Boolean).join(", ") || "Noch nicht ermittelt"} readOnly /></label>
            <label><span>Dealwert €</span><input disabled={!permissions.canManageLeads} type="number" min="0" value={lead.dealValue} onChange={(event) => patch("dealValue", Number(event.target.value))} /></label>
            <label><span>Wahrscheinlichkeit %</span><input disabled={!permissions.canManageLeads} type="number" min="0" max="100" value={lead.probability} onChange={(event) => patch("probability", Number(event.target.value))} /></label>
          </div>

          {lead.summary && <div className={styles.summary}><small>RECHERCHE-ZUSAMMENFASSUNG</small><p>{lead.summary}</p></div>}

          <label className={styles.wideField}><span>Empfohlenes Angebot</span><input disabled={!permissions.canManageLeads} value={lead.recommendedOffer} onChange={(event) => patch("recommendedOffer", event.target.value)} /></label>
          <label className={styles.wideField}><span>Pitch / konkreter Hebel</span><textarea disabled={!permissions.canManageLeads} rows={3} value={lead.pitch} onChange={(event) => patch("pitch", event.target.value)} /></label>
          <label className={styles.wideField}><span>Einwand</span><textarea disabled={!permissions.canManageLeads} rows={2} value={lead.objection} onChange={(event) => patch("objection", event.target.value)} /></label>
          <label className={styles.wideField}><span>Interne Notizen</span><textarea disabled={!permissions.canManageLeads} rows={4} value={lead.notes} onChange={(event) => patch("notes", event.target.value)} /></label>

          {(lead.tags.length > 0 || lead.jobTitles.length > 0) && <div className={styles.tags}>{[...lead.tags, ...lead.jobTitles.slice(0, 6)].map((item) => <span key={item}>{item}</span>)}</div>}

          <div className={styles.formActions}>
            {permissions.canManageLeads && canContact && <button type="button" className={styles.dangerButton} onClick={() => {
              if (window.confirm("Diesen Lead wirklich als 'Kein Interesse' schließen und weiteren Kontakt sperren?")) void runWorkflow("no_interest", "Lead wurde geschlossen und für weiteren Kontakt gesperrt.");
            }} disabled={busyAction === "no_interest"}>{busyAction === "no_interest" ? "Schließt …" : "Kein Interesse"}</button>}
            <span />
            {permissions.canManageLeads && <button className={styles.darkButton} disabled={saving}>{saving ? "Speichert …" : "CRM-Akte speichern"}</button>}
          </div>
        </form>

        <section className={styles.timeline}>
          <div className={styles.sectionHead}><div><small>VERLAUF</small><h3>Aktivitäten</h3></div><span>{payload.activities.length}</span></div>
          {permissions.canManageLeads && <form className={styles.noteForm} onSubmit={addNote}><textarea name="detail" rows={2} placeholder="Gespräch, Einwand oder nächsten Schritt notieren …" /><button>Notiz hinzufügen</button></form>}
          <div className={styles.timelineList}>
            {payload.activities.map((activity) => <article key={activity.id}><i /><div><strong>{activity.title}</strong>{activity.detail && <p>{activity.detail}</p>}<small>{displayDate(activity.createdAt)}</small></div></article>)}
            {!payload.activities.length && <p className={styles.empty}>Noch keine Aktivitäten.</p>}
          </div>

          {(payload.tasks.length > 0 || payload.bookings.length > 0 || payload.outreach.length > 0) && (
            <div className={styles.related}>
              {payload.tasks.filter((task) => task.status === "open").slice(0, 5).map((task) => <span key={task.id}><b>Aufgabe</b>{task.title}<small>{displayDate(task.dueAt)}</small></span>)}
              {payload.bookings.slice(0, 3).map((booking) => <span key={booking.id}><b>Termin</b>{displayDate(booking.scheduledAt)}<small>{booking.status}</small></span>)}
              {payload.outreach.slice(0, 3).map((item) => <span key={item.id}><b>E-Mail {item.step}</b>{item.subject}<small>{item.status}</small></span>)}
            </div>
          )}
        </section>
      </aside>
    </div>
  );
}

function StatusPill({ label, value }: { label: string; value: string }) {
  const positive = ["enriched", "validated", "ready", "sent", "replied", "active", "completed", "connected"].includes(value);
  const negative = ["failed", "stopped"].includes(value);
  return <div className={styles.statusPill} data-state={positive ? "positive" : negative ? "negative" : "neutral"}><small>{label}</small><strong>{statusLabel[value] || value}</strong></div>;
}

function ActionButton({
  icon,
  title,
  note,
  disabled,
  busy,
  onClick,
  href,
}: {
  icon: string;
  title: string;
  note: string;
  disabled?: boolean;
  busy?: boolean;
  onClick?: () => void;
  href?: string;
}) {
  const content = <><span>{busy ? "…" : icon}</span><div><strong>{busy ? "Läuft …" : title}</strong><small>{note}</small></div></>;
  if (href && !disabled) return <a className={styles.actionButton} href={href}>{content}</a>;
  return <button type="button" className={styles.actionButton} disabled={disabled || busy} onClick={onClick}>{content}</button>;
}
