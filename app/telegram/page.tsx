"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import AdminShell from "../components/AdminShell";
import styles from "./TelegramSetup.module.css";

const features = [
  ["01", "Steuern", "/status · /start · /stop · /pause"],
  ["02", "Leads", "/queue · /next · /best sowie Aktionsbuttons"],
  ["03", "Ergebnisse", "/heute · /woche · /performance"],
  ["04", "Sicherheit", "Chat-ID-Sperre, Bestätigung, Tageslimit und Auto-Stopp"],
  ["05", "Versand", "/limit · /zeiten · /intervall"],
  ["06", "Diagnose", "/errors · /logs und direkte Systemlinks"],
] as const;

export default function TelegramSetupPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/telegram/setup", { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, payload: await response.json() }))
      .then(({ ok, payload }) => {
        setConfigured(Boolean(payload.configured));
        if (!ok) setMessage(payload.error || "Status konnte nicht geladen werden.");
      })
      .catch(() => setMessage("Telegram-Status konnte nicht geladen werden."));
  }, []);

  async function activate() {
    setActivating(true);
    setMessage("");
    try {
      const response = await fetch("/api/telegram/setup", { method: "POST" });
      const payload = await response.json();
      setMessage(response.ok ? "Telegram-Steuerzentrale wurde aktiviert. Öffne den Chat und sende /status." : payload.error || "Aktivierung fehlgeschlagen.");
      setConfigured(response.ok);
    } finally {
      setActivating(false);
    }
  }

  return (
    <AdminShell
      active="system"
      eyebrow="Mobile Operations"
      title="Telegram als sichere Fernsteuerung."
      description="Status prüfen, Kampagnen kontrollieren, Leads priorisieren und Fehler sehen – ohne dafür jedes Mal das Dashboard öffnen zu müssen."
      actions={<Link href="/system">Systemsteuerung</Link>}
    >
      <div className={styles.stack}>
        <section className={styles.mainCard}>
          <div className={styles.status}>
            <span className={configured ? styles.statusDotLive : styles.statusDot} />
            <strong>{configured === null ? "Status wird geprüft …" : configured ? "Telegram-Zugangsdaten erkannt" : "Telegram noch nicht vollständig konfiguriert"}</strong>
          </div>
          <p>Die Aktivierung registriert den sicheren Webhook, begrenzt Befehle auf die hinterlegte Chat-ID und installiert das Befehlsmenü direkt im Telegram-Chat.</p>
          <button onClick={() => void activate()} disabled={!configured || activating}>{activating ? "Wird aktiviert …" : "Telegram-Steuerzentrale aktivieren"}</button>
          {message && <p className={styles.message}>{message}</p>}
        </section>

        <section className={styles.grid}>
          {features.map(([number, title, detail]) => (
            <article className={styles.feature} key={title}>
              <small>{number}</small>
              <strong>{title}</strong>
              <p>{detail}</p>
            </article>
          ))}
        </section>
      </div>
    </AdminShell>
  );
}
