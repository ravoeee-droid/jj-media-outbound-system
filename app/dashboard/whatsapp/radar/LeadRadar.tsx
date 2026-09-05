"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./LeadRadar.module.css";

type Candidate = {
  leadId: string;
  threadId: string;
  company: string;
  contact: string;
  phone: string;
  classification: string;
  salesPriority: number;
  confidence: number;
  summary: string;
  consent: string;
  mode: string;
  status: string;
  lastMessageAt: string | null;
  nextFollowUpAt: string | null;
  reactivationReady: boolean;
  draft: { id: string; body: string; createdAt: string } | null;
};

type Overview = {
  status: Record<string, unknown>;
  counts: { imported: number; hot: number; warm: number; reactivate: number; followup: number; customer: number; private: number; cold: number; pending: number; ready: number };
  candidates: Candidate[];
};

const labels: Record<string, string> = {
  hot: "Heiß",
  warm: "Warm",
  reactivate: "Reaktivieren",
  followup: "Follow-up",
  customer: "Kunde",
  private: "Privat",
  cold: "Kalt",
  unknown: "Unklar",
  pending: "Analyse offen",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  try {
    return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
  } catch { return "—"; }
}

async function getOverview() {
  const response = await fetch("/api/whatsapp/history", { cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Lead Radar konnte nicht geladen werden.");
  return value as Overview;
}

export default function LeadRadar() {
  const [data, setData] = useState<Overview | null>(null);
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const refresh = useCallback(async () => {
    try { setData(await getOverview()); setError(""); }
    catch (err) { setError(err instanceof Error ? err.message : "Lead Radar konnte nicht geladen werden."); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => { if (!document.hidden) void refresh(); }, 20_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function sweep() {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/whatsapp/history", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "sweep" }) });
      const value = await response.json();
      if (!response.ok) throw new Error(value.error || "KI-Lauf fehlgeschlagen.");
      await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "KI-Lauf fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  const candidates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return (data?.candidates || []).filter((item) => {
      if (filter === "ready" && !item.reactivationReady) return false;
      if (filter !== "all" && filter !== "ready" && item.classification !== filter) return false;
      if (!query) return true;
      return `${item.company} ${item.contact} ${item.phone} ${item.summary}`.toLowerCase().includes(query);
    }).sort((a, b) => b.salesPriority - a.salesPriority || Date.parse(b.lastMessageAt || "0") - Date.parse(a.lastMessageAt || "0"));
  }, [data, filter, search]);

  const status = data?.status || {};
  const importedMessages = Number(status.importedMessages || 0);
  const unresolved = Number(status.unresolvedMessages || 0);
  const lastBatch = typeof status.lastBatchAt === "string" ? status.lastBatchAt : null;

  if (loading) return <div className={styles.state}>Lead Radar wird geladen …</div>;

  return (
    <div className={styles.root}>
      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.hero}>
        <div>
          <span className={styles.kicker}>LOCAL AI · OLLAMA · WHATSAPP HISTORY</span>
          <h2>Versteckte Chancen aus alten Chats zurückholen.</h2>
          <p>Der Lead Radar bewertet vorhandene 1:1-Verläufe, erkennt Kaufinteresse und Follow-ups und bereitet kontextbezogene Reaktivierungen vor.</p>
        </div>
        <div className={styles.heroActions}>
          <button onClick={() => void sweep()} disabled={busy}>{busy ? "KI arbeitet …" : "KI-Lauf starten"}</button>
          <button className={styles.secondary} onClick={() => void refresh()}>Aktualisieren</button>
        </div>
      </section>

      <section className={styles.metrics}>
        <article><span>Importiert</span><strong>{data?.counts.imported || 0}</strong><small>{importedMessages.toLocaleString("de-DE")} Nachrichten</small></article>
        <article><span>🔥 Hot Leads</span><strong>{data?.counts.hot || 0}</strong><small>höchste Priorität</small></article>
        <article><span>♻️ Reaktivieren</span><strong>{data?.counts.reactivate || 0}</strong><small>{data?.counts.ready || 0} mit Entwurf</small></article>
        <article><span>⏰ Follow-ups</span><strong>{data?.counts.followup || 0}</strong><small>offene nächste Schritte</small></article>
        <article><span>Analyse offen</span><strong>{data?.counts.pending || 0}</strong><small>läuft lokal weiter</small></article>
      </section>

      <section className={styles.syncStrip}>
        <div><span className={styles.liveDot} /><strong>History Engine aktiv</strong></div>
        <span>Letzter Import: {formatDate(lastBatch)}</span>
        <span>{unresolved ? `${unresolved} historische Nachrichten ohne auflösbare Telefonnummer` : "Keine ungelösten Telefonnummern gemeldet"}</span>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.filters}>
          {["all", "hot", "warm", "reactivate", "followup", "ready", "customer", "private", "cold", "pending"].map((value) => (
            <button key={value} className={filter === value ? styles.filterActive : ""} onClick={() => setFilter(value)}>
              {value === "all" ? "Alle" : value === "ready" ? "Versandbereit" : labels[value] || value}
            </button>
          ))}
        </div>
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Kontakt, Firma, Nummer oder Inhalt suchen …" />
      </section>

      <section className={styles.list}>
        <div className={styles.listHead}><span>Kontakt</span><span>Signal</span><span>Priorität</span><span>Nächster Schritt</span><span>Status</span></div>
        {candidates.length === 0 && <div className={styles.empty}>Für diesen Filter gibt es aktuell keine Kontakte.</div>}
        {candidates.map((item) => (
          <article className={styles.row} key={item.threadId}>
            <div className={styles.identity}>
              <div className={styles.avatar}>{(item.contact || item.company || "?").slice(0, 2).toUpperCase()}</div>
              <div><strong>{item.contact || item.company}</strong><span>{item.company !== item.contact ? item.company : `+${item.phone}`}</span><small>Letzter Chat: {formatDate(item.lastMessageAt)}</small></div>
            </div>
            <div><span className={`${styles.badge} ${styles[`badge_${item.classification}`] || ""}`}>{labels[item.classification] || item.classification}</span><p>{item.summary}</p></div>
            <div className={styles.score}><strong>{item.salesPriority}</strong><div><i style={{ width: `${Math.max(2, item.salesPriority)}%` }} /></div><small>{item.confidence}% KI-Sicherheit</small></div>
            <div className={styles.next}>
              {item.draft ? <><strong>Reaktivierungsentwurf bereit</strong><p>{item.draft.body}</p></> : <><strong>{item.nextFollowUpAt ? `Follow-up ${formatDate(item.nextFollowUpAt)}` : "Noch kein Entwurf"}</strong><p>{item.reactivationReady ? "KI hat eine Kontaktchance erkannt." : "Analyse bestimmt den nächsten Schritt."}</p></>}
            </div>
            <div className={styles.status}>
              <span>{item.consent === "granted" ? "✓ Zustimmung" : item.consent === "revoked" ? "Gestoppt" : "Zustimmung prüfen"}</span>
              <span>{item.mode === "autopilot" ? "Autopilot" : item.mode === "copilot" ? "Copilot" : "Manuell"}</span>
              <Link href={`/dashboard/whatsapp?lead=${item.leadId}`}>Chat öffnen →</Link>
            </div>
          </article>
        ))}
      </section>

      <section className={styles.guardrail}>
        <strong>Automatik mit Kontrolle</strong>
        <p>Historische Kontakte werden analysiert, aber eine Reaktivierung wird nur automatisch verschickt, wenn im WhatsApp-Workspace Zustimmung und Autopilot aktiv sind. Private Kontakte, Opt-outs und klare Absagen werden nicht automatisch reaktiviert.</p>
      </section>
    </div>
  );
}
