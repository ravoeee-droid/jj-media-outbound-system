import AdminShell from "../../components/AdminShell";
import CrmWorkspace from "./CrmWorkspace";

export const dynamic = "force-dynamic";

export default function CrmPage() {
  return (
    <AdminShell
      active="crm"
      eyebrow="Zentrales CRM"
      title="Ein CRM. Klare Zuständigkeiten."
      description="Standardmäßig sieht jeder Mitarbeiter seine Leads. Berechtigte Teammitglieder wechseln per Tab zu Kollegen, unzugeordneten Leads oder der gesamten Pipeline."
      wide
    >
      <CrmWorkspace />
    </AdminShell>
  );
}
