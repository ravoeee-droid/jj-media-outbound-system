"use client";

import { FormEvent, useState } from "react";
import styles from "./CockpitLogin.module.css";

export default function CockpitLogin() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError("");
    try {
      const response = await fetch("/api/cockpit/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Anmeldung fehlgeschlagen.");
      const target = new URLSearchParams(window.location.search).get("next");
      window.location.assign(target?.startsWith("/dashboard") ? target : "/dashboard");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Anmeldung fehlgeschlagen.");
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.story}>
        <div className={styles.brand}><span>JJ</span><strong>JJ-Media</strong></div>
        <div>
          <p className={styles.eyebrow}>Social Audit Engine</p>
          <h1>Dein System.<br />Deine Leads.<br /><em>Ein Zugang.</em></h1>
          <p>Das Cockpit ist geschützt. Persönliche Kundenseiten bleiben weiterhin ohne Anmeldung erreichbar.</p>
        </div>
        <div className={styles.flow}><span>Instagram</span><i>→</i><span>Analysevideo</span><i>→</i><span>Termin</span></div>
      </section>

      <section className={styles.loginWrap}>
        <form className={styles.card} onSubmit={submit}>
          <p className={styles.eyebrow}>Geschützter Bereich</p>
          <h2>Cockpit öffnen</h2>
          <p>Gib dein Passwort ein. Die Anmeldung bleibt auf diesem Gerät 30 Tage aktiv.</p>
          <label>
            <span>Passwort</span>
            <input
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </label>
          {error && <div className={styles.error} role="alert">{error}</div>}
          <button type="submit" disabled={loading || !password}>
            {loading ? "Wird geprüft …" : "Cockpit öffnen →"}
          </button>
          <small>Nur das interne Cockpit ist geschützt. Videolinks für Leads funktionieren öffentlich.</small>
        </form>
      </section>
    </main>
  );
}
