import fs from "node:fs";

const path = "app/components/OutboundDashboard.tsx";
let source = fs.readFileSync(path, "utf8");
const replacements = [
  ["async function openManualSTRATO Mail()", "async function openManualStratoMail()"],
  ["openManualSTRATO Mail()", "openManualStratoMail()"],
  ['    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(emailDraft.lead.email)}&su=${encodeURIComponent(emailDraft.subject)}`;\n    window.open(gmailUrl, "_blank", "noopener,noreferrer");', '    window.open("https://webmail.strato.de/", "_blank", "noopener,noreferrer");'],
];
for (const [from, to] of replacements) {
  if (!source.includes(from)) throw new Error(`Missing dashboard pattern: ${from}`);
  source = source.replaceAll(from, to);
}
fs.writeFileSync(path, source);
fs.rmSync("scripts/fix-strato-dashboard.mjs", { force: true });
fs.rmSync(".github/workflows/fix-strato-dashboard.yml", { force: true });
console.log("STRATO dashboard syntax fixed.");
