"use client";

import { useEffect, useState } from "react";
import styles from "./CalendarProfileSettings.module.css";

type Profile = {
  calendarId: string;
  timezone: string;
  durationMinutes: number;
  noticeHours: number;
  startHour: number;
  endHour: number;
  bufferMinutes: number;
  weekdays: number[];
};

type Payload = {
  connected: boolean;
  profile: Profile;
  user: { id: string; name: string | null; email: string | null };
  connectUrl: string;
  error?: string;
};

const dayLabels = ["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"];

export default function CalendarProfileSettings() {
  const [data, setData] = useState<Payload | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/calendar", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json() as Payload;
        if (!response.ok) throw new Error(payload.error || "Kalenderprofil konnte nicht geladen werden.");
        if (!active) return;
        setData(payload);
        setProfile(payload.profile);
      })
      .catch((error) => { if (active) setMessage(error instanceof Error ? error.message : "Kalenderprofil konnte nicht geladen werden."); })
      .finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, []);

  async function save() {
    if (!profile || busy) return;
    setBusy(true);
    setMessage("");
    try {
      const response = await fetch("/api/calendar", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(profile),
      });
      const payload = await response.json() as { profile?: Profile; error?: string };
      if (!response.ok || !payload.profile) throw new Error(payload.error || "Kalenderregeln konnten nicht gespeichert werden.");
      setProfile(payload.profile);
      setMessage("Kalenderregeln gespeichert.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Kalenderregeln konnten nicht gespeichert werden.");
    } finally {
      setBusy(false);
    }
  }

  function toggleDay(day: number) {
    if (!profile) return;
    const exists = profile.weekdays.includes(day);
    const next = exists ? profile.weekdays.filter((item) => item !== day) : [...profile.weekdays, day].sort((a, b) => a - b);
    if (!next.length) return;
    setProfile({ ...profile, weekdays: next });
  }

  if (!profile || !data) {
    return <section className={styles.root}><div className={styles.loading}>{busy ? "Kalenderprofil wird geladen …" : message}</div></section>;
  }

  return (
    <section className={styles.root}>
      <div className={styles.head}>
        <div>
          <small>PERSÖNLICHER TERMIN-KALENDER</small>
          <h2>{data.user.name || data.user.email || "Google Kalender"}</h2>
          <p>Diese Regeln gelten für Leads, die dir gehören. Vor jeder Buchung prüft das System die echte Google-Verfügbarkeit erneut.</p>
        </div>
        <span data-ready={data.connected ? "yes" : "no"}>{data.connected ? "VERBUNDEN" : "NICHT VERBUNDEN"}</span>
      </div>

      <div className={styles.connection}>
        <div>
          <strong>{data.connected ? "Google Kalender ist bereit." : "Einmal Google Kalender verbinden."}</strong>
          <p>Benötigt werden nur Kalender-Verfügbarkeit und Event-Erstellung. Der E-Mail-Versand bleibt weiterhin bei STRATO.</p>
        </div>
        <a href={data.connectUrl}>{data.connected ? "Kalenderzugriff erneuern" : "Google Kalender verbinden"} ↗</a>
      </div>

      <div className={styles.grid}>
        <label><span>Kalender-ID</span><input value={profile.calendarId} onChange={(event) => setProfile({ ...profile, calendarId: event.target.value })} placeholder="primary" /></label>
        <label><span>Zeitzone</span><select value={profile.timezone} onChange={(event) => setProfile({ ...profile, timezone: event.target.value })}><option>Europe/Berlin</option><option>Asia/Bangkok</option><option>Europe/Madrid</option><option>UTC</option></select></label>
        <label><span>Gesprächsdauer</span><select value={profile.durationMinutes} onChange={(event) => setProfile({ ...profile, durationMinutes: Number(event.target.value) })}>{[15,30,45,60].map((value) => <option value={value} key={value}>{value} Minuten</option>)}</select></label>
        <label><span>Vorlauf</span><select value={profile.noticeHours} onChange={(event) => setProfile({ ...profile, noticeHours: Number(event.target.value) })}>{[0,1,2,4,8,24,48].map((value) => <option value={value} key={value}>{value} Stunden</option>)}</select></label>
        <label><span>Termine ab</span><input type="number" min={0} max={22} value={profile.startHour} onChange={(event) => setProfile({ ...profile, startHour: Number(event.target.value) })} /></label>
        <label><span>Termine bis</span><input type="number" min={1} max={24} value={profile.endHour} onChange={(event) => setProfile({ ...profile, endHour: Number(event.target.value) })} /></label>
        <label><span>Puffer</span><select value={profile.bufferMinutes} onChange={(event) => setProfile({ ...profile, bufferMinutes: Number(event.target.value) })}>{[0,10,15,20,30,45,60].map((value) => <option value={value} key={value}>{value} Minuten</option>)}</select></label>
      </div>

      <div className={styles.weekdays}>
        <span>Arbeitstage</span>
        <div>{dayLabels.map((label, index) => <button type="button" key={label} data-active={profile.weekdays.includes(index + 1) ? "yes" : "no"} onClick={() => toggleDay(index + 1)}>{label}</button>)}</div>
      </div>

      <div className={styles.actions}>
        {message && <span>{message}</span>}
        <button type="button" disabled={busy} onClick={() => void save()}>{busy ? "Speichert …" : "Kalenderregeln speichern"}</button>
      </div>
    </section>
  );
}
