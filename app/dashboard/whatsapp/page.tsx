import AdminShell from "@/app/components/AdminShell";
import WhatsAppWorkspace from "./WhatsAppWorkspace";

export default function WhatsAppPage() {
  return <AdminShell active="whatsapp" eyebrow="Gespräche & Termine" title="WhatsApp" wide><WhatsAppWorkspace /></AdminShell>;
}
