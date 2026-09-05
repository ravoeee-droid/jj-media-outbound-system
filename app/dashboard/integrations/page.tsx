import Link from "next/link";
import AdminShell from "../../components/AdminShell";
import styles from "../AdminModule.module.css";
import { requireWorkspace } from "@/lib/workspace";
import { stratoMailStatus } from "@/lib/strato-mail";
import { getBridgeStatus } from "@/lib/whatsapp/worker-status";
import { calendarConnected } from "@/lib/whatsapp/calendar";

export const dynamic = "force-dynamic";

export default async function IntegrationsPage() {
  const workspace = await requireWorkspace();
  const [bridge, googleCalendar] = await Promise.all([
    getBridgeStatus(workspace.workspaceId),
    calendarConnected(workspace.user.id).catch(() => false),
  ]);
  const mail = stratoMailStatus();
  const integrations = [
    { name: "STRATO Mail", ready: mail.configured, detail: "Posteingang, Antworten, Entwürfe und Outbound-Versand über IMAP/SMTP direkt im Growth OS", env: mail.configured ? `${mail.email} · IMAP 993 · SMTP 465` : "STRATO_MAIL_EMAIL + STRATO_MAIL_PASSWORD" },
    { name: "WhatsApp Laptop", ready: bridge.connected, detail: "Baileys-Verbindung für WhatsApp Inbox, Versand, Status-Sync und kontrollierte Automatik", env: bridge.connected ? `Verbunden${bridge.phone ? ` · +${bridge.phone}` : ""}` : "Lokalen JJ-Media Dienst starten" },
    { name: "Lokale Ollama KI", ready: bridge.aiReady, detail: "Open-Source KI für den WhatsApp-Agenten direkt auf dem Laptop", env: bridge.aiReady ? `Ollama · ${bridge.aiModel || "lokales Modell"}` : "INSTALL-WHATSAPP.bat richtet Ollama ein" },
    { name: "Google Kalender", ready: googleCalendar, detail: "Verfügbarkeit und Terminbuchung für den WhatsApp-Agenten – ohne Gmail-Zugriff", env: googleCalendar ? "Kalender verbunden" : "Optional verbinden" },
    { name: "Microsoft Clarity", ready: Boolean(process.env.CLARITY_API_TOKEN), detail: "Verhaltensdaten, Rage/Dead Clicks, Scrolltiefe und Engagement", env: "CLARITY_API_TOKEN" },
    { name: "Google Search Console", ready: Boolean(process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL), detail: "Rankings, Keywords, Klicks, Impressionen und CTR", env: "GOOGLE_SEARCH_CONSOLE_SITE_URL" },
    { name: "Google Analytics 4", ready: Boolean(process.env.GA4_PROPERTY_ID), detail: "Traffic-Quellen, Kampagnen, Events und Conversion", env: "GA4_PROPERTY_ID" },
    { name: "Google Business Profile", ready: Boolean(process.env.GOOGLE_BUSINESS_ACCOUNT_ID), detail: "Maps-Sichtbarkeit, Anrufe, Website-Klicks und lokale Performance", env: "GOOGLE_BUSINESS_ACCOUNT_ID" },
    { name: "PageSpeed / CrUX", ready: Boolean(process.env.PAGESPEED_API_KEY), detail: "Core Web Vitals, Lighthouse und technische Website-Gesundheit", env: "PAGESPEED_API_KEY" },
    { name: "Uptime Kuma", ready: Boolean(process.env.UPTIME_KUMA_URL), detail: "Uptime, Response-Zeit und technische Alarmierung", env: "UPTIME_KUMA_URL" },
    { name: "Activepieces", ready: Boolean(process.env.ACTIVEPIECES_URL), detail: "Self-hosted Automationen für Follow-ups, CRM und interne Workflows", env: "ACTIVEPIECES_URL" },
  ];

  return (
    <AdminShell active="integrations" eyebrow="Connections" title="Alle Verbindungen an einem Ort." description="Mail läuft über STRATO, WhatsApp über den lokalen Laptop und die KI lokal über Ollama. Google bleibt nur dort im Einsatz, wo wir den Kalender wirklich brauchen." actions={<><Link href="/dashboard/email">STRATO Mail öffnen</Link><Link href="/dashboard/whatsapp">WhatsApp öffnen</Link></>}>
      <section className={styles.setupGrid}>
        {integrations.map((integration) => <article className={styles.setupCard} key={integration.name}><div><h3>{integration.name}</h3><p>{integration.detail}</p><code>{integration.env}</code></div><span className={`${styles.setupStatus} ${integration.ready ? styles.setupStatusReady : styles.setupStatusOpen}`}>{integration.ready ? "EINGERICHTET" : "NOCH OFFEN"}</span></article>)}
      </section>
      <section className={styles.note}><strong>Kein Gmail für E-Mail:</strong> Der Mailbereich und der Outbound-Versand verwenden das STRATO-Postfach direkt per SSL/TLS. Google-Zugriff ist davon getrennt und nur für optionale Kalenderfunktionen vorgesehen.</section>
    </AdminShell>
  );
}
