"use client";

import Link from "next/link";

import { FormEvent, useEffect, useState } from "react";

type LeadDetail = {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  websiteUrl: string;
  pipelineStage: string;
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
  ceo: string;
  city: string;
  region: string;
  confidence: number;
};

type Activity = {
  id: string;
  type: string;
  title: string;
  detail: string;
  createdAt: string;
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

export default function LeadCrmPanel({
  leadId,
  onClose,
  onUpdated,
}: {
  leadId: string;
  onClose: () => void;
  onUpdated: (lead: Record<string, unknown>) => void;
}) {
  const [lead, setLead] = useState<LeadDetail | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch(`/api/crm/${leadId}`)
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "CRM-Daten konnten nicht geladen werden.");
        return payload as { lead: LeadDetail; activities: Activity[] };
      })
      .then((payload) => {
        if (!active) return;
        setLead(payload.lead);
        setActivities(payload.activities);
      })
      .catch((error) => setMessage(error instanceof Error ? error.message : "CRM-Daten konnten nicht geladen werden."))
      .finally(() => setLoading(false));
    return () => {
      active = false;
    };
  }, [leadId]);

  function patch<K extends keyof LeadDetail>(key: K, value: LeadDetail[K]) {
    setLead((current) => current ? { ...current, [key]: value } : current);
  }

  async function saveLead(event: FormEvent) {
    event.preventDefault();
    if (!lead) return;
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
          notes: lead.notes,
          objection: lead.objection,
          pitch: lead.pitch,
          recommendedOffer: lead.recommendedOffer,
          dealValue: Number(lead.dealValue),
          probability: Number(lead.probability),
        }),
      });
      const payload = await response.json() as { lead?: Record<string, unknown>; error?: string };
      if (!response.ok || !payload.lead) throw new Error(payload.error || "Speichern fehlgeschlagen.");
      onUpdated(payload.lead);
      setMessage("CRM-Daten gespeichert.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Speichern fehlgeschlagen.");
    } finally {
      setSaving(false);
    }
  }

  async function addNote(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const detail = String(data.get("detail") || "").trim();
    if (!detail) return;
    const response = await fetch(`/api/crm/${leadId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "note", title: "CRM-Notiz", detail }),
    });
    const payload = await response.json() as { activity?: Activity; error?: string };
    if (response.ok && payload.activity) {
      setActivities((current) => [payload.activity!, ...current]);
      form.reset();
    } else {
      setMessage(payload.error || "Notiz konnte nicht gespeichert werden.");
    }
  }

  return (
    <div className="crm-backdrop" role="presentation" onMouseDown={onClose}>
      <aside className="crm-panel" role="dialog" aria-modal="true" aria-label="Lead CRM" onMouseDown={(event) => event.stopPropagation()}>
        <button className="modal-close" onClick={onClose} aria-label="CRM schließen">×</button>
        {loading ? (
          <div className="crm-loading">CRM-Daten werden geladen …</div>
        ) : lead ? (
          <form onSubmit={saveLead}>
            <div className="crm-hero">
              <p className="eyebrow eyebrow--orange">360° Lead-Akte</p>
              <h2>{lead.company}</h2>
              <a href={lead.websiteUrl} target="_blank" rel="noreferrer">{lead.websiteUrl || "Instagram-Profil fehlt"}</a>
            </div>

            <div className="crm-score-grid">
              <div><small>Sales-Priorität</small><strong>{lead.salesPriority}</strong></div>
              <div><small>Datenqualität</small><strong>{lead.confidence || "—"} %</strong></div>
              <div><small>Social-Potenzial</small><strong>{Math.max(0, 100 - lead.websiteScore)}</strong></div>
              <div><small>Wahrscheinlichkeit</small><strong>{lead.probability} %</strong></div>
            </div>

            <label className="crm-field">
              <span>Pipeline</span>
              <select value={lead.pipelineStage} onChange={(event) => patch("pipelineStage", event.target.value)}>
                {stages.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
              </select>
            </label>

            <div className="crm-two">
              <label className="crm-field"><span>Ansprechpartner</span><input value={lead.contact} onChange={(event) => patch("contact", event.target.value)} /></label>
              <label className="crm-field"><span>Geschäftsführer / Inhaber</span><input value={lead.ceo || "Noch nicht ermittelt"} readOnly /></label>
            </div>
            <div className="crm-two">
              <label className="crm-field"><span>Telefon</span><input value={lead.phone} onChange={(event) => patch("phone", event.target.value)} /></label>
              <label className="crm-field"><span>Standort</span><input value={[lead.city, lead.region].filter(Boolean).join(", ") || "Noch nicht ermittelt"} readOnly /></label>
            </div>
            <label className="crm-field"><span>E-Mail</span><input type="email" value={lead.email} onChange={(event) => patch("email", event.target.value)} /></label>

            <div className="crm-two">
              <label className="crm-field"><span>Dealwert €</span><input type="number" min="0" value={lead.dealValue} onChange={(event) => patch("dealValue", Number(event.target.value))} /></label>
              <label className="crm-field"><span>Wahrscheinlichkeit %</span><input type="number" min="0" max="100" value={lead.probability} onChange={(event) => patch("probability", Number(event.target.value))} /></label>
            </div>

            <label className="crm-field"><span>Empfohlenes Angebot</span><input value={lead.recommendedOffer} onChange={(event) => patch("recommendedOffer", event.target.value)} /></label>
            <label className="crm-field"><span>Pitch / konkreter Hebel</span><textarea rows={4} value={lead.pitch} onChange={(event) => patch("pitch", event.target.value)} /></label>
            <label className="crm-field"><span>Einwand</span><textarea rows={3} value={lead.objection} onChange={(event) => patch("objection", event.target.value)} /></label>
            <label className="crm-field"><span>Interne Notizen</span><textarea rows={5} value={lead.notes} onChange={(event) => patch("notes", event.target.value)} /></label>

            {(lead.tags.length > 0 || lead.jobTitles.length > 0) && (
              <div className="crm-signals">
                {[...lead.tags, ...lead.jobTitles.slice(0, 6)].map((item) => <span key={item}>{item}</span>)}
              </div>
            )}

            <Link className="button button--wide" href={`/dashboard/whatsapp?lead=${leadId}`}>WhatsApp öffnen</Link><button className="button button--primary button--wide" type="submit" disabled={saving}>{saving ? "Speichert …" : "CRM-Akte speichern"}</button>
            {message && <p className="crm-message" role="status">{message}</p>}
          </form>
        ) : (
          <div className="crm-loading">{message || "Lead nicht gefunden."}</div>
        )}

        {lead && (
          <section className="crm-timeline">
            <div className="crm-timeline__head"><p className="eyebrow eyebrow--dark">Aktivitäten</p><strong>{activities.length}</strong></div>
            <form className="crm-note-form" onSubmit={addNote}>
              <textarea name="detail" rows={3} placeholder="Gesprächsnotiz oder nächsten Schritt festhalten …" />
              <button className="button button--soft" type="submit">Notiz hinzufügen</button>
            </form>
            <div className="crm-activity-list">
              {activities.map((activity) => (
                <article key={activity.id}>
                  <i />
                  <div><strong>{activity.title}</strong><p>{activity.detail}</p><small>{new Date(activity.createdAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" })}</small></div>
                </article>
              ))}
              {activities.length === 0 && <p className="muted">Noch keine Aktivitäten.</p>}
            </div>
          </section>
        )}
      </aside>
    </div>
  );
}
