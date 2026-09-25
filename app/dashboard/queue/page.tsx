import AdminShell from "../../components/AdminShell";
import DailyQueueWorkspace from "./DailyQueueWorkspace";

export const dynamic = "force-dynamic";

export default function DailyQueuePage() {
  return (
    <AdminShell
      active="queue"
      eyebrow="Tages-Queue"
      title="Ein Lead nach dem anderen. Kein CRM-Chaos."
      description="Fällige Rückrufe zuerst, danach die stärksten kontaktbereiten Leads. Anrufen, Ergebnis anklicken, nächster Lead."
      wide
    >
      <DailyQueueWorkspace />
    </AdminShell>
  );
}
