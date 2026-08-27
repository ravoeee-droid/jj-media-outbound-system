import Link from "next/link";
import AdminShell from "../../components/AdminShell";
import OutboundDashboard from "../../components/OutboundDashboard";

export default function OutboundPage() {
  return (
    <AdminShell
      active="outbound"
      eyebrow="Akquise Engine"
      title="Leads rein. Persönliche Videos raus."
      description="Hier bleibt der komplette bestehende Outbound-Workflow erhalten: Lead-Import, Social-Screenshot, Loom-Style MP4, Landingpage, Versand, Follow-ups und CRM-Akte."
      actions={<Link href="/dashboard">← Command Center</Link>}
      wide
    >
      <OutboundDashboard userName="JJ-Media" />
    </AdminShell>
  );
}
