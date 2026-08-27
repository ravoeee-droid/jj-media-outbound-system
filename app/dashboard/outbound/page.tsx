import Link from "next/link";
import AdminShell from "../../components/AdminShell";
import OutboundDashboard from "../../components/OutboundDashboard";
import styles from "./OutboundEmbed.module.css";

export default function OutboundPage() {
  return (
    <AdminShell
      active="outbound"
      eyebrow="Outbound Workspace"
      title="Personalisierte Akquise. Ohne Tool-Chaos."
      description="Leads importieren, Social-Profile vorbereiten, personalisierte Analysevideos erstellen, versenden und nachfassen – in einem durchgängigen Workflow."
      actions={<><Link href="/dashboard">Command Center</Link><Link href="/dashboard/integrations">Verbindungen prüfen</Link></>}
      wide
    >
      <div className={styles.embed}>
        <OutboundDashboard userName="JJ-Media" />
      </div>
    </AdminShell>
  );
}
