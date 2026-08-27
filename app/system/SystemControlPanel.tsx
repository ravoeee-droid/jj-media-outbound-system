"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./SystemControlPanel.module.css";

type LogEntry = {
  id: string;
  company?: string | null;
  type: string;
  status: string;
  progress: number;
  error?: string | null;
  startedAt?: string | null;
  finishedAt?: string | null;
  createdAt: string;
};

type CampaignState = { running: boolean; startedAt?: string | null; stoppedAt?: string | null; intervalMinutes: number };

const processNames: Record<string, string> = {
  lead_video_render: "Video Rendering",
  campaign_started: "Kampagne gestartet",
  campaign_stopped: "Kampagne gestoppt",
  campaign_email_send: "E-Mail-Versand",
  campaign_tick: "Automation Check",
};

function statusLabel(status: string) {
  if (status === "completed") return "Erfolgreich";
  if (status === "failed") return "Fehler";
  return "Läuft";
}

export default function SystemControlPanel() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [campaign, setCampaign] = useState<CampaignState | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    try {
      const [logResponse, campaignResponse] = await Promise.all([
        fetch(`/api/system-logs?limit=300&status=${filter}`, { cache: "no-store" }),
        fetch("/api/campaign-control", { cache: "no-store" }),
      ]);
      if (logResponse.ok) setLogs((await logResponse.json()).logs || []);
      if (campaignResponse.ok) setCampaign(await campaignResponse.json());
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function control(action: "start" | "stop") {
    if (action === "start" && !window.confirm("Kampagne wirklich starten? Danach darf der externe Takt jeweils genau eine versandbereite E-Mail senden.")) return;
    setChanging(true);
    setMessage("");
    try {
      const response = await fetch("/api/campaign-control", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const payload = await response.json();
      setMessage(response.ok ? (action === "start" ? "Kampagne ist freigegeben." : "Kampagne wurde sofort gestoppt.") : payload.error || "Aktion fehlgeschlagen.");
      await refresh();
    } finally {
      setChanging(false);
    }
  }

  const stats = useMemo(() => ({
    running: logs.filter((log) => log.status === "running").length,
    failed: logs.filter((log) => log.status === "failed").length,
    completed: logs.filter((log) => log.status === "completed").length,
  }), [logs]);

  return (
    <div className={styles.stack}>
      <section className={styles.statusGrid}>
        <article className={`${styles.campaignCard} ${campaign?.running ? styles.campaignLive : ""}`}>
          <div className={styles.cardTop}><span className={campaign?.running ? styles.liveDot : styles.pauseDot} /><small>CAMPAIGN AUTOMATION</small></div>
          <h2>{campaign?.running ? "Kampagne läuft kontrolliert." : "Versand ist vollständig pausiert."}</h2>
          <p>{campaign?.running ? "Pro externem Automation-Takt wird maximal eine freigegebene E-Mail versendet." : "Ohne dein Go verlässt keine Kampagnen-Mail automatisch das System."}</p>
          <div className={styles.campaignActions}>
            {campaign?.running
              ? <button className={styles.secondaryButton} onClick={() => void control("stop")} disabled={changing}>Sofort stoppen</button>
              : <button className={styles.primaryButton} onClick={() => void control("start")} disabled={changing}>{changing ? "Wird aktiviert …" : "Kampagne starten"}</button>}
            <span>{campaign?.intervalMinutes || 5} Min. Prüfintervall</span>
          </div>
          {message && <div className={styles.message}>{message}</div>}
        </article>

        <article className={styles.statCard}><span className={styles.statIcon}>↻</span><small>Laufend</small><strong>{stats.running}</strong><p>aktive Prozesse</p></article>
        <article className={styles.statCard}><span className={`${styles.statIcon} ${styles.successIcon}`}>✓</span><small>Erfolgreich</small><strong>{stats.completed}</strong><p>abgeschlossene Jobs</p></article>
        <article className={styles.statCard}><span className={`${styles.statIcon} ${styles.errorIcon}`}>!</span><small>Fehler</small><strong>{stats.failed}</strong><p>prüfbare Fehlerfälle</p></article>
      </section>

      <section className={styles.logCard}>
        <div className={styles.logHead}>
          <div><small>SYSTEM HISTORY</small><h2>Prozessprotokoll</h2><p>Automatische Aktualisierung alle 15 Sekunden. Keine Blackbox.</p></div>
          <div className={styles.filters}>
            <select value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Prozessstatus filtern">
              <option value="all">Alle Status</option>
              <option value="running">Laufend</option>
              <option value="completed">Erfolgreich</option>
              <option value="failed">Fehler</option>
            </select>
            <button onClick={() => void refresh()}>Aktualisieren</button>
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th>Zeit</th><th>Prozess</th><th>Lead</th><th>Status</th><th>Fortschritt</th><th>Dauer</th><th>Details</th></tr></thead>
            <tbody>
              {logs.map((log) => {
                const start = log.startedAt ? new Date(log.startedAt) : new Date(log.createdAt);
                const end = log.finishedAt ? new Date(log.finishedAt) : null;
                const duration = end ? `${Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000))} s` : log.status === "running" ? "läuft" : "—";
                return (
                  <tr key={log.id}>
                    <td className={styles.time}>{new Date(log.createdAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" })}</td>
                    <td><strong>{processNames[log.type] || log.type}</strong></td>
                    <td>{log.company || "System"}</td>
                    <td><span className={`${styles.status} ${log.status === "completed" ? styles.statusSuccess : log.status === "failed" ? styles.statusError : styles.statusRunning}`}><i />{statusLabel(log.status)}</span></td>
                    <td><div className={styles.progress}><span style={{ width: `${Math.max(0, Math.min(100, log.progress || 0))}%` }} /></div><small>{log.progress || 0}%</small></td>
                    <td>{duration}</td>
                    <td className={log.error && log.status === "failed" ? styles.errorText : styles.detail}>{log.error || "—"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!loading && logs.length === 0 && <div className={styles.empty}>Für diesen Filter sind noch keine Prozesse vorhanden.</div>}
          {loading && <div className={styles.empty}>Protokoll wird geladen …</div>}
        </div>
      </section>
    </div>
  );
}
