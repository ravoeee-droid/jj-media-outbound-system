"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./SystemReadiness.module.css";

type Check = {
  key: string;
  ok: boolean;
  level: "required" | "automation" | "recommended";
  label: string;
  detail: string;
  actionHref?: string;
};

type HealthPayload = {
  deep: boolean;
  launchReady: boolean;
  automationReady: boolean;
  warnings: number;
  blockers: number;
  status: "blocked" | "ready_with_warnings" | "ready";
  checks: Check[];
  counts: {
    leads: number;
    callReadyLeads: number;
    callReadyPool: number;
    openTasks: number;
    overdueTasks: number;
    scheduledFollowups: number;
    callers: number;
    calendarsConnected: number;
  };
  callerQueues: Array<{
    userId: string;
    name: string;
    total: number;
    callbacks: number;
    highPriority: number;
    calendarConnected: boolean;
    autoSupplySelected: boolean;
  }>;
  automation: {
    researchEnabled: boolean;
    supplyEnabled: boolean;
    whatsappEnabled: boolean;
  };
};

const levelLabel = {
  required: "Startkritisch",
  automation: "Aktive Automationen",
  recommended: "Empfohlen / Betriebsqualität",
} as const;

export default function SystemReadiness({ compact = false }: { compact?: boolean }) {
  const [health, setHealth] = useState<HealthPayload | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState<"" | "standard" | "deep">("");

  const load = useCallback(async (deep = false) => {
    setBusy(deep ? "deep" : "standard");
    setError("");
    try {
      const response = await fetch("/api/health" + (deep ? "?deep=1" : ""), { cache: "no-store" });
      const payload = await response.json() as HealthPayload & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Systemcheck fehlgeschlagen.");
      setHealth(payload);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Systemcheck fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  }, []);

  useEffect(() => { void load(false); }, [load]);

  const grouped = useMemo(() => {
    const source = health?.checks || [];
    return (["required", "automation", "recommended"] as const).map((level) => ({
      level,
      checks: source.filter((item) => item.level === level),
    }));
  }, [health?.checks]);

  if (compact) {
    return (
      <div className={styles.compact}>
        <div>
          <span className={health?.launchReady ? styles.okDot : styles.warnDot} />
          <strong>{health?.launchReady ? "Launch-Basis bereit" : "Launch-Blocker offen"}</strong>
        </div>
        <p>
          {health
            ? String(health.blockers) + " Blocker · " + String(health.warnings) + " Warnungen"
            : error || "System wird geprüft …"}
        </p>
        <button onClick={() => void load(false)} disabled={Boolean(busy)}>Neu prüfen</button>
      </div>
    );
  }

  const title = !health
    ? "System wird geprüft …"
    : health.status === "blocked"
      ? "Noch nicht vollständig startklar."
      : health.status === "ready_with_warnings"
        ? "Startklar – mit offenen Warnungen."
        : "Produktionsbereit.";

  return (
    <section className={styles.panel}>
      <div className={styles.head}>
        <div>
          <small>LAUNCH QA · READ ONLY</small>
          <h3>{title}</h3>
          <p>Der Check verändert keine Leads, sendet keine Nachrichten und bucht keine Termine.</p>
        </div>
        <div className={styles.actions}>
          <button onClick={() => void load(false)} disabled={Boolean(busy)}>
            {busy === "standard" ? "Prüft …" : "Schnellcheck"}
          </button>
          <button className={styles.deepButton} onClick={() => void load(true)} disabled={Boolean(busy)}>
            {busy === "deep" ? "Renderer + Mail werden geprüft …" : "Tiefencheck"}
          </button>
        </div>
      </div>

      {error && <div className={styles.error}>{error}</div>}

      {health && (
        <>
          <div className={styles.verdict} data-status={health.status}>
            <div>
              <span>{health.status === "blocked" ? "!" : "✓"}</span>
              <div>
                <strong>{health.launchReady ? "Launch-Basis OK" : String(health.blockers) + " Startblocker"}</strong>
                <small>{health.automationReady ? "Alle aktivierten Automationen sind bereit." : "Mindestens eine aktivierte Automation braucht Aufmerksamkeit."}</small>
              </div>
            </div>
            <div className={styles.verdictStats}>
              <span><strong>{health.blockers}</strong> Blocker</span>
              <span><strong>{health.warnings}</strong> Warnungen</span>
              <span><strong>{health.deep ? "JA" : "NEIN"}</strong> Tiefencheck</span>
            </div>
          </div>

          <div className={styles.metrics}>
            <div><small>CALLER</small><strong>{health.counts.callers}</strong><span>{health.counts.calendarsConnected} Kalender verbunden</span></div>
            <div><small>QUEUE</small><strong>{health.counts.callReadyLeads}</strong><span>call-bereit / fällig</span></div>
            <div><small>SCOUT-VORRAT</small><strong>{health.counts.callReadyPool}</strong><span>Call-ready Kandidaten</span></div>
            <div><small>AUFGABEN</small><strong>{health.counts.openTasks}</strong><span>{health.counts.overdueTasks} überfällig</span></div>
            <div><small>FOLLOW-UPS</small><strong>{health.counts.scheduledFollowups}</strong><span>geplant</span></div>
          </div>

          {grouped.map((group) => (
            <section className={styles.group} key={group.level}>
              <div className={styles.groupHead}>
                <strong>{levelLabel[group.level]}</strong>
                <span>{group.checks.filter((item) => item.ok).length}/{group.checks.length} OK</span>
              </div>
              <div className={styles.grid}>
                {group.checks.map((item) => (
                  <article className={item.ok ? styles.ready : styles.open} key={item.key}>
                    <span>{item.ok ? "✓" : "!"}</span>
                    <div>
                      <strong>{item.label}</strong>
                      <small>{item.detail}</small>
                    </div>
                    {item.actionHref && !item.ok && <a href={item.actionHref}>Öffnen ↗</a>}
                  </article>
                ))}
              </div>
            </section>
          ))}

          <section className={styles.queueSection}>
            <div className={styles.groupHead}>
              <strong>Caller-Abnahme</strong>
              <span>{health.callerQueues.length} Konten</span>
            </div>
            {health.callerQueues.length ? (
              <div className={styles.queueGrid}>
                {health.callerQueues.map((caller) => (
                  <article key={caller.userId}>
                    <div><strong>{caller.name}</strong><small>{caller.autoSupplySelected ? "Auto-Nachschub ausgewählt" : "manuelle Queue"}</small></div>
                    <span><b>{caller.total}</b> Calls</span>
                    <span>{caller.callbacks} Rückrufe</span>
                    <span>{caller.highPriority} Prio</span>
                    <em data-ok={caller.calendarConnected ? "yes" : "no"}>{caller.calendarConnected ? "Kalender ✓" : "Kalender offen"}</em>
                  </article>
                ))}
              </div>
            ) : <div className={styles.empty}>Noch kein aktiver Caller vorhanden.</div>}
          </section>
        </>
      )}
    </section>
  );
}
