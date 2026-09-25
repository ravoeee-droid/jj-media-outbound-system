import Link from "next/link";
import AdminShell from "../components/AdminShell";
import ManagerCockpit from "./ManagerCockpit";

export const dynamic = "force-dynamic";

export default function DashboardPage() {
  return (
    <AdminShell
      active="overview"
      eyebrow="JJ-Media Command Center"
      title="Heute im Blick. Sofort wissen, wo du eingreifen musst."
      description="Calls, Gespräche, Follow-ups, Termine, Mitarbeiter-Queues und technische Blocker – live auf einer Seite."
      actions={<><Link href="/dashboard/queue">Tages-Queue</Link><Link href="/dashboard/research">Lead Scout</Link></>}
      wide
    >
      <ManagerCockpit />
    </AdminShell>
  );
}
