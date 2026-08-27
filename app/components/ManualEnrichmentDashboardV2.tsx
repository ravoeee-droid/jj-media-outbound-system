"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type Lead = {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  websiteUrl: string;
  domain: string;
  ceo: string;
  city: string;
  region: string;
  confidence: number;
};

type EnrichmentResult = {
  leadId: string;
  ok: boolean;
  lead?: Record<string, unknown>;
  websiteResolutionSource?: string;
  error?: string;
};

type LeadRunState = {
  status: "running" | "success" | "error";
  message: string;
};

function mapLead(value: Record<string, unknown>): Lead {
  return {
    id: String(value.id || ""),
    company: String(value.company || "Unbekanntes Unternehmen"),
    contact: String(value.contact || ""),
    email: String(value.email || ""),
    phone: String(value.phone || ""),
    websiteUrl: String(value.websiteUrl || ""),
    domain: String(value.domain || ""),
    ceo: String(value.ceo || ""),
    city: String(value.city || ""),
    region: String(value.region || ""),
    confidence: Number(value.confidence || 0),
  };
}

function sourceLabel(source?: string) {
  if (source === "stored") return "gespeicherte Website";
  if (source === "domain") return "gespeicherte Domain";
  if (source === "email_domain") return "E-Mail-Domain";
  if (source === "google_places") return "Google Places";
  if (source === "web_search") return "Websuche";
  return "Website-Prüfung";
}

export default function ManualEnrichmentDashboardV2() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [message, setMessage] = useState("");
  const [leadStates, setLeadStates] = useState<Record<string, LeadRunState>>({});

  useEffect(() => {
    void loadLeads();
  }, []);

  async function loadLeads() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/leads", { cache: "no-store" });
      const payload = await response.json() as { leads?: Record<string, unknown>[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Leads konnten nicht geladen werden.");
      setLeads((payload.leads || []).map(mapLead));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Leads konnten nicht geladen werden.");
    } finally {
      setLoading(false);
    }
  }

  const filteredLeads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter((lead) => [
      lead.company,
      lead.contact,
      lead.email,
      lead.websiteUrl,
      lead.domain,
      lead.ceo,
      lead.city,
      lead.region,
    ].join(" ").toLowerCase().includes(needle));
  }, [leads, query]);

  const allVisibleSelected = filteredLeads.length > 0
    && filteredLeads.every((lead) => selectedIds.includes(lead.id));

  function toggleLead(id: string, checked: boolean) {
    setSelectedIds((current) => checked
      ? Array.from(new Set([...current, id]))
      : current.filter((currentId) => currentId !== id));
  }

  function toggleAllVisible(checked: boolean) {
    const visibleIds = filteredLeads.map((lead) => lead.id);
    setSelectedIds((current) => checked
      ? Array.from(new Set([...current, ...visibleIds]))
      : current.filter((id) => !visibleIds.includes(id)));
  }

  async function enrichLeads(ids: string[]) {
    if (running) return;
    const uniqueIds = Array.from(new Set(ids)).filter(Boolean);
    if (!uniqueIds.length) {
      setMessage("Bitte wähle mindestens einen Lead aus.");
      return;
    }

    setRunning(true);
    setProgress({ current: 0, total: uniqueIds.length });
    setMessage(`Website-Suche und Enrichment für ${uniqueIds.length} Lead${uniqueIds.length === 1 ? "" : "s"} gestartet …`);
    setLeadStates((current) => {
      const next = { ...current };
      for (const id of uniqueIds) next[id] = { status: "running", message: "Website wird gesucht und geprüft …" };
      return next;
    });

    let successful = 0;
    let failed = 0;
    const successfulIds: string[] = [];
    const errors: string[] = [];

    try {
      for (let index = 0; index < uniqueIds.length; index += 10) {
        const batch = uniqueIds.slice(index, index + 10);
        const response = await fetch("/api/leads/enrich", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leadIds: batch, force: false }),
        });
        const payload = await response.json().catch(() => ({ error: "Ungültige Serverantwort." })) as {
          results?: EnrichmentResult[];
          error?: string;
        };
        const results: EnrichmentResult[] = payload.results?.length
          ? payload.results
          : batch.map((leadId): EnrichmentResult => ({ leadId, ok: false, error: payload.error || `Serverfehler ${response.status}` }));

        const updatedById = new Map<string, Lead>();
        const nextStates: Record<string, LeadRunState> = {};

        for (const result of results) {
          if (result.ok && result.lead) {
            successful += 1;
            successfulIds.push(result.leadId);
            updatedById.set(result.leadId, mapLead(result.lead));
            nextStates[result.leadId] = {
              status: "success",
              message: `Erfolgreich über ${sourceLabel(result.websiteResolutionSource)} angereichert.`,
            };
          } else {
            failed += 1;
            const detail = result.error || "Keine belastbare Website oder Kontaktdaten gefunden.";
            nextStates[result.leadId] = { status: "error", message: detail };
            const company = leads.find((lead) => lead.id === result.leadId)?.company || "Lead";
            if (errors.length < 4) errors.push(`${company}: ${detail}`);
          }
        }

        if (updatedById.size) {
          setLeads((current) => current.map((lead) => updatedById.get(lead.id) || lead));
        }
        setLeadStates((current) => ({ ...current, ...nextStates }));
        setProgress({ current: Math.min(index + batch.length, uniqueIds.length), total: uniqueIds.length });
      }

      setSelectedIds((current) => current.filter((id) => !successfulIds.includes(id)));
      const parts = [`${successful} erfolgreich angereichert`];
      if (failed) parts.push(`${failed} ohne Ergebnis`);
      if (errors.length) parts.push(errors.join(" · "));
      setMessage(`${parts.join(". ")}.`);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Das manuelle Enrichment ist fehlgeschlagen.";
      setMessage(detail);
      setLeadStates((current) => {
        const next = { ...current };
        for (const id of uniqueIds) {
          if (next[id]?.status === "running") next[id] = { status: "error", message: detail };
        }
        return next;
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f5f7fb", padding: "28px" }}>
      <div style={{ maxWidth: 1480, margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20, flexWrap: "wrap", marginBottom: 24 }}>
          <div>
            <p className="eyebrow eyebrow--dark">Manueller Modus</p>
            <h1 style={{ margin: "4px 0 8px", fontSize: "clamp(30px, 4vw, 52px)" }}>Leads gezielt enrichen</h1>
            <p style={{ margin: 0, color: "#667085", maxWidth: 800 }}>
              Wähle Leads aus und starte die Suche bewusst per Klick. Fehlt eine Website, sucht das System zuerst nach der offiziellen Unternehmensseite und prüft danach Kontakt, Impressum und Teamseiten.
            </p>
          </div>
          <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
            <Link className="button button--ghost" href="/dashboard">← Zurück zum Dashboard</Link>
            <button className="button button--soft" type="button" onClick={() => void loadLeads()} disabled={loading || running}>
              ↻ Aktualisieren
            </button>
          </div>
        </header>

        <section className="leads-card leads-card--page" style={{ marginBottom: 18 }}>
          <div className="workspace-toolbar" style={{ display: "flex", gap: 14, justifyContent: "space-between", alignItems: "center", flexWrap: "wrap" }}>
            <label className="search search--wide" style={{ flex: "1 1 320px" }}>
              <span>⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Firma, E-Mail, Geschäftsführer oder Ort" />
            </label>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <button className="button button--ghost" type="button" onClick={() => toggleAllVisible(!allVisibleSelected)} disabled={!filteredLeads.length || running}>
                {allVisibleSelected ? "Auswahl aufheben" : `Alle ${filteredLeads.length} auswählen`}
              </button>
              <button className="button button--primary" type="button" onClick={() => void enrichLeads(selectedIds)} disabled={!selectedIds.length || running}>
                {running
                  ? `${progress.current} / ${progress.total} werden verarbeitet …`
                  : `${selectedIds.length || 0} ausgewählte Leads enrichen`}
              </button>
            </div>
          </div>
        </section>

        {message && (
          <div role="status" aria-live="polite" style={{ marginBottom: 18, border: "1px solid #d7deea", borderRadius: 14, background: "#fff", padding: "14px 16px", color: "#344054", fontWeight: 650 }}>
            {message}
          </div>
        )}

        <section className="leads-card leads-card--page">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>
                    <input
                      type="checkbox"
                      aria-label="Alle sichtbaren Leads auswählen"
                      checked={allVisibleSelected}
                      onChange={(event) => toggleAllVisible(event.target.checked)}
                      disabled={!filteredLeads.length || running}
                    />{" "}
                    Unternehmen
                  </th>
                  <th>Website</th>
                  <th>E-Mail</th>
                  <th>Geschäftsführer</th>
                  <th>Standort</th>
                  <th>Datenqualität</th>
                  <th>Aktion</th>
                </tr>
              </thead>
              <tbody>
                {filteredLeads.map((lead) => {
                  const runState = leadStates[lead.id];
                  return (
                    <tr key={lead.id}>
                      <td>
                        <div className="lead-company">
                          <input
                            type="checkbox"
                            aria-label={`${lead.company} auswählen`}
                            checked={selectedIds.includes(lead.id)}
                            onChange={(event) => toggleLead(lead.id, event.target.checked)}
                            disabled={running}
                          />
                          <span className="company-mark">{lead.company.split(" ").slice(0, 2).map((word) => word[0]).join("")}</span>
                          <span>
                            <strong>{lead.company}</strong>
                            <small>{lead.contact || "Ansprechpartner fehlt"}</small>
                          </span>
                        </div>
                      </td>
                      <td>
                        {lead.websiteUrl
                          ? <a href={lead.websiteUrl} target="_blank" rel="noreferrer" style={{ color: "inherit" }}>{lead.websiteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "")}</a>
                          : lead.domain
                            ? <span className="muted">{lead.domain}</span>
                            : <span className="muted">Wird beim Enrichment gesucht</span>}
                      </td>
                      <td><span className="muted">{lead.email || "Noch nicht gefunden"}</span></td>
                      <td><span className="muted">{lead.ceo || "Noch nicht gefunden"}</span></td>
                      <td><span className="muted">{[lead.city, lead.region].filter(Boolean).join(", ") || "Noch nicht gefunden"}</span></td>
                      <td><strong>{lead.confidence ? `${lead.confidence} %` : "—"}</strong></td>
                      <td style={{ minWidth: 210 }}>
                        <button
                          className="button button--soft"
                          type="button"
                          onClick={() => void enrichLeads([lead.id])}
                          disabled={running}
                        >
                          {runState?.status === "running"
                            ? "Website wird gesucht …"
                            : runState?.status === "success"
                              ? "Erneut prüfen"
                              : lead.websiteUrl || lead.domain
                                ? "Jetzt enrichen"
                                : "Website suchen & enrichen"}
                        </button>
                        {runState && runState.status !== "running" && (
                          <small
                            title={runState.message}
                            style={{ display: "block", marginTop: 6, maxWidth: 260, color: runState.status === "success" ? "#027a48" : "#b42318", lineHeight: 1.35 }}
                          >
                            {runState.message.length > 110 ? `${runState.message.slice(0, 107)}…` : runState.message}
                          </small>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {!loading && filteredLeads.length === 0 && <div className="empty-state">Keine passenden Leads gefunden.</div>}
            {loading && <div className="empty-state">Leads werden geladen …</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
