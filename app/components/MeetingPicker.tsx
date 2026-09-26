"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./MeetingPicker.module.css";

type Slot = {
  id: string;
  start: string;
  end: string;
  label: string;
  dayLabel: string;
};

type SlotPayload = {
  connected: boolean;
  slots: Slot[];
  owner: { id: string; name: string | null; email: string | null };
  canConnectSelf: boolean;
  connectUrl: string;
  profile: {
    timezone: string;
    durationMinutes: number;
    bufferMinutes: number;
  };
  error?: string;
};

type Booking = {
  eventId: string;
  joinUrl: string;
  start: string;
  end: string;
  label: string;
  attendeeInvited: boolean;
};

export default function MeetingPicker({
  leadId,
  onBooked,
  onManual,
  onCancel,
  source = "crm",
}: {
  leadId: string;
  onBooked: (booking: Booking) => void;
  onManual: () => void;
  onCancel: () => void;
  source?: "crm" | "daily_queue";
}) {
  const [payload, setPayload] = useState<SlotPayload | null>(null);
  const [selected, setSelected] = useState<Slot | null>(null);
  const [busy, setBusy] = useState("slots");
  const [error, setError] = useState("");

  async function load() {
    setBusy("slots");
    setError("");
    try {
      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "slots", leadId }),
      });
      const result = await response.json() as SlotPayload;
      if (!response.ok) throw new Error(result.error || "Freie Zeiten konnten nicht geladen werden.");
      setPayload(result);
      setSelected(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Freie Zeiten konnten nicht geladen werden.");
    } finally {
      setBusy("");
    }
  }

  useEffect(() => {
    void load();
    // leadId identifies the complete booking context.
  }, [leadId]);

  const groups = useMemo(() => {
    const map = new Map<string, Slot[]>();
    for (const slot of payload?.slots || []) {
      const list = map.get(slot.dayLabel) || [];
      list.push(slot);
      map.set(slot.dayLabel, list);
    }
    return [...map.entries()];
  }, [payload?.slots]);

  async function book() {
    if (!selected || busy) return;
    setBusy("book");
    setError("");
    try {
      const response = await fetch("/api/calendar", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "book", leadId, start: selected.start, source }),
      });
      const result = await response.json() as { booking?: Booking; error?: string };
      if (response.status === 409) {
        setError(result.error || "Dieser Slot ist nicht mehr frei.");
        await load();
        return;
      }
      if (!response.ok || !result.booking) throw new Error(result.error || "Termin konnte nicht gebucht werden.");
      onBooked(result.booking);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Termin konnte nicht gebucht werden.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.root}>
      <div className={styles.head}>
        <div>
          <small>GOOGLE KALENDER</small>
          <strong>{payload?.owner?.name || payload?.owner?.email || "Zuständiger Mitarbeiter"}</strong>
          {payload?.profile && <span>{payload.profile.durationMinutes} Min · {payload.profile.timezone} · {payload.profile.bufferMinutes} Min Puffer</span>}
        </div>
        <button type="button" onClick={onCancel}>×</button>
      </div>

      {busy === "slots" && <div className={styles.loading}><i /> Freie Zeiten werden geprüft …</div>}

      {!busy && payload && !payload.connected && (
        <div className={styles.connect}>
          <strong>Kalender noch nicht verbunden.</strong>
          <p>{payload.canConnectSelf ? "Verbinde einmal dein Google-Konto. Danach erscheinen hier nur echte freie Zeiten." : "Der zuständige Mitarbeiter muss seinen Google-Kalender einmal in seinem eigenen Zugang verbinden."}</p>
          {payload.canConnectSelf && payload.connectUrl && <a href={payload.connectUrl}>Google Kalender verbinden ↗</a>}
        </div>
      )}

      {!busy && payload?.connected && groups.length > 0 && (
        <div className={styles.days}>
          {groups.map(([day, slots]) => (
            <div className={styles.day} key={day}>
              <strong>{day}</strong>
              <div>
                {slots.map((slot) => (
                  <button
                    type="button"
                    key={slot.id}
                    className={selected?.id === slot.id ? styles.slotSelected : styles.slot}
                    onClick={() => setSelected(slot)}
                  >
                    {new Intl.DateTimeFormat("de-DE", {
                      timeZone: payload.profile.timezone,
                      hour: "2-digit",
                      minute: "2-digit",
                    }).format(new Date(slot.start))}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {!busy && payload?.connected && !groups.length && (
        <div className={styles.connect}><strong>Keine freien Zeiten gefunden.</strong><p>In den nächsten 14 Tagen passt aktuell kein Slot zu den Arbeitszeit- und Pufferregeln.</p></div>
      )}

      {selected && (
        <div className={styles.confirm}>
          <div><small>AUSGEWÄHLT</small><strong>{selected.label}</strong></div>
          <button type="button" onClick={() => void book()} disabled={Boolean(busy)}>{busy === "book" ? "Bucht …" : "Google Meet verbindlich buchen"}</button>
        </div>
      )}

      {error && <div className={styles.error}>{error}</div>}

      <div className={styles.foot}>
        <button type="button" onClick={() => void load()} disabled={Boolean(busy)}>Zeiten neu prüfen</button>
        <button type="button" onClick={onManual}>Zeit manuell eintragen</button>
      </div>
    </section>
  );
}
