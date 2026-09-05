import AdminShell from "@/app/components/AdminShell";
import EmailWorkspace from "./EmailWorkspace";

export default function EmailPage() {
  return (
    <AdminShell
      active="email"
      eyebrow="Inbox · Threads · Follow-ups"
      title="E-Mail"
      description="Gmail direkt im Growth OS verwalten – lesen, suchen, antworten, senden, markieren und archivieren."
      wide
    >
      <EmailWorkspace />
    </AdminShell>
  );
}
