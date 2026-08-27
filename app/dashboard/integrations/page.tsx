import Link from "next/link";
import AdminShell from "../../components/AdminShell";
import styles from "../AdminModule.module.css";

const integrations = [
  { name: "Microsoft Clarity", ready: Boolean(process.env.CLARITY_API_TOKEN), detail: "Verhaltensdaten, Rage/Dead Clicks, Scrolltiefe und Engagement", env: "CLARITY_API_TOKEN" },
  { name: "Google Search Console", ready: Boolean(process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL), detail: "Rankings, Keywords, Klicks, Impressionen und CTR", env: "GOOGLE_SEARCH_CONSOLE_SITE_URL" },
  { name: "Google Analytics 4", ready: Boolean(process.env.GA4_PROPERTY_ID), detail: "Traffic-Quellen, Kampagnen, Events und Conversion", env: "GA4_PROPERTY_ID" },
  { name: "Google Business Profile", ready: Boolean(process.env.GOOGLE_BUSINESS_ACCOUNT_ID), detail: "Maps-Sichtbarkeit, Anrufe, Website-Klicks und lokale Performance", env: "GOOGLE_BUSINESS_ACCOUNT_ID" },
  { name: "PageSpeed / CrUX", ready: Boolean(process.env.PAGESPEED_API_KEY), detail: "Core Web Vitals, Lighthouse und technische Website-Gesundheit", env: "PAGESPEED_API_KEY" },
  { name: "Uptime Kuma", ready: Boolean(process.env.UPTIME_KUMA_URL), detail: "Uptime, Response-Zeit und technische Alarmierung", env: "UPTIME_KUMA_URL" },
  { name: "Activepieces", ready: Boolean(process.env.ACTIVEPIECES_URL), detail: "Self-hosted Automationen für Follow-ups, CRM und interne Workflows", env: "ACTIVEPIECES_URL" },
  { name: "Dify Intelligence", ready: Boolean(process.env.DIFY_API_URL && process.env.DIFY_API_KEY), detail: "KI-Agent für Dateninterpretation und konkrete Handlungsempfehlungen", env: "DIFY_API_URL + DIFY_API_KEY" },
];

export default function IntegrationsPage() {
  return (
    <AdminShell
      active="integrations"
      eyebrow="Connections"
      title="Alle Datenquellen an einem Ort."
      description="Die Oberfläche zeigt nur Verbindungen, die das System wirklich prüfen kann. Zugangsdaten bleiben ausschließlich serverseitig in Vercel Environment Variables."
      actions={<Link href="/dashboard/intelligence">Intelligence öffnen</Link>}
    >
      <section className={styles.setupGrid}>
        {integrations.map((integration) => (
          <article className={styles.setupCard} key={integration.name}>
            <div>
              <h3>{integration.name}</h3>
              <p>{integration.detail}</p>
              <code>{integration.env}</code>
            </div>
            <span className={`${styles.setupStatus} ${integration.ready ? styles.setupStatusReady : styles.setupStatusOpen}`}>{integration.ready ? "VERBUNDEN" : "NOCH OFFEN"}</span>
          </article>
        ))}
      </section>
      <section className={styles.note}>
        <strong>Wichtig:</strong> Die kostenlosen/self-hosted Tools werden nicht alle gleichzeitig hochgezogen. Wir verbinden sie modular, damit das System schnell bleibt und keine unnötigen Serverkosten produziert. CRM, Video-Engine, Lead-Tracking und Follow-ups bleiben nativ im JJ-Media-System.
      </section>
    </AdminShell>
  );
}
