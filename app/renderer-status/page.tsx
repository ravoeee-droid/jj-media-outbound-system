import Link from "next/link";
import AdminShell from "../components/AdminShell";
import { verifyVideoRenderer } from "@/lib/video-renderer";
import styles from "./RendererStatus.module.css";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

export default async function RendererStatusPage() {
  let status: Awaited<ReturnType<typeof verifyVideoRenderer>> | null = null;
  let error = "";
  try {
    status = await verifyVideoRenderer();
  } catch (cause) {
    error = cause instanceof Error ? cause.message : "Renderer nicht verfügbar.";
  }

  return (
    <AdminShell
      active="system"
      eyebrow="Video Infrastructure"
      title="Renderer Healthcheck."
      description="Ein direkter technischer Check der Video-Pipeline, ohne das restliche Cockpit mit Diagnose-Details zu überladen."
      actions={<><Link href="/system">Systemsteuerung</Link><Link href="/dashboard/outbound">Outbound</Link></>}
    >
      <section className={styles.card}>
        <div className={styles.state}>
          <span className={status?.ok ? styles.stateDot : styles.stateDotError} />
          <small>RENDERER STATUS</small>
          <strong>{status?.ok ? "Online" : "Fehler"}</strong>
        </div>
        <div className={styles.copy}>
          <small>SINGLE VIDEO PIPELINE</small>
          <h2>{status?.ok ? "Die Rendering-Pipeline ist einsatzbereit." : "Die Rendering-Pipeline braucht Aufmerksamkeit."}</h2>
          <p>{status?.ok ? `${status.format} · ${status.resolution} · nativer HTML5-Player` : error}</p>
        </div>
      </section>

      <section className={styles.facts}>
        <article className={styles.fact}><small>Format</small><strong>{status?.format || "—"}</strong></article>
        <article className={styles.fact}><small>Auflösung</small><strong>{status?.resolution || "—"}</strong></article>
        <article className={styles.fact}><small>Ausgabe</small><strong>{status?.ok ? "HTML5 kompatibel" : "Prüfung erforderlich"}</strong></article>
      </section>
    </AdminShell>
  );
}
