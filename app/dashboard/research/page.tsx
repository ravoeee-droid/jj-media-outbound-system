import AdminShell from "../../components/AdminShell";
import ResearchFeedWorkspace from "./ResearchFeedWorkspace";

export const dynamic = "force-dynamic";

export default function ResearchPage() {
  return (
    <AdminShell
      active="research"
      eyebrow="Research Feed"
      title="Jeden Tag neue Kandidaten. Vor dem CRM gefiltert."
      description="Suchprofile definieren, Kandidaten automatisch einsammeln, gegen bestehende Leads deduplizieren und die besten 30 mit einem Klick in den Intake schicken."
      wide
    >
      <ResearchFeedWorkspace />
    </AdminShell>
  );
}
