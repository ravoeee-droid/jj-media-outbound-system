import AdminShell from "../../components/AdminShell";
import IntakeWorkspace from "./IntakeWorkspace";

export const dynamic = "force-dynamic";

export default function IntakePage() {
  return (
    <AdminShell
      active="intake"
      eyebrow="Lead Intake"
      title="Neue Leads rein. Sauber geprüft ins CRM."
      description="Datei oder Liste einfügen, Dubletten vor dem Speichern sehen, die besten 30 auswählen, einem Mitarbeiter zuweisen und anschließend mit einem Klick recherchieren, validieren und priorisieren."
      wide
    >
      <IntakeWorkspace />
    </AdminShell>
  );
}
