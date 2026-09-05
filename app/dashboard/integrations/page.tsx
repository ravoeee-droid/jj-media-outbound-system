import Link from "next/link";
import AdminShell from "../../components/AdminShell";
import styles from "../AdminModule.module.css";
import { requireWorkspace } from "@/lib/workspace";
import { getGoogleConnectionStatus } from "@/lib/google";
import { getBridgeStatus } from "@/lib/whatsapp/worker-status";

export default async function IntegrationsPage() {
  const workspace = await requireWorkspace();
  const [google, bridge] = await Promise.all([
    getGoogleConnectionStatus(workspace.user.id),
    getBridgeStatus(workspace.workspaceId),
  ]);

  const integrations = [
    { name: "Gmail Workspace", ready: google.connected && google.canManageMail, detail: "Posteingang, Threads, Antworten, Entwürfe und direkter E-Mail-Versand im Growth OS", env: google.connected && !google.canManageMail ? "Einmal neu verbinden, um Inbox-Zugriff freizugeben" : "Google OAuth · gmail.modify" },
    { name: "WhatsApp Laptop", ready: bridge.connected, detail: "Baileys-Verbindung für WhatsApp Inbox, Versand, Status-Sync und kontrollierte Automatik", env: bridge.connected ? `Verbunden${bridge.phone ? ` · +${bridge.phone}` : ""}` : "Lokalen JJ-Media Dienst starten" },
    { name: "Lokale Ollama KI", ready: bridge.aiReady, detail: "Open-Source KI für den WhatsApp-Agenten direkt auf dem Laptop – ohne Dify- oder OpenAI-API-Abo", env: bridge.aiReady ? `Ollama · ${bridge.aiModel || "lokales Modell"}` : "INSTALL-WHATSAPP.bat richtet Ollama automatisch ein" },
    { name: "Microsoft Clarity", ready: Boolean(process.env.CLARITY_API_TOKEN), detail: "Verhaltensdaten, Rage/Dead Clicks, Scrolltiefe und Engagement", env: "CLARITY_API_TOKEN" },
    { name: "Google Search Console", ready: Boolean(process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL), detail: "Rankings, Keywords, Klicks, Impressionen und CTR", env: "GOOGLE_SEARCH_CONSOLE_SITE_URL" },
    { name: "Google Analytics 4", ready: Boolean(process.env.GA4_PROPERTY_ID), detail: "Traffic-Quellen, Kampagnen, Events und Conversion", env: "GA4_PROPERTY_ID" },
    { name: "Google Business Profile", ready: Boolean(process.env.GOOGLE_BUSINESS_ACCOUNT_ID), detail: "Maps-Sichtbarkeit, Anrufe, Website-Klicks und lokale Performance", env: "GOOGLE_BUSINESS_ACCOUNT_ID" },
    { name: "PageSpeed / CrUX", ready: Boolean(process.env.PAGESPEED_API_KEY), detail: "Core Web Vitals, Lighthouse und technische Website-Gesundheit", env: "PAGESPEED_API_KEY" },
    { name: "Uptime Kuma", ready: Boolean(process.env.UPTIME_KUMA_URL), detail: "Uptime, Response-Zeit und technische Alarmierung", env: "UPTIME_KUMA_URL" },
    { name: "Activepieces", ready: Boolean(process.env.ACTIVEPIECES_URL), detail: "Self-hosted Automationen für Follow-ups, CRM und interne Workflows", env: "ACTIVEPIECES_URL" },
  ];

  return (
    <AdminShell
      active="integrations"
      eyebrow="Connections"
      title="Alle Verbindungen an einem Ort."
      description="Live-Status für die wichtigsten JJ-Media Systeme. Gmail und WhatsApp arbeiten nativ im Growth OS; die KI läuft lokal über Ollama auf dem verbundenen Laptop."
      actions={<><Link href="/dashboard/email">E-Mail öffnen</Link><Link href="/dashboard/whatsapp">WhatsApp öffnen</Link></>}
    >
      <section className={styles.setupGrid}>
        {integrations.map((integration) => (
          <article className={styles.setupCard} key={integration.name}>
            <div>
              <h3>{integration.name}</h3>
              <p>{integration.detail}</p>
              <code>{integration.env}</code>
            </div>
            <span className={`${styles.setupStatus} ${integration.ready ? styles.setupStatusReady : styles.setupStatusOpen}`}>{integration.ready ? "BEREIT" : "NOCH OFFEN"}</span>
          </article>
        ))}
      </section>
      <section className={styles.note}>
        <strong>Schlank statt Abo-Stapel:</strong> CRM, Mail, WhatsApp, Lead-Tracking und Follow-ups bleiben im JJ-Media-System. Für den WhatsApp-Agenten übernimmt Ollama die KI lokal auf dem Laptop – Dify ist dafür nicht nötig.
      </section>
    </AdminShell>
  );
}
