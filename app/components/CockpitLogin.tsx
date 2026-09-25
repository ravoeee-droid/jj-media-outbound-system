"use client";

import { FormEvent, useState } from "react";
import styles from "./CockpitLogin.module.css";

const BASE_PATH = "/admin";
const PROTECTED_ROOTS = ["/dashboard", "/system", "/telegram", "/renderer-status"];

function safeAdminTarget(value: string | null) {
  if (!value || !value.startsWith(`${BASE_PATH}/`)) return `${BASE_PATH}/dashboard`;
  const scoped = value.slice(BASE_PATH.length);
  return PROTECTED_ROOTS.some((root) => scoped === root || scoped.startsWith(`${root}/`) || scoped.startsWith(`${root}?`) || scoped.startsWith(`${root}#`))
    ? value
    : `${BASE_PATH}/dashboard`;
}

export default function CockpitLogin() {
  const [email, setEmail] = useState("");
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
        body: JSON.stringify({ email: email.trim() || undefined, password }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Anmeldung fehlgeschlagen.");
      const requested = new URLSearchParams(window.location.search).get("next");
      window.location.assign(safeAdminTarget(requested));
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
          <p className={styles.eyebrow}>Growth OS</p>
          <h1>Leads.<br />Videos.<br /><em>Umsatzsignale.</em></h1>
          <p>Das interne JJ-Media-System bündelt Outbound, CRM, personalisierte Social-Analysevideos und Intelligence in einem geschützten Zugang.</p>
        </div>
        <div className={styles.flow}><span>Social Profil</span><i>→</i><span>Analysevideo</span><i>→</i><span>Termin</span></div>
      </section>

      <section className={styles.loginWrap}>
        <form className={styles.card} onSubmit={submit}>
          <p className={styles.eyebrow}>Geschützter Bereich</p>
          <h2>Growth OS öffnen</h2>
          <p>Mitarbeiter melden sich mit ihrer E-Mail und ihrem eigenen Passwort an. Der bestehende Adminzugang funktioniert weiterhin nur mit Passwort.</p>
          <label>
            <span>E-Mail <em>für Mitarbeiter</em></span>
            <input type="email" value={email} onChange={(event) => setEmail(event.target.value)} autoComplete="username" placeholder="name@jj-media.de" autoFocus />
          </label>
          <label>
            <span>Passwort</span>
            <input type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete="current-password" required />
          </label>
          {error && <div className={styles.error} role="alert">{error}</div>}
          <button type="submit" disabled={loading || !password}>{loading ? "Wird geprüft …" : "Growth OS öffnen →"}</button>
          <small>Jeder Mitarbeiter erhält einen eigenen Zugang. Rechte und Rollen verwaltet Jessica im Team-Bereich.</small>
        </form>
      </section>
    </main>
  );
}
