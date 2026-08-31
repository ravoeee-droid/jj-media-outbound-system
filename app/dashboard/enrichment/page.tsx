import { redirect } from "next/navigation";

export default function LegacyEnrichmentPage() {
  redirect("/dashboard/outbound");
}
