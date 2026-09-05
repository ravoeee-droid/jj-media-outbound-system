import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { emitKeypressEvents } from "node:readline";
import readline from "node:readline/promises";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");
const configPath = join(dataDir, "config.json");
mkdirSync(dataDir, { recursive: true });
const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const DEFAULT_MODEL = "qwen3:4b";

function normalizeBase(value) {
  const text = String(value || "").trim() || "https://jj-media-social-outbound.vercel.app";
  const url = new URL(/^https?:\/\//i.test(text) ? text : `https://${text}`);
  if (url.protocol !== "https:" && url.hostname !== "localhost") throw new Error("Bitte die HTTPS-Adresse des Outbound Tools verwenden.");
  return url.origin;
}

async function hiddenQuestion(label) {
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") return rl.question(label);
  process.stdout.write(label);
  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  let value = "";
  return new Promise((resolve, reject) => {
    const onKey = (chunk, key = {}) => {
      if (key.ctrl && key.name === "c") { cleanup(); reject(new Error("Abgebrochen.")); return; }
      if (key.name === "return" || key.name === "enter") { cleanup(); process.stdout.write("\n"); resolve(value); return; }
      if (key.name === "backspace") { if (value.length) { value = value.slice(0, -1); process.stdout.write("\b \b"); } return; }
      if (chunk && !key.ctrl && !key.meta && chunk >= " ") { value += chunk; process.stdout.write("*"); }
    };
    const cleanup = () => { process.stdin.off("keypress", onKey); process.stdin.setRawMode(false); };
    process.stdin.on("keypress", onKey);
  });
}

async function login(baseUrl, password) {
  const response = await fetch(`${baseUrl}/admin/api/cockpit/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ password }), redirect: "manual", signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(response.status === 401 ? "Das Outbound-Tool-Passwort ist nicht korrekt." : `Anmeldung fehlgeschlagen (${response.status}).`);
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""];
  const joined = cookies.join(";");
  const match = joined.match(/(?:^|[;,]\s*)dg_cockpit=([^;]+)/);
  if (!match) throw new Error("Die Anmeldung war erfolgreich, aber das lokale Sitzungstoken fehlt.");
  return match[1];
}

try {
  console.log("\nJJ-Media WhatsApp + lokale KI – einmalige Einrichtung\n");
  let previous = {};
  try { previous = JSON.parse(readFileSync(configPath, "utf8")); } catch { /* first setup */ }
  const baseInput = await rl.question(`Outbound-Tool-Adresse [${previous.baseUrl || "https://jj-media-social-outbound.vercel.app"}]: `);
  const baseUrl = normalizeBase(baseInput || previous.baseUrl);
  const password = await hiddenQuestion("Outbound-Tool-Passwort: ");
  const cookie = await login(baseUrl, password);
  const config = {
    baseUrl,
    cookie,
    workerId: previous.workerId || randomUUID(),
    ollamaModel: previous.ollamaModel || DEFAULT_MODEL,
    createdAt: previous.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  writeFileSync(configPath, JSON.stringify(config, null, 2), { encoding: "utf8", mode: 0o600 });
  const status = await fetch(`${baseUrl}/admin/api/whatsapp/worker`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `dg_cockpit=${cookie}` },
    body: JSON.stringify({ action: "status", workerId: config.workerId, connected: false, phone: "", qr: "", version: "baileys-6.7.24+ollama-1", aiReady: false, aiModel: config.ollamaModel }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!status.ok) throw new Error(`Der WhatsApp-Bereich des Outbound Tools antwortet noch nicht korrekt (${status.status}).`);
  console.log("\n✓ Laptop mit dem JJ-Media Outbound Tool gekoppelt.");
  console.log(`✓ Lokales KI-Modell: ${config.ollamaModel}`);
  console.log("✓ Das Passwort wurde NICHT gespeichert.");
  console.log("\nAls Nächstes startet WhatsApp automatisch. Beim ersten Start QR-Code scannen.\n");
} finally {
  rl.close();
}
