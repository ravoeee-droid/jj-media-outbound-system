"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import styles from "./ManagerCockpit.module.css";

type Range = 1 | 7 | 30;

type Person = {
  userId: string;
  name: string;
  email: string;
  role: string;
  calendarConnected: boolean;
  calls: number;
  connected: number;
  noAnswer: number;
  infoRequested: number;
  infoSent: number;
  followupsSent: number;
  whatsappRequested: number;
  whatsappSent: number;
  booked: number;
  queue: number;
  callbacks: number;
  highPriority: number;
  openTasks: number;
  overdueTasks: number;
  contactRate: number;
  bookingRate: number;
};

type Payload = {
  range: Range;
  canViewTeam: boolean;
  generatedAt: string;
  totals: {
    calls: number;
    connected: number;
    noAnswer: number;
    infoRequested: number;
    infoSent: number;
    whatsappRequested: number;
    whatsappSent: number;
    booked: number;
    queue: number;
    openTasks: number;
    overdueTasks: number;
    contactRate: number;
    bookingRate: number;
  };
  people: Person[];
  alerts: Array<{ tone: "critical" | "warn" | "good"; title: string; detail: string; href: string }>;
  system: {
    failedJobs: number;
    failedOutreach: number;
    failedWhatsapp: number;
    techErrors: number;
    callReadyPool: number;
    researchEnabled: boolean;
    researchLastRun: string | null;
    supplyEnabled: boolean;
    supplyTarget: number;
    supplySelectedCallers: number;
    supplyLastRun: string | null;
  };
  error?: string;
};

function when(value: string | null) {
  if (!value) return "Noch kein Lauf";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function statusFor(person: Person) {
  if (person.overdueTasks > 0 || person.queue === 0) return "critical";
  if (person.queue < 5) return "warn";
  return "good";
}

export default function ManagerCockpit() {
  const [range, setRange] = useState<Range>(1);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async (nextRange: Range, silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const response = await fetch("/api/manager-dashboard?range=" + nextRange, { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "KPI-Cockpit konnte nicht geladen werden.");
      setData(payload);
      setError("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "KPI-Cockpit konnte nicht geladen werden.");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { void load(range); }, [range, load]);

  useEffect(() => {
    const timer = window.setInterval(() => void load(range, true), 60_000);
    return () => window.clearInterval(timer);
  }, [range, load]);

  const periodLabel = range === 1 ? "Heute" : range === 7 ? "7 Tage" : "30 Tage";
  const metrics = useMemo(() => {
    if (!data) return [];
    return [
      { label: "Calls", value: data.totals.calls, note: data.totals.noAnswer + " nicht erreicht" },
      { label: "Gespräche", value: data.totals.connected, note: data.totals.contactRate + "% Kontaktquote" },
      { label: "Info gesendet", value: data.totals.infoSent, note: data.totals.infoRequested + " Info-Wünsche" },
      { label: "WhatsApp", value: data.totals.whatsappSent, note: data.totals.whatsappRequested + " gewünscht" },
      { label: "Termine", value: data.totals.booked, note: data.totals.bookingRate + "% Gespräch → Termin" },
      { label: "Offene Calls", value: data.totals.queue, note: data.system.callReadyPool + " zusätzlich im Vorrat" },
    ];
  }, [data]);

  if (loading && !data) return <div className={styles.loading}>Manager-Cockpit wird geladen …</div>;

  return (
    <div className={styles.root}>
      <section className={styles.toolbar}>
        <div className={styles.rangeTabs}>
          {([1, 7, 30] as Range[]).map((value) => (
            <button key={value} type="button" data-active={range === value ? "yes" : "no"} onClick={() => setRange(value)}>
              {value === 1 ? "Heute" : value + " Tage"}
            </button>
          ))}
        </div>
        <div className={styles.live}>
          <span data-active={refreshing ? "yes" : "no"} />
          <div><strong>{refreshing ? "Aktualisiert …" : "Live"}</strong><small>{data ? "Stand " + when(data.generatedAt) : ""}</small></div>
          <button type="button" onClick={() => void load(range, true)} disabled={refreshing}>↻</button>
        </div>
      </section>

      {error && <div className={styles.error}>{error}</div>}

      <section className={styles.metrics}>
        {metrics.map((metric) => (
          <article key={metric.label}>
            <small>{metric.label}</small>
            <strong>{metric.value}</strong>
            <span>{metric.note}</span>
          </article>
        ))}
      </section>

      <section className={styles.mainGrid}>
        <article className={styles.alertCard}>
          <div className={styles.cardHead}>
            <div><small>HANDLUNGSBEDARF</small><h2>Was Jessica jetzt wissen muss</h2></div>
            <span>{periodLabel}</span>
          </div>
          <div className={styles.alerts}>
            {data?.alerts.map((alert, index) => (
              <Link href={alert.href} key={index} className={styles.alert} data-tone={alert.tone}>
                <i />
                <div><strong>{alert.title}</strong><p>{alert.detail}</p></div>
                <span>→</span>
              </Link>
            ))}
          </div>
        </article>

        <article className={styles.systemCard}>
          <div className={styles.cardHead}><div><small>SYSTEM</small><h2>Nachschub & Technik</h2></div><Link href="/system">Details →</Link></div>
          <div className={styles.systemList}>
            <div><span className={data?.system.researchEnabled ? styles.ok : styles.off} /><div><strong>Lead Scout</strong><small>{data?.system.researchEnabled ? "Automatisch aktiv" : "Manuell / pausiert"} · {when(data?.system.researchLastRun || null)}</small></div></div>
            <div><span className={data?.system.supplyEnabled ? styles.ok : styles.off} /><div><strong>Auto-Nachschub</strong><small>{data?.system.supplyEnabled ? String(data.system.supplySelectedCallers) + " Caller · Ziel " + String(data.system.supplyTarget) : "Nicht aktiviert"} · {when(data?.system.supplyLastRun || null)}</small></div></div>
            <div><span className={(data?.system.callReadyPool || 0) >= 10 ? styles.ok : styles.warn} /><div><strong>Call-ready Vorrat</strong><small>{data?.system.callReadyPool || 0} validierte Kandidaten</small></div></div>
            <div><span className={(data?.system.techErrors || 0) === 0 ? styles.ok : styles.bad} /><div><strong>Technik letzte 24h</strong><small>{data?.system.techErrors || 0} Fehler · Jobs {data?.system.failedJobs || 0} · Mail {data?.system.failedOutreach || 0} · WhatsApp {data?.system.failedWhatsapp || 0}</small></div></div>
          </div>
        </article>
      </section>

      <section className={styles.teamCard}>
        <div className={styles.cardHead}>
          <div>
            <small>{data?.canViewTeam ? "TEAM PERFORMANCE" : "MEINE PERFORMANCE"}</small>
            <h2>{data?.canViewTeam ? "Wer hat genug Arbeit – und was kommt dabei raus?" : "Dein aktueller Arbeitsstand"}</h2>
          </div>
          <Link href="/dashboard/queue">Tages-Queue öffnen →</Link>
        </div>

        <div className={styles.tableWrap}>
          <table>
            <thead>
              <tr>
                <th>Mitarbeiter</th>
                <th>Queue</th>
                <th>Calls</th>
                <th>Gespräche</th>
                <th>Info</th>
                <th>WhatsApp</th>
                <th>Termine</th>
                <th>Conversion</th>
                <th>Aufgaben</th>
              </tr>
            </thead>
            <tbody>
              {data?.people.map((person) => (
                <tr key={person.userId}>
                  <td>
                    <div className={styles.person}>
                      <i data-tone={statusFor(person)} />
                      <div><strong>{person.name}</strong><small>{person.role} · {person.calendarConnected ? "Kalender ✓" : "Kalender offen"}</small></div>
                    </div>
                  </td>
                  <td><strong>{person.queue}</strong><small>{person.callbacks} Rückrufe · {person.highPriority} Prio</small></td>
                  <td><strong>{person.calls}</strong><small>{person.noAnswer} nicht erreicht</small></td>
                  <td><strong>{person.connected}</strong><small>{person.contactRate}% Quote</small></td>
                  <td><strong>{person.infoSent}</strong><small>{person.infoRequested} gewünscht</small></td>
                  <td><strong>{person.whatsappSent}</strong><small>{person.whatsappRequested} gewünscht</small></td>
                  <td><strong>{person.booked}</strong><small>{periodLabel}</small></td>
                  <td><span className={styles.rate}>{person.bookingRate}%</span><small>Gespräch → Termin</small></td>
                  <td><strong className={person.overdueTasks ? styles.overdue : ""}>{person.openTasks}</strong><small>{person.overdueTasks ? String(person.overdueTasks) + " überfällig" : "nichts überfällig"}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {!data?.people.length && <div className={styles.empty}>Noch keine aktiven Mitarbeiterdaten vorhanden.</div>}
        </div>
      </section>

      <section className={styles.funnel}>
        <div><small>CALLS</small><strong>{data?.totals.calls || 0}</strong></div>
        <span>→</span>
        <div><small>GESPRÄCHE</small><strong>{data?.totals.connected || 0}</strong></div>
        <span>→</span>
        <div><small>INFO / WHATSAPP</small><strong>{(data?.totals.infoRequested || 0) + (data?.totals.whatsappRequested || 0)}</strong></div>
        <span>→</span>
        <div><small>TERMINE</small><strong>{data?.totals.booked || 0}</strong></div>
      </section>
    </div>
  );
}
