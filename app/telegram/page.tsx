"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

export default function TelegramSetupPage() {
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [activating, setActivating] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    fetch("/api/telegram/setup", { cache: "no-store" })
      .then(async (response) => ({ ok: response.ok, payload: await response.json() }))
      .then(({ ok, payload }) => { setConfigured(Boolean(payload.configured)); if (!ok) setMessage(payload.error || "Status konnte nicht geladen werden."); })
      .catch(() => setMessage("Telegram-Status konnte nicht geladen werden."));
  }, []);

  async function activate() {
    setActivating(true);
    setMessage("");
    const response = await fetch("/api/telegram/setup", { method: "POST" });
    const payload = await response.json();
    setMessage(response.ok ? "Telegram-Steuerzentrale wurde aktiviert. Prüfe jetzt den Chat und sende /status." : payload.error || "Aktivierung fehlgeschlagen.");
    setConfigured(response.ok);
    setActivating(false);
  }

  return (
    <main style={{ minHeight: "100vh", background: "#f3f5f7", padding: 28, color: "#17202e" }}>
      <div style={{ width: "min(900px,100%)", margin: "0 auto" }}>
        <header style={{ display: "flex", justifyContent: "space-between", gap: 16, alignItems: "center", marginBottom: 22 }}>
          <div><p className="eyebrow">Mobile Steuerzentrale</p><h1 style={{ margin: 0 }}>Telegram Bot</h1></div>
          <Link className="button button--ghost" href="/system">← System-Logs</Link>
        </header>
        <section style={{ border: "1px solid #e1e5e9", borderRadius: 18, background: "#fff", padding: 28 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ width: 12, height: 12, borderRadius: 99, background: configured ? "#29b173" : "#d99a25" }} />
            <strong>{configured === null ? "Status wird geprüft …" : configured ? "Zugangsdaten erkannt" : "Telegram noch nicht vollständig konfiguriert"}</strong>
          </div>
          <p style={{ color: "#687587", lineHeight: 1.7 }}>Die Aktivierung registriert den sicheren Webhook, begrenzt Befehle auf deine Chat-ID und installiert das Befehlsmenü direkt im Telegram-Chat.</p>
          <button className="button button--primary" onClick={() => void activate()} disabled={!configured || activating}>{activating ? "Wird aktiviert …" : "Telegram-Steuerzentrale aktivieren"}</button>
          {message && <p style={{ marginTop: 14, borderRadius: 10, background: "#f5f7f9", padding: 13, color: "#465365" }}>{message}</p>}
        </section>
        <section style={{ display: "grid", gridTemplateColumns: "repeat(2,minmax(0,1fr))", gap: 14, marginTop: 16 }}>
          {[
            ["Steuern", "/status · /start · /stop · /pause"],
            ["Leads", "/queue · /next · /best sowie Aktionsbuttons"],
            ["Ergebnisse", "/heute · /woche · /performance"],
            ["Sicherheit", "Chat-ID-Sperre, Bestätigung, Tageslimit, Auto-Stopp"],
            ["Versand", "/limit · /zeiten · /intervall"],
            ["Diagnose", "/errors · /logs und direkte Systemlinks"],
          ].map(([title, detail]) => <article key={title} style={{ border: "1px solid #e1e5e9", borderRadius: 14, background: "#fff", padding: 19 }}><strong>{title}</strong><p style={{ marginBottom: 0, color: "#718093", lineHeight: 1.6 }}>{detail}</p></article>)}
        </section>
      </div>
    </main>
  );
}
