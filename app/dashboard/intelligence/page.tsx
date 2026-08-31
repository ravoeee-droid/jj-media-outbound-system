import Link from "next/link";
import AdminShell from "../../components/AdminShell";
import styles from "../AdminModule.module.css";

const sources = [
  { name: "Microsoft Clarity", ready: Boolean(process.env.CLARITY_API_TOKEN), purpose: "Scrolltiefe, Engagement, Rage/Dead Clicks, Quickbacks und technische Friktion", env: "CLARITY_API_TOKEN" },
  { name: "Google Search Console", ready: Boolean(process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL), purpose: "Suchbegriffe, Positionen, Impressionen, Klicks und CTR", env: "GOOGLE_SEARCH_CONSOLE_SITE_URL" },
  { name: "PageSpeed / CrUX", ready: Boolean(process.env.PAGESPEED_API_KEY), purpose: "Core Web Vitals, Lighthouse und technische Chancen", env: "PAGESPEED_API_KEY" },
  { name: "Google Business Profile", ready: Boolean(process.env.GOOGLE_BUSINESS_ACCOUNT_ID), purpose: "Maps-Sichtbarkeit, Anrufe, Website-Klicks und lokale Nachfrage", env: "GOOGLE_BUSINESS_ACCOUNT_ID" },
  { name: "GA4", ready: Boolean(process.env.GA4_PROPERTY_ID), purpose: "Traffic-Quellen, Kampagnen, Events und Conversion-Pfade", env: "GA4_PROPERTY_ID" },
  { name: "Uptime / Monitoring", ready: Boolean(process.env.UPTIME_KUMA_URL), purpose: "Erreichbarkeit, Response-Zeit, Fehler und SSL-Warnungen", env: "UPTIME_KUMA_URL" },
];

export default function IntelligencePage() {
  const ready = sources.filter((source) => source.ready).length;
  return (
    <AdminShell
      active="intelligence"
      eyebrow="Growth Intelligence"
      title="Aus Daten werden nächste Schritte."
      description="Diese Schicht verbindet Akquise-, Website-, SEO- und Verhaltensdaten. Wir zeigen nicht nur Charts, sondern priorisieren konkrete Chancen und Probleme."
      actions={<Link href="/dashboard/integrations">Datenquellen verbinden</Link>}
    >
      <section className={styles.heroCard}>
        <div><small>INTELLIGENCE SETUP</small><strong>{ready}/{sources.length}</strong><p>Datenquellen eingerichtet</p></div>
        <div className={styles.heroText}><h2>Ein Gehirn über dem gesamten Kundengewinnungssystem.</h2><p>Lead-Daten und personalisierte Video-Signale sind bereits nativ vorhanden. Externe Quellen werden erst dann als echte Live-Daten ausgewertet, wenn die jeweilige API erfolgreich antwortet.</p></div>
      </section>

      <section className={styles.cards}>
        {sources.map((source) => (
          <article key={source.name} className={styles.card}>
            <div className={styles.cardTop}><span className={source.ready ? styles.ready : styles.open} /><b>{source.ready ? "EINGERICHTET" : "VORBEREITET"}</b></div>
            <h3>{source.name}</h3><p>{source.purpose}</p><small>{source.ready ? "Zugangsdaten vorhanden · Live-Check folgt beim Abruf" : `Aktiviert sich mit ${source.env}`}</small>
          </article>
        ))}
      </section>

      <section className={styles.flow}>
        <div><span>01</span><strong>Traffic</strong><p>Google, Maps, Social, Direkt</p></div><i>→</i>
        <div><span>02</span><strong>Verhalten</strong><p>Clarity, Scroll, Klicks, Video</p></div><i>→</i>
        <div><span>03</span><strong>Lead</strong><p>CRM, Score, Follow-up</p></div><i>→</i>
        <div><span>04</span><strong>Umsatz</strong><p>Termin, Dealwert, Gewinn</p></div>
      </section>

      <section className={styles.note}>
        <strong>Bereits funktional vorbereitet:</strong> Der Clarity Data-Export-Endpunkt liegt serverseitig im Backend und gibt den Token niemals an den Browser weiter. Abrufe werden gecacht, damit das Clarity-Tageslimit nicht durch Dashboard-Refreshes verbrannt wird.
      </section>
    </AdminShell>
  );
}
