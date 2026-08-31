"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "./SystemReadiness.module.css";

type HealthPayload = {
  manualReady: boolean;
  automaticReady: boolean;
  checks: Record<string, { ok: boolean; label: string; detail: string }>;
  counts: { leads: number; readyLeads: number; openTasks: number; scheduledFollowups: number };
};

export default function SystemReadiness({ compact = false }: { compact?: boolean }) {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState("");

  const load = useCallback(() => {
    setError("");
    fetch("/api/health")
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(payload.error || "Systemcheck fehlgeschlagen.");
        return payload as HealthPayload;
      })
      .then(setHealth)
      .catch((caught) => setError(caught instanceof Error ? caught.message : "Systemcheck fehlgeschlagen."));
  }, []);

  useEffect(() => load(), [load]);

  if (compact) {
    return (
      <div className={styles.compact}>
        <div><span className={health?.manualReady ? styles.okDot : styles.warnDot} /><strong>{health?.manualReady ? "Manuell versandbereit" : "Einrichtung offen"}</strong></div>
        <p>{health ? `${health.counts.readyLeads} von ${health.counts.leads} Leads bereit` : error || "System wird geprüft …"}</p>
        <button onClick={load}>Neu prüfen</button>
      </div>
    );
  }

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <div>
          <small>Live-Systemcheck</small>
          <h3>{health?.automaticReady ? "Vollautomatisch bereit" : health?.manualReady ? "Manueller Versand bereit" : "Einrichtung unvollständig"}</h3>
        </div>
        <button onClick={load}>Erneut prüfen</button>
      </div>
      {error && <div className={styles.error}>{error}</div>}
      <div className={styles.grid}>
        {health
          ? Object.entries(health.checks).map(([key, check]) => (
              <article className={check.ok ? styles.ready : styles.open} key={key}>
                <span>{check.ok ? "✓" : "!"}</span>
                <div><strong>{check.label}</strong><small>{check.detail}</small></div>
              </article>
            ))
          : <p>Alle Dienste werden geprüft …</p>}
      </div>
      {health && (
        <div className={styles.counts}>
          <span><strong>{health.counts.leads}</strong> Leads</span>
          <span><strong>{health.counts.readyLeads}</strong> bereit</span>
          <span><strong>{health.counts.openTasks}</strong> Aufgaben</span>
          <span><strong>{health.counts.scheduledFollowups}</strong> Follow-ups geplant</span>
        </div>
      )}
    </section>
  );
}
