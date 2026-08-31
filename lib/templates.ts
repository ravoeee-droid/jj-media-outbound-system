export const defaultSettings: Record<string, string> = {
  sender_name: "JJ-Media",
  sender_email: "",
  calendar_embed_url: "",
  offer_name: "Social Media Wachstumssystem",
  booking_cta: "15 Minuten Potenzial-Call",
  email_subject: "Kurzes Video für {{unternehmen}}",
  email_body:
    "Hallo {{vorname}},\n\nich habe mir das Instagram-Profil von {{unternehmen}} angesehen und dazu eine kurze persönliche Social-Media-Analyse vorbereitet:\n\n{{video_link}}\n\nDirekt daneben können Sie einen passenden Termin auswählen, falls die drei Social-Media-Hebel für Sie relevant sind.\n\nViele Grüße\nJJ-Media",
  followup_1_body:
    "Hallo {{vorname}},\n\nkurze Nachfrage: Konnten Sie bereits einen Blick auf das Video werfen?\n\n{{video_link}}\n\nViele Grüße\nJJ-Media",
  followup_2_body:
    "Hallo {{vorname}},\n\nfalls das Thema gerade keine Priorität hat, reicht ein kurzes „später“. Wenn mehr Reichweite und qualifizierte Anfragen aktuell relevant sind, finden Sie hier noch einmal die Analyse:\n\n{{video_link}}\n\nViele Grüße\nJJ-Media",
  auto_followups: "false",
  followup_1_delay_days: "2",
  followup_2_delay_days: "5",
};

type TemplateLead = {
  company: string;
  contact?: string | null;
  slug: string;
};

export function renderTemplate(template: string, lead: TemplateLead, appBaseUrl?: string) {
  const baseUrl = (appBaseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const firstName = lead.contact?.trim().split(/\s+/)[0] || "Guten Tag";
  return template
    .replaceAll("{{unternehmen}}", lead.company)
    .replaceAll("{{vorname}}", firstName)
    .replaceAll("{{video_link}}", `${baseUrl}/v/${lead.slug}`);
}

function escapeHtml(value: string) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderEmailHtml(body: string, lead: TemplateLead, appBaseUrl?: string) {
  const baseUrl = (appBaseUrl ?? process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
  const videoUrl = `${baseUrl}/video/${lead.slug}`;
  const previewUrl = `${baseUrl}/api/preview/${lead.slug}`;
  const linkedBody = escapeHtml(body)
    .replaceAll(escapeHtml(`${baseUrl}/v/${lead.slug}`), `<a href="${videoUrl}" style="color:#f23f7b;font-weight:700;text-decoration:underline;">Persönliches Video für ${escapeHtml(lead.company)} ansehen →</a>`)
    .replaceAll("\n", "<br>");

  return `<div style="margin:0;background:#ffffff;color:#1f2937;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.65;">
  <div style="max-width:640px;margin:0;padding:4px 0 24px;">
    <div>${linkedBody}</div>
    <a href="${videoUrl}" style="display:block;width:100%;max-width:600px;margin:22px 0 12px;text-decoration:none;">
      <img src="${previewUrl}" width="600" alt="Persönliches Video für ${escapeHtml(lead.company)} abspielen" style="display:block;width:100%;max-width:600px;height:auto;border:0;border-radius:12px;box-shadow:0 8px 28px rgba(15,23,42,.16);">
    </a>
    <a href="${videoUrl}" style="display:inline-block;margin-top:4px;border-radius:8px;background:#f23f7b;padding:12px 18px;color:#ffffff;font-weight:700;text-decoration:none;">Video jetzt ansehen →</a>
  </div>
</div>`;
}
