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
  ceo: string;
  city: string;
  region: string;
  confidence: number;
};

type EnrichmentResult = {
  leadId: string;
  ok: boolean;
  lead?: Record<string, unknown>;
  error?: string;
};

function mapLead(value: Record<string, unknown>): Lead {
  return {
    id: String(value.id || ""),
    company: String(value.company || "Unbekanntes Unternehmen"),
    contact: String(value.contact || ""),
    email: String(value.email || ""),
    phone: String(value.phone || ""),
    websiteUrl: String(value.websiteUrl || ""),
    ceo: String(value.ceo || ""),
    city: String(value.city || ""),
    region: String(value.region || ""),
    confidence: Number(value.confidence || 0),
  };
}

export default function ManualEnrichmentDashboard() {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0 });
  const [message, setMessage] = useState("");

  useEffect(() => {
    void loadLeads();
  }, []);

  async function loadLeads() {
    setLoading(true);
    setMessage("");
    try {
      const response = await fetch("/api/leads");
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
    const uniqueIds = Array.from(new Set(ids));
    const eligibleIds = uniqueIds.filter((id) => leads.some((lead) => lead.id === id && lead.websiteUrl));
    const skipped = uniqueIds.length - eligibleIds.length;

    if (!eligibleIds.length) {
      setMessage("Für die Auswahl fehlt eine Website. Ohne Website kann nichts angereichert werden.");
      return;
    }

    setRunning(true);
    setProgress({ current: 0, total: eligibleIds.length });
    setMessage("");

    let successful = 0;
    let failed = 0;
    const errors: string[] = [];

    try {
      for (let index = 0; index < eligibleIds.length; index += 5) {
        const batch = eligibleIds.slice(index, index + 5);
        const response = await fetch("/api/leads/enrich", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leadIds: batch, force: false }),
        });
        const payload = await response.json() as {
          results?: EnrichmentResult[];
          error?: string;
        };
        const results = payload.results || batch.map((leadId) => ({
          leadId,
          ok: false,
          error: payload.error || "Enrichment fehlgeschlagen.",
        }));

        const updatedById = new Map<string, Lead>();
        for (const result of results) {
          if (result.ok && result.lead) {
            successful += 1;
            updatedById.set(result.leadId, mapLead(result.lead));
          } else {
            failed += 1;
            if (result.error && errors.length < 3) errors.push(result.error);
          }
        }
        if (updatedById.size) {
          setLeads((current) => current.map((lead) => updatedById.get(lead.id) || lead));
        }
        setProgress({ current: Math.min(index + batch.length, eligibleIds.length), total: eligibleIds.length });
      }

      setSelectedIds((current) => current.filter((id) => !eligibleIds.includes(id)));
      const parts = [`${successful} Lead${successful === 1 ? "" : "s"} erfolgreich angereichert`];
      if (failed) parts.push(`${failed} fehlgeschlagen`);
      if (skipped) parts.push(`${skipped} ohne Website übersprungen`);
      if (errors.length) parts.push(errors.join(" · "));
      setMessage(`${parts.join(". ")}.`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Das manuelle Enrichment ist fehlgeschlagen.");
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
            <p style={{ margin: 0, color: "#667085", maxWidth: 760 }}>
              Wähle einzelne Leads oder alle aus und starte die Suche bewusst per Klick. Es läuft nichts automatisch im Hintergrund.
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
                  ? `${progress.current} / ${progress.total} werden enriched …`
                  : `${selectedIds.length || 0} ausgewählte Leads enrichen`}
              </button>
            </div>
          </div>
        </section>

        {message && (
          <div role="status" style={{ marginBottom: 18, border: "1px solid #d7deea", borderRadius: 14, background: "#fff", padding: "14px 16px", color: "#344054", fontWeight: 650 }}>
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
                {filteredLeads.map((lead) => (
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
                        : <span className="muted">Fehlt</span>}
                    </td>
                    <td><span className="muted">{lead.email || "Noch nicht gefunden"}</span></td>
                    <td><span className="muted">{lead.ceo || "Noch nicht gefunden"}</span></td>
                    <td><span className="muted">{[lead.city, lead.region].filter(Boolean).join(", ") || "Noch nicht gefunden"}</span></td>
                    <td><strong>{lead.confidence ? `${lead.confidence} %` : "—"}</strong></td>
                    <td>
                      <button
                        className="button button--soft"
                        type="button"
                        onClick={() => void enrichLeads([lead.id])}
                        disabled={running || !lead.websiteUrl}
                      >
                        {lead.websiteUrl ? "Jetzt enrichen" : "Website fehlt"}
                      </button>
                    </td>
                  </tr>
                ))}
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
