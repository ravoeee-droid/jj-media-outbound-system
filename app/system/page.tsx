import Link from "next/link";
import AdminShell from "../components/AdminShell";
import SystemControlPanel from "./SystemControlPanel";

export default function SystemPage() {
  return (
    <AdminShell
      active="system"
      eyebrow="Operations & Runtime"
      title="Volle Kontrolle. Keine Blackbox."
      description="Kampagnensteuerung, Render-Jobs, Versandprozesse und Fehler laufen hier in einer nachvollziehbaren Systemhistorie zusammen."
      actions={<><Link href="/dashboard/outbound">Outbound öffnen</Link><Link href="/dashboard">Command Center</Link></>}
      wide
    >
      <SystemControlPanel />
    </AdminShell>
  );
}
