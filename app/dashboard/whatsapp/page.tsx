import Link from "next/link";
import AdminShell from "@/app/components/AdminShell";
import WhatsAppWorkspace from "./WhatsAppWorkspace";

export default function WhatsAppPage() {
  return (
    <AdminShell
      active="whatsapp"
      eyebrow="Gespräche & Termine"
      title="WhatsApp"
      actions={<Link href="/dashboard/whatsapp/radar" style={{ textDecoration: "none", fontWeight: 800 }}>Lead Radar →</Link>}
      wide
    >
      <WhatsAppWorkspace />
    </AdminShell>
  );
}
