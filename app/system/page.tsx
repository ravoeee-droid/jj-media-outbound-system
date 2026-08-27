"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";

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
  lead_video_render: "Video rendern",
  campaign_started: "Kampagne gestartet",
  campaign_stopped: "Kampagne gestoppt",
  campaign_email_send: "E-Mail-Versand",
  campaign_tick: "5-Minuten-Prüfung",
};

export default function SystemPage() {
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [campaign, setCampaign] = useState<CampaignState | null>(null);
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [changing, setChanging] = useState(false);
  const [message, setMessage] = useState("");

  const refresh = useCallback(async () => {
    const [logResponse, campaignResponse] = await Promise.all([
      fetch(`/api/system-logs?limit=300&status=${filter}`, { cache: "no-store" }),
      fetch("/api/campaign-control", { cache: "no-store" }),
    ]);
    if (logResponse.ok) setLogs((await logResponse.json()).logs || []);
    if (campaignResponse.ok) setCampaign(await campaignResponse.json());
    setLoading(false);
  }, [filter]);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 15_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  async function control(action: "start" | "stop") {
    if (action === "start" && !window.confirm("Kampagne wirklich starten? Danach darf der externe 5-Minuten-Takt jeweils genau eine versandbereite E-Mail senden.")) return;
    setChanging(true);
    setMessage("");
    const response = await fetch("/api/campaign-control", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action }),
    });
    const payload = await response.json();
    setMessage(response.ok ? (action === "start" ? "Kampagne ist freigegeben." : "Kampagne wurde sofort gestoppt.") : payload.error || "Aktion fehlgeschlagen.");
    setChanging(false);
    await refresh();
  }

  const stats = useMemo(() => ({
    running: logs.filter((log) => log.status === "running").length,
    failed: logs.filter((log) => log.status === "failed").length,
    completed: logs.filter((log) => log.status === "completed").length,
  }), [logs]);

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", color: "#17202e", padding: "28px" }}>
      <div style={{ maxWidth: 1380, margin: "0 auto" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 20, marginBottom: 24 }}>
          <div><p className="eyebrow">JJ-Media Social Audit Engine</p><h1 style={{ margin: 0, fontSize: 30 }}>Systemsteuerung & Logs</h1><p style={{ color: "#6b7787" }}>Jeder Prozess, jede Mail und jeder Fehler bleibt nachvollziehbar dokumentiert.</p></div>
          <div style={{ display: "flex", gap: 9 }}>
            <Link className="button button--primary" href="/telegram">Telegram steuern</Link>
            <Link className="button button--ghost" href="/dashboard">← Zurück zum Cockpit</Link>
          </div>
        </header>

        <section style={{ display: "grid", gridTemplateColumns: "minmax(0,1.5fr) repeat(3,minmax(130px,.5fr))", gap: 14, marginBottom: 18 }}>
          <article style={{ borderRadius: 16, padding: 22, background: campaign?.running ? "#10281f" : "#101827", color: "white" }}>
            <p style={{ margin: 0, color: "#9eb0c4", fontSize: 11, textTransform: "uppercase", letterSpacing: ".12em" }}>Kampagnen-Automation</p>
            <h2 style={{ margin: "9px 0 6px" }}>{campaign?.running ? "● Kampagne läuft" : "○ Vollständig pausiert"}</h2>
            <p style={{ margin: "0 0 16px", color: "#aab5c2", fontSize: 12 }}>{campaign?.running ? "Pro externem 5-Minuten-Aufruf wird maximal eine freigegebene E-Mail gesendet." : "Ohne dein Go wird keine Kampagnen-Mail automatisch versendet."}</p>
            {campaign?.running
              ? <button className="button button--ghost" onClick={() => void control("stop")} disabled={changing}>Kampagne sofort stoppen</button>
              : <button className="button button--primary" onClick={() => void control("start")} disabled={changing}>{changing ? "Bitte warten …" : "Kampagne starten"}</button>}
            {message && <p style={{ margin: "12px 0 0", color: "#ffd0b5", fontSize: 11 }}>{message}</p>}
          </article>
          {[["Laufend", stats.running, "#e8f2ff"], ["Erfolgreich", stats.completed, "#e9f8f1"], ["Fehler", stats.failed, "#fff0f0"]].map(([label, value, color]) => <article key={String(label)} style={{ border: "1px solid #e1e5e9", borderRadius: 16, background: String(color), padding: 20 }}><small style={{ color: "#6d7887" }}>{label}</small><strong style={{ display: "block", marginTop: 10, fontSize: 30 }}>{value}</strong></article>)}
        </section>

        <section style={{ border: "1px solid #e1e5e9", borderRadius: 16, overflow: "hidden", background: "white" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 12, padding: 18, borderBottom: "1px solid #e8ebee" }}>
            <div><strong>Prozessprotokoll</strong><small style={{ display: "block", marginTop: 4, color: "#8792a1" }}>Aktualisiert sich automatisch alle 15 Sekunden.</small></div>
            <div style={{ display: "flex", gap: 8 }}>
              <select value={filter} onChange={(event) => setFilter(event.target.value)} style={{ border: "1px solid #dfe3e8", borderRadius: 9, padding: "9px 12px", background: "white" }}><option value="all">Alle Status</option><option value="running">Laufend</option><option value="completed">Erfolgreich</option><option value="failed">Fehler</option></select>
              <button className="button button--soft" onClick={() => void refresh()}>Aktualisieren</button>
            </div>
          </div>
          <div style={{ overflowX: "auto" }}>
            <table><thead><tr><th>Zeit</th><th>Prozess</th><th>Lead</th><th>Status</th><th>Fortschritt</th><th>Dauer</th><th>Details / Fehler</th></tr></thead>
              <tbody>{logs.map((log) => {
                const start = log.startedAt ? new Date(log.startedAt) : new Date(log.createdAt);
                const end = log.finishedAt ? new Date(log.finishedAt) : null;
                const duration = end ? `${Math.max(0, Math.round((end.getTime() - start.getTime()) / 1000))} s` : log.status === "running" ? "läuft" : "—";
                return <tr key={log.id}><td>{new Date(log.createdAt).toLocaleString("de-DE", { dateStyle: "short", timeStyle: "medium" })}</td><td><strong>{processNames[log.type] || log.type}</strong></td><td>{log.company || "System"}</td><td><span className={`status status--${log.status === "completed" ? "termin" : log.status === "failed" ? "fehlgeschlagen" : "wird-erstellt"}`}><i />{log.status === "completed" ? "Erfolgreich" : log.status === "failed" ? "Fehler" : "Läuft"}</span></td><td>{log.progress || 0} %</td><td>{duration}</td><td style={{ maxWidth: 480, whiteSpace: "normal", color: log.error && log.status === "failed" ? "#b42318" : "#687587" }}>{log.error || "—"}</td></tr>;
              })}</tbody>
            </table>
            {!loading && logs.length === 0 && <div className="empty-state">Noch keine Prozesse für diesen Filter vorhanden.</div>}
            {loading && <div className="empty-state">Protokoll wird geladen …</div>}
          </div>
        </section>
      </div>
    </main>
  );
}
