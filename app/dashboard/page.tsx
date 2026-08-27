import Link from "next/link";
import { and, desc, eq } from "drizzle-orm";
import AdminShell from "../components/AdminShell";
import { getDb } from "@/db";
import { assets, bookings, leads, settings, tasks } from "@/db/schema";
import { requireWorkspace } from "@/lib/workspace";
import styles from "./DashboardOverview.module.css";

export const dynamic = "force-dynamic";

type Opportunity = {
  id: string;
  company: string;
  contact: string;
  slug: string;
  salesPriority: number;
  probability: number;
  dealValue: number;
  videoStatus: string;
  watchPercent: number;
  pipelineStage: string;
};

type OverviewData = {
  leads: number;
  videosReady: number;
  viewed: number;
  booked: number;
  openTasks: number;
  weightedPipeline: number;
  opportunities: Opportunity[];
  integrations: Array<{ name: string; state: "ready" | "open"; detail: string }>;
  insights: Array<{ title: string; detail: string; tone: "good" | "warn" | "neutral" }>;
  error?: string;
};

const euro = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });

async function loadOverview(): Promise<OverviewData> {
  try {
    const workspace = await requireWorkspace();
    const db = getDb();
    const [leadRows, taskRows, bookingRows, assetRows, settingRows] = await Promise.all([
      db.select().from(leads).where(eq(leads.workspaceId, workspace.workspaceId)).orderBy(desc(leads.lastActivityAt), desc(leads.updatedAt)),
      db.select().from(tasks).where(and(eq(tasks.workspaceId, workspace.workspaceId), eq(tasks.status, "open"))),
      db.select().from(bookings),
      db.select().from(assets).where(eq(assets.workspaceId, workspace.workspaceId)).orderBy(desc(assets.createdAt)).limit(100),
      db.select().from(settings).where(eq(settings.workspaceId, workspace.workspaceId)),
    ]);

    const leadIds = new Set(leadRows.map((lead) => lead.id));
    const bookingsForWorkspace = bookingRows.filter((booking) => leadIds.has(booking.leadId));
    const values = Object.fromEntries(settingRows.map((row) => [row.key, row.value]));
    const videosReady = leadRows.filter((lead) => lead.videoStatus === "ready").length;
    const viewed = leadRows.filter((lead) => lead.watchPercent > 0 || ["replied", "call_booked", "won"].includes(lead.pipelineStage)).length;
    const bookedLeadIds = new Set(bookingsForWorkspace.map((booking) => booking.leadId));
    const booked = leadRows.filter((lead) => bookedLeadIds.has(lead.id) || ["call_booked", "won"].includes(lead.pipelineStage)).length;
    const weightedPipeline = leadRows.reduce((sum, lead) => sum + Math.round((lead.dealValue || 0) * Math.max(0, Math.min(100, lead.probability || 0)) / 100), 0);
    const opportunities = leadRows
      .filter((lead) => !["won", "lost"].includes(lead.pipelineStage))
      .sort((a, b) => (b.salesPriority - a.salesPriority) || (b.probability - a.probability) || (b.watchPercent - a.watchPercent))
      .slice(0, 6)
      .map((lead) => ({
        id: lead.id,
        company: lead.company,
        contact: lead.contact,
        slug: lead.slug,
        salesPriority: lead.salesPriority,
        probability: lead.probability,
        dealValue: lead.dealValue,
        videoStatus: lead.videoStatus,
        watchPercent: lead.watchPercent,
        pipelineStage: lead.pipelineStage,
      }));

    const hasMasterVideo = assetRows.some((asset) => asset.kind === "master_video");
    const integrations: OverviewData["integrations"] = [
      { name: "Datenbank", state: "ready", detail: "CRM & Lead-Historie verbunden" },
      { name: "Video Engine", state: process.env.BLOB_READ_WRITE_TOKEN && hasMasterVideo ? "ready" : "open", detail: hasMasterVideo ? "Mastervideo vorhanden" : "Mastervideo fehlt" },
      { name: "Gmail", state: process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET ? "ready" : "open", detail: process.env.AUTH_GOOGLE_ID ? "OAuth vorbereitet" : "Google OAuth fehlt" },
      { name: "Kalender", state: values.calendar_embed_url ? "ready" : "open", detail: values.calendar_embed_url ? "Buchungslink gespeichert" : "Noch nicht verbunden" },
      { name: "Microsoft Clarity", state: process.env.CLARITY_API_TOKEN ? "ready" : "open", detail: process.env.CLARITY_API_TOKEN ? "Data Export API aktiv" : "API-Token fehlt" },
      { name: "Search Console", state: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL ? "ready" : "open", detail: process.env.GOOGLE_SEARCH_CONSOLE_SITE_URL ? "Property hinterlegt" : "Property noch nicht hinterlegt" },
    ];

    const insights: OverviewData["insights"] = [];
    if (leadRows.length === 0) {
      insights.push({ title: "Lead-Pipeline ist leer", detail: "Importiere die erste Lead-Liste oder lege einen Lead manuell an. Danach priorisiert das System automatisch.", tone: "neutral" });
    } else {
      const withoutVideo = leadRows.length - videosReady;
      if (withoutVideo > 0) insights.push({ title: `${withoutVideo} Leads warten auf ein persönliches Video`, detail: "Die vorhandenen Social-Profile können im Outbound-Modul vorbereitet und anschließend als Loom-Style MP4 gerendert werden.", tone: "warn" });
      if (videosReady > 0 && viewed === 0) insights.push({ title: "Videos sind bereit, aber noch ohne View-Signal", detail: "Starte den Versand oder prüfe die personalisierten Links. Sobald ein Lead schaut, steigt er automatisch in der Priorität.", tone: "neutral" });
      if (viewed > 0 && booked === 0) insights.push({ title: `${viewed} warme Video-Viewer ohne Termin`, detail: "Das ist die heißeste Follow-up-Gruppe. Diese Kontakte sollten zuerst angerufen oder persönlich nachgefasst werden.", tone: "warn" });
      if (booked > 0) insights.push({ title: `${booked} Termin${booked === 1 ? "" : "e"} aus der Pipeline`, detail: "Der Funnel produziert bereits konkrete Sales-Signale. Fokus jetzt auf schnelle Reaktion und saubere Deal-Dokumentation.", tone: "good" });
    }

    return { leads: leadRows.length, videosReady, viewed, booked, openTasks: taskRows.length, weightedPipeline, opportunities, integrations, insights };
  } catch (error) {
    return {
      leads: 0,
      videosReady: 0,
      viewed: 0,
      booked: 0,
      openTasks: 0,
      weightedPipeline: 0,
      opportunities: [],
      integrations: [],
      insights: [],
      error: error instanceof Error ? error.message : "Dashboard-Daten konnten nicht geladen werden.",
    };
  }
}

function stageLabel(stage: string) {
  return ({ new: "Neu", qualified: "Qualifiziert", contact_ready: "Kontaktbereit", contacted: "Kontaktiert", replied: "Reagiert", call_booked: "Termin", won: "Gewonnen", lost: "Verloren" } as Record<string, string>)[stage] || stage;
}

export default async function DashboardPage() {
  const data = await loadOverview();
  const metrics = [
    { label: "Leads", value: String(data.leads), note: `${data.openTasks} Follow-ups offen` },
    { label: "Videos bereit", value: String(data.videosReady), note: data.leads ? `${Math.round(data.videosReady / data.leads * 100)} % der Pipeline` : "0 %" },
    { label: "Video angesehen", value: String(data.viewed), note: data.videosReady ? `${Math.round(data.viewed / data.videosReady * 100)} % View-Rate` : "Noch keine Views" },
    { label: "Termine", value: String(data.booked), note: data.viewed ? `${Math.round(data.booked / data.viewed * 100)} % der Viewer` : "Noch keine Termine" },
    { label: "Pipeline-Wert", value: euro.format(data.weightedPipeline), note: "gewichtet nach Wahrscheinlichkeit" },
  ];

  return (
    <AdminShell
      active="overview"
      eyebrow="JJ-Media Command Center"
      title="Alles, was heute Umsatz bewegen kann."
      description="Leads, personalisierte Analysevideos, Reaktionen, Termine und Systemstatus in einer Oberfläche – priorisiert statt zugemüllt."
      actions={<><Link href="/dashboard/outbound">Outbound öffnen</Link><Link href="/dashboard/integrations">Integrationen</Link></>}
    >
      {data.error && <div className={styles.error}>Live-Daten konnten nicht vollständig geladen werden: {data.error}</div>}

      <section className={styles.metrics}>
        {metrics.map((metric) => <article key={metric.label}><small>{metric.label}</small><strong>{metric.value}</strong><p>{metric.note}</p></article>)}
      </section>

      <section className={styles.grid}>
        <article className={styles.opportunities}>
          <div className={styles.cardHead}><div><small>PRIORITÄT</small><h2>Die nächsten besten Aktionen</h2></div><Link href="/dashboard/outbound">Alle Leads →</Link></div>
          <div className={styles.leadList}>
            {data.opportunities.map((lead, index) => (
              <div className={styles.lead} key={lead.id}>
                <span className={styles.rank}>{String(index + 1).padStart(2, "0")}</span>
                <div className={styles.leadMain}><strong>{lead.company}</strong><small>{lead.contact || "Ansprechpartner offen"} · {stageLabel(lead.pipelineStage)}</small></div>
                <div className={styles.signal}><b>{lead.watchPercent ? `${lead.watchPercent}% gesehen` : lead.videoStatus === "ready" ? "Video bereit" : "Video offen"}</b><small>Score {lead.salesPriority}</small></div>
                <div className={styles.value}><strong>{lead.dealValue ? euro.format(lead.dealValue) : "—"}</strong><small>{lead.probability || 0}% Chance</small></div>
              </div>
            ))}
            {data.opportunities.length === 0 && <div className={styles.empty}>Noch keine Leads vorhanden. Öffne die Outbound Engine und importiere die erste Liste.</div>}
          </div>
        </article>

        <article className={styles.insights}>
          <div className={styles.cardHead}><div><small>INTELLIGENCE</small><h2>Was das System gerade sieht</h2></div><Link href="/dashboard/intelligence">Details →</Link></div>
          <div className={styles.insightList}>
            {data.insights.map((insight) => <div className={`${styles.insight} ${styles[insight.tone]}`} key={insight.title}><i /><div><strong>{insight.title}</strong><p>{insight.detail}</p></div></div>)}
            {data.insights.length === 0 && !data.error && <div className={styles.empty}>Sobald Daten einlaufen, erscheinen hier konkrete nächste Schritte.</div>}
          </div>
        </article>
      </section>

      <section className={styles.integrations}>
        <div className={styles.cardHead}><div><small>DATENQUELLEN</small><h2>System & Integrationen</h2></div><Link href="/dashboard/integrations">Einrichten →</Link></div>
        <div className={styles.integrationGrid}>
          {data.integrations.map((item) => <div key={item.name} className={styles.integration}><span className={item.state === "ready" ? styles.dotReady : styles.dotOpen} /><div><strong>{item.name}</strong><small>{item.detail}</small></div><b>{item.state === "ready" ? "LIVE" : "OFFEN"}</b></div>)}
        </div>
      </section>
    </AdminShell>
  );
}
