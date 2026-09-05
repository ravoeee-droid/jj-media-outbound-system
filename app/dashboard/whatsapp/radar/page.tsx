import Link from "next/link";
import AdminShell from "@/app/components/AdminShell";
import LeadRadar from "./LeadRadar";

export default function WhatsAppLeadRadarPage() {
  return (
    <AdminShell
      active="whatsapp"
      eyebrow="Historie · KI · Reaktivierung"
      title="WhatsApp Lead Radar"
      description="Die lokale KI durchsucht die verfügbare WhatsApp-Historie nach heißen Leads, offenen Follow-ups und sinnvollen Reaktivierungen."
      actions={<Link href="/dashboard/whatsapp" style={{ textDecoration: "none", fontWeight: 700 }}>← WhatsApp Inbox</Link>}
      wide
    >
      <LeadRadar />
    </AdminShell>
  );
}
