import fs from "node:fs";

function read(path) { return fs.readFileSync(path, "utf8"); }
function write(path, value) { fs.writeFileSync(path, value); }
function mustReplace(source, from, to, label) {
  if (!source.includes(from)) throw new Error(`Migration pattern missing: ${label}`);
  return source.replace(from, to);
}
function mustRegex(source, regex, to, label) {
  if (!regex.test(source)) throw new Error(`Migration regex missing: ${label}`);
  regex.lastIndex = 0;
  return source.replace(regex, to);
}

function assemble(prefix, target) {
  const files = fs.readdirSync(".strato-migration").filter((name) => name.startsWith(prefix)).sort();
  if (!files.length) throw new Error(`No fragments for ${target}`);
  fs.mkdirSync(target.split("/").slice(0, -1).join("/"), { recursive: true });
  fs.writeFileSync(target, files.map((name) => fs.readFileSync(`.strato-migration/${name}`, "utf8")).join(""));
}

assemble("strato-mail-", "lib/strato-mail.ts");
assemble("email-workspace-", "app/dashboard/email/EmailWorkspace.tsx");
assemble("email-route-", "app/api/email/route.ts");
assemble("settings-route-", "app/api/settings/route.ts");
assemble("health-route-", "app/api/health/route.ts");
assemble("integrations-page-", "app/dashboard/integrations/page.tsx");

{
  const path = "app/components/OutboundDashboard.tsx";
  let s = read(path);
  s = mustReplace(s, "    gmail: false,", "    mail: false,", "outbound integration state");
  s = s.replaceAll("integrations.gmail", "integrations.mail");
  s = s.replaceAll("Gmail", "STRATO Mail");
  s = s.replaceAll("Google-Verbindung wurde abgebrochen.", "STRATO Mail ist noch nicht eingerichtet.");
  s = s.replaceAll("Google-Konto", "STRATO-Postfach");
  s = s.replaceAll("OAuth-Verbindung für echten API-Versand", "IMAP/SMTP-Verbindung für direkten Versand");
  s = s.replaceAll("Rich-Mails werden erst nach deiner bewussten Bestätigung versendet. Folgekontakte können optional automatisiert werden.", "E-Mails werden direkt über dein STRATO-Postfach versendet. Folgekontakte können optional automatisiert werden.");
  s = s.replaceAll("Verbinde genau das STRATO-Postfach, von dem deine Outbound-Mails versendet werden sollen.", "Hinterlege STRATO_MAIL_EMAIL und STRATO_MAIL_PASSWORD einmal sicher in Vercel. Danach ist das Postfach direkt im Growth OS verfügbar.");
  s = s.replaceAll('href="/api/gmail/connect"', 'href="/dashboard/email"');
  s = s.replaceAll("STRATO Mail sicher verbinden", "STRATO Mail einrichten");
  s = s.replaceAll("STRATO Mail trennen", "Postfach öffnen");
  s = mustRegex(s, /\n  useEffect\(\(\) => \{\n    const params = new URLSearchParams\(window\.location\.search\);\n    const gmail = params\.get\("gmail"\);[\s\S]*?\n  \}, \[\]\);\n/, "\n", "remove gmail callback effect");
  s = mustRegex(s, /  async function disconnectSTRATO Mail\(\) \{[\s\S]*?\n  \}\n\n  async function logout/, '  function openStratoMail() { window.location.assign("/dashboard/email"); }\n\n  async function logout', "replace disconnect function");
  s = s.replaceAll("disconnectSTRATO Mail", "openStratoMail");
  s = s.replaceAll("gmail: false", "mail: false");
  write(path, s);
}

{
  const path = "app/api/outreach/route.ts";
  let s = read(path);
  s = mustReplace(s, 'import { sendGmailMessage } from "@/lib/google";', 'import { sendStratoMessage } from "@/lib/strato-mail";', "outreach import");
  s = s.replaceAll("sendGmailMessage", "sendStratoMessage");
  s = s.replace(/\n\s*userId: workspace\.user\.id,/g, "");
  s = mustRegex(s, /    const gmailUrl = `https:\/\/mail\.google\.com\/mail\/\?view=cm&fs=1&to=\$\{encodeURIComponent\(lead\.email\)\}&su=\$\{encodeURIComponent\(subject\)\}`;/, '    const mailUrl = `mailto:${encodeURIComponent(lead.email)}?subject=${encodeURIComponent(subject)}`;', "mailto preview");
  s = s.replaceAll("gmailUrl,", "mailUrl,");
  s = s.replaceAll("E-Mail über Gmail gesendet", "E-Mail über STRATO gesendet");
  s = s.replaceAll("Manueller Gmail-Versand bestätigt", "Manueller STRATO-Versand bestätigt");
  write(path, s);
}

{
  const path = "app/api/cron/automation/route.ts";
  let s = read(path);
  s = mustReplace(s, 'import { activities, leads, outreach, settings, tasks, workspaces } from "@/db/schema";', 'import { activities, leads, outreach, settings, tasks } from "@/db/schema";', "cron schema import");
  s = mustReplace(s, 'import { sendGmailMessage } from "@/lib/google";', 'import { sendStratoMessage } from "@/lib/strato-mail";', "cron mail import");
  s = s.replaceAll("sendGmailMessage", "sendStratoMessage");
  s = s.replace(/\n\s*userId: row\.ownerId,/g, "");
  s = mustReplace(s, '.select({ item: outreach, lead: leads, ownerId: workspaces.ownerId })', '.select({ item: outreach, lead: leads })', "cron owner select");
  s = mustReplace(s, '    .innerJoin(workspaces, eq(workspaces.id, outreach.workspaceId))\n', "", "cron workspace join");
  write(path, s);
}

{
  const path = "app/api/campaign-control/route.ts";
  let s = read(path);
  s = mustReplace(s, 'import { listRecentGmailInboxThreads, sendGmailMessage } from "@/lib/google";', 'import { listRecentStratoInboxMessages, sendStratoMessage } from "@/lib/strato-mail";', "campaign mail import");
  s = mustRegex(s, /async function detectGmailReplies\([\s\S]*?\n\}\n\nexport async function GET/, `async function detectStratoReplies(workspaceId: string, values: Record<string, string>) {
  if (values.telegram_reply_scan === "false") return;
  const db = getDb();
  const inbox = await listRecentStratoInboxMessages(2);
  if (!inbox.length) return;
  const sentRows = await db.select().from(outreach).where(and(eq(outreach.workspaceId, workspaceId), eq(outreach.status, "sent"))).limit(500);
  for (const row of sentRows.filter((item) => item.step === 1 && item.providerMessageId)) {
    const messageId = row.providerMessageId || "";
    const replied = inbox.some((message) => [message.inReplyTo, message.references].some((value) => value.includes(messageId)));
    if (!replied) continue;
    const key = \`telegram_reply:\${row.leadId}\`;
    if (values[key]) continue;
    const [lead] = await db.select().from(leads).where(eq(leads.id, row.leadId)).limit(1);
    if (!lead) continue;
    await Promise.all([
      setSetting(workspaceId, key, new Date().toISOString()),
      db.update(leads).set({ pipelineStage: "replied", lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, lead.id)),
      writeLog(workspaceId, "strato_reply_detected", "completed", lead.email, lead.id),
    ]);
    await sendTelegramMessage(\`💬 Neue Antwort erhalten\\n\\nUnternehmen: \${lead.company}\\nVon: \${lead.email}\\n\\nJetzt persönlich reagieren.\`, {
      buttons: [[{ text: "STRATO Mail öffnen ↗", url: \`\${process.env.NEXT_PUBLIC_APP_URL || "https://jj-media-social-outbound.vercel.app"}/dashboard/email\` }, { text: "CRM öffnen ↗", url: \`\${process.env.NEXT_PUBLIC_APP_URL || "https://jj-media-social-outbound.vercel.app"}/dashboard#leads\` }]],
    });
  }
}

export async function GET`, "campaign reply function");
  s = mustReplace(s, "await detectGmailReplies(workspaceId, workspace.ownerId, values).catch(() => undefined);", "await detectStratoReplies(workspaceId, values).catch(() => undefined);", "campaign reply call");
  s = s.replaceAll("sendGmailMessage", "sendStratoMessage");
  s = s.replace(/\n\s*userId: workspace\.ownerId,/g, "");
  write(path, s);
}

{
  const path = "auth.ts";
  let s = read(path);
  s = s.replace(/\n\s*"https:\/\/www\.googleapis\.com\/auth\/gmail\.modify",/g, "");
  write(path, s);
}
{
  const path = "app/api/gmail/connect/route.ts";
  let s = read(path);
  s = s.replace(/\n\s*"https:\/\/www\.googleapis\.com\/auth\/gmail\.modify",/g, "");
  write(path, s);
}

fs.rmSync("scripts/apply-strato-mail-migration.mjs", { force: true });
fs.rmSync(".github/workflows/strato-mail-migration.yml", { force: true });
fs.rmSync(".strato-migration", { recursive: true, force: true });
console.log("STRATO mail migration applied.");
