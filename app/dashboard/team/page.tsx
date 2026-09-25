import { redirect } from "next/navigation";
import AdminShell from "../../components/AdminShell";
import TeamWorkspace from "./TeamWorkspace";
import { requirePermission } from "@/lib/workspace";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  try {
    await requirePermission("manage_team");
  } catch {
    redirect("/dashboard");
  }

  return (
    <AdminShell
      active="team"
      eyebrow="Team & Zugänge"
      title="Jeder arbeitet in seinem eigenen Bereich."
      description="Mitarbeiter anlegen, Rollen festlegen und Rechte so begrenzen, dass im Tagesgeschäft kaum Fehler passieren können."
      wide
    >
      <TeamWorkspace />
    </AdminShell>
  );
}
