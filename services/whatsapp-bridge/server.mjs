import makeWASocket, { DisconnectReason, useMultiFileAuthState } from "@whiskeysockets/baileys";
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import pino from "pino";
import QRCode from "qrcode";
import qrcodeTerminal from "qrcode-terminal";

const root = dirname(fileURLToPath(import.meta.url));
const dataDir = join(root, "data");
const authDir = join(dataDir, "auth");
const configPath = join(dataDir, "config.json");
const ledgerPath = join(dataDir, "send-ledger.json");
const pidPath = join(dataDir, "worker.pid");
mkdirSync(dataDir, { recursive: true });
mkdirSync(authDir, { recursive: true });

if (!existsSync(configPath)) {
  console.error("Noch nicht eingerichtet. Bitte zuerst INSTALL-WHATSAPP.bat ausführen.");
  process.exit(1);
}
const config = JSON.parse(readFileSync(configPath, "utf8"));
if (!config.baseUrl || !config.cookie || !config.workerId) throw new Error("Lokale Konfiguration unvollständig. INSTALL-WHATSAPP.bat erneut ausführen.");
const ollamaModel = String(config.ollamaModel || "qwen3:4b");
const ollamaUrl = "http://127.0.0.1:11434";

function acquirePid() {
  if (existsSync(pidPath)) {
    const old = Number(readFileSync(pidPath, "utf8"));
    if (Number.isInteger(old) && old > 0) {
      try { process.kill(old, 0); console.error("JJ-Media WhatsApp läuft bereits."); process.exit(0); } catch { /* stale pid */ }
    }
  }
  writeFileSync(pidPath, String(process.pid));
}
acquirePid();

let ledger = {};
try { ledger = JSON.parse(readFileSync(ledgerPath, "utf8")); } catch { ledger = {}; }
function saveLedger() {
  const entries = Object.entries(ledger).sort((a, b) => String(b[1]?.updatedAt || "").localeCompare(String(a[1]?.updatedAt || ""))).slice(0, 2000);
  ledger = Object.fromEntries(entries);
  const tmp = `${ledgerPath}.tmp`;
  writeFileSync(tmp, JSON.stringify(ledger, null, 2), { encoding: "utf8", mode: 0o600 });
  rmSync(ledgerPath, { force: true });
  writeFileSync(ledgerPath, readFileSync(tmp));
  rmSync(tmp, { force: true });
}

async function api(payload, timeout = 30_000) {
  const response = await fetch(`${config.baseUrl}/admin/api/whatsapp/worker`, { method: "POST", headers: { "content-type": "application/json", cookie: `dg_cockpit=${config.cookie}` }, body: JSON.stringify(payload), redirect: "error", signal: AbortSignal.timeout(timeout) });
  if (response.status === 401) throw new Error("Laptop-Anmeldung abgelaufen oder geändert. INSTALL-WHATSAPP.bat erneut ausführen.");
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(value.error || `Outbound Tool meldet HTTP ${response.status}`);
  return value;
}

function digitsFromJid(jid) {
  if (typeof jid !== "string" || !jid.endsWith("@s.whatsapp.net")) return "";
  return jid.slice(0, -"@s.whatsapp.net".length).split(":")[0].replace(/\D/g, "");
}
function phoneFromKey(key) {
  const alt = digitsFromJid(key?.remoteJidAlt);
  return alt || digitsFromJid(key?.remoteJid);
}
function unwrap(input) {
  let msg = input || {};
  for (let i = 0; i < 4; i += 1) {
    if (msg.ephemeralMessage?.message) { msg = msg.ephemeralMessage.message; continue; }
    if (msg.viewOnceMessage?.message) { msg = msg.viewOnceMessage.message; continue; }
    if (msg.viewOnceMessageV2?.message) { msg = msg.viewOnceMessageV2.message; continue; }
    if (msg.documentWithCaptionMessage?.message) { msg = msg.documentWithCaptionMessage.message; continue; }
    break;
  }
  return msg;
}
function messageContent(input) {
  const msg = unwrap(input);
  if (typeof msg.conversation === "string") return { kind: "text", body: msg.conversation };
  if (typeof msg.extendedTextMessage?.text === "string") return { kind: "text", body: msg.extendedTextMessage.text };
  if (msg.imageMessage) return { kind: "image", body: msg.imageMessage.caption || "" };
  if (msg.audioMessage) return { kind: "audio", body: "" };
  if (msg.videoMessage) return { kind: "video", body: msg.videoMessage.caption || "" };
  if (msg.documentMessage) return { kind: "document", body: msg.documentMessage.caption || "" };
  return { kind: "other", body: "" };
}
function receiptStatus(value) {
  const n = Number(value);
  if (n >= 4) return "read";
  if (n >= 3) return "delivered";
  if (n >= 2) return "sent";
  return "";
}
function dataUrlBuffer(dataUrl) {
  const match = String(dataUrl || "").match(/^data:([^;]+);base64,(.+)$/s);
  if (!match) throw new Error("Ungültiger Anhang vom Outbound Tool.");
  return { mime: match[1], buffer: Buffer.from(match[2], "base64") };
}

let sock = null;
let connected = false;
let phone = "";
let qrData = "";
let stopping = false;
let pumpBusy = false;
let aiPumpBusy = false;
let aiReady = false;
let aiLastError = "";
const inFlight = new Map();
const logger = pino({ level: "silent" });

async function checkOllama() {
  try {
    const response = await fetch(`${ollamaUrl}/api/tags`, { signal: AbortSignal.timeout(4_000), cache: "no-store" });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    const models = Array.isArray(payload.models) ? payload.models : [];
    const installed = models.some((entry) => entry?.name === ollamaModel || entry?.model === ollamaModel);
    aiReady = installed;
    aiLastError = installed ? "" : `Modell ${ollamaModel} fehlt. INSTALL-WHATSAPP.bat erneut ausführen.`;
    return aiReady;
  } catch (error) {
    aiReady = false;
    aiLastError = `Ollama nicht erreichbar: ${error.message}`;
    return false;
  }
}

async function statusHeartbeat() {
  try { await api({ action: "status", workerId: config.workerId, connected, phone, qr: connected ? "" : qrData, version: "baileys-6.7.24+ollama-1", aiReady, aiModel: ollamaModel }, 20_000); }
  catch (error) { console.warn(`Status: ${error.message}`); }
}

async function runLocalAi(job) {
  if (!aiReady && !await checkOllama()) throw new Error(aiLastError || "Ollama ist nicht bereit.");
  const response = await fetch(`${ollamaUrl}/api/chat`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      model: ollamaModel,
      messages: Array.isArray(job.messages) ? job.messages : [],
      stream: false,
      think: false,
      format: job.format || "json",
      options: { temperature: 0.2, num_predict: 1400, top_p: 0.9 },
      keep_alive: "15m",
    }),
    signal: AbortSignal.timeout(55_000),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status >= 500) aiReady = false;
    throw new Error(payload.error || `Ollama meldet HTTP ${response.status}`);
  }
  const content = payload?.message?.content;
  if (typeof content !== "string" || !content.trim()) throw new Error("Ollama hat keinen nutzbaren Entwurf geliefert.");
  aiReady = true;
  aiLastError = "";
  return { content: content.trim(), model: String(payload.model || ollamaModel) };
}

async function aiPump() {
  if (aiPumpBusy || stopping) return;
  aiPumpBusy = true;
  try {
    const result = await api({ action: "ai_pull", workerId: config.workerId }, 20_000);
    const job = result.job;
    if (!job) return;
    try {
      const output = await runLocalAi(job);
      await api({ action: "ai_result", workerId: config.workerId, jobId: job.id, model: output.model, content: output.content }, 20_000);
    } catch (error) {
      await api({ action: "ai_result", workerId: config.workerId, jobId: job.id, model: ollamaModel, error: error.message || "Lokale KI fehlgeschlagen" }, 20_000).catch(() => undefined);
      console.warn(`KI: ${error.message}`);
    }
  } catch (error) {
    console.warn(`KI-Pumpe: ${error.message}`);
  } finally { aiPumpBusy = false; }
}

function contentForSend(message) {
  if (!message.attachment) return { text: message.body || "" };
  const decoded = dataUrlBuffer(message.attachment.dataUrl);
  const mime = message.attachment.mime || decoded.mime;
  if (mime.startsWith("image/")) return { image: decoded.buffer, caption: message.body || undefined, mimetype: mime };
  if (mime.startsWith("audio/")) return { audio: decoded.buffer, mimetype: mime, ptt: false };
  return { document: decoded.buffer, mimetype: mime, fileName: message.attachment.filename || "Dokument", caption: message.body || undefined };
}

async function sendPulled(message) {
  const previous = ledger[message.id];
  if (previous?.status === "sent" && previous.providerId) {
    await api({ action: "ack", workerId: config.workerId, messageId: message.id, status: "sent", providerId: previous.providerId });
    return;
  }
  if (previous && ["sending", "unknown"].includes(previous.status)) {
    await api({ action: "ack", workerId: config.workerId, messageId: message.id, status: "unknown", error: "Lokaler Versand war nach einem Neustart nicht eindeutig bestätigt; kein automatischer Neuversand." });
    return;
  }
  ledger[message.id] = { status: "sending", to: message.to, body: message.body, updatedAt: new Date().toISOString() };
  saveLedger();
  inFlight.set(message.id, { to: message.to, body: message.body || "" });
  try {
    const jid = `${String(message.to).replace(/\D/g, "")}@s.whatsapp.net`;
    const result = await sock.sendMessage(jid, contentForSend(message));
    const providerId = result?.key?.id;
    if (!providerId) throw new Error("WhatsApp lieferte keine Nachrichten-ID.");
    ledger[message.id] = { status: "sent", providerId, to: message.to, body: message.body, updatedAt: new Date().toISOString() };
    saveLedger();
    await api({ action: "ack", workerId: config.workerId, messageId: message.id, status: "sent", providerId });
  } catch (error) {
    ledger[message.id] = { status: "unknown", to: message.to, body: message.body, error: error.message, updatedAt: new Date().toISOString() };
    saveLedger();
    try { await api({ action: "ack", workerId: config.workerId, messageId: message.id, status: "unknown", error: error.message || "Versandstatus unklar" }); } catch { /* surfaced on next UI refresh */ }
    throw error;
  } finally {
    inFlight.delete(message.id);
  }
}

async function pump() {
  if (!connected || !sock || pumpBusy || stopping) return;
  pumpBusy = true;
  try {
    const result = await api({ action: "pull", workerId: config.workerId }, 35_000);
    if (result.message) await sendPulled(result.message);
  } catch (error) {
    console.warn(`Versand: ${error.message}`);
  } finally { pumpBusy = false; }
}

async function handleMessage(entry) {
  const key = entry?.key || {};
  const jid = key.remoteJid || "";
  if (jid === "status@broadcast" || jid.endsWith("@g.us") || jid.endsWith("@newsletter")) return;
  const phoneNumber = phoneFromKey(key);
  if (!phoneNumber || !key.id) return;
  const content = messageContent(entry.message);
  if (content.kind === "other") return;
  if (key.fromMe && [...inFlight.values()].some((row) => row.to === phoneNumber && row.body === content.body)) return;
  if (key.fromMe && Object.values(ledger).some((row) => row?.providerId === key.id)) return;
  try {
    await api({ action: "event", workerId: config.workerId, id: key.id, phone: phoneNumber, body: content.body, kind: content.kind, timestamp: new Date(Number(entry.messageTimestamp || Date.now() / 1000) * 1000).toISOString(), fromMe: key.fromMe === true }, 115_000);
  } catch (error) { console.warn(`Chat-Sync: ${error.message}`); }
}

async function connect() {
  if (stopping) return;
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  sock = makeWASocket({ auth: state, logger, markOnlineOnConnect: false, syncFullHistory: false, browser: ["JJ Media Outbound", "Chrome", "1.0.0"], generateHighQualityLinkPreview: false });
  sock.ev.on("creds.update", saveCreds);
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type !== "notify") return;
    for (const entry of messages || []) void handleMessage(entry);
  });
  sock.ev.on("messages.update", (updates) => {
    for (const row of updates || []) {
      const providerId = row?.key?.id;
      const status = receiptStatus(row?.update?.status);
      if (providerId && status) void api({ action: "receipt", workerId: config.workerId, providerId, status }).catch(() => undefined);
    }
  });
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr }) => {
    if (qr) {
      connected = false;
      qrData = await QRCode.toDataURL(qr, { margin: 1, width: 360 });
      console.log("\nWhatsApp verbinden: QR-Code scannen\n");
      qrcodeTerminal.generate(qr, { small: true });
      console.log("Alternativ: Outbound Tool → WhatsApp → Verbindungen.\n");
      await statusHeartbeat();
    }
    if (connection === "open") {
      connected = true;
      phone = digitsFromJid(sock.user?.id || "");
      qrData = "";
      console.log(`✓ WhatsApp verbunden${phone ? ` (+${phone})` : ""}. Outbound Tool ist bereit.`);
      console.log(aiReady ? `✓ Lokale KI bereit (${ollamaModel}).` : `! Lokale KI noch nicht bereit: ${aiLastError || "Ollama wird geprüft"}`);
      await statusHeartbeat();
      void api({ action: "tick", workerId: config.workerId }).catch(() => undefined);
    }
    if (connection === "close") {
      connected = false;
      const error = lastDisconnect?.error;
      const code = Number(error?.output?.statusCode || error?.statusCode || error?.data?.statusCode || 0);
      if (code === Number(DisconnectReason.loggedOut)) {
        console.warn("WhatsApp wurde abgemeldet. Die lokale Kopplung wird zurückgesetzt.");
        rmSync(authDir, { recursive: true, force: true });
        mkdirSync(authDir, { recursive: true });
      } else console.warn("WhatsApp-Verbindung getrennt – verbinde erneut …");
      await statusHeartbeat();
      if (!stopping) setTimeout(() => void connect().catch((err) => console.warn(err.message)), 2_500);
    }
  });
}

const statusTimer = setInterval(() => void statusHeartbeat(), 20_000);
const pumpTimer = setInterval(() => void pump(), 2_500);
const aiTimer = setInterval(() => void aiPump(), 1_200);
const ollamaTimer = setInterval(() => void checkOllama().then(() => statusHeartbeat()), 30_000);
const tickTimer = setInterval(() => { if (connected && !stopping) void api({ action: "tick", workerId: config.workerId }, 110_000).catch((error) => console.warn(`Automatik: ${error.message}`)); }, 60_000);

async function shutdown() {
  if (stopping) return;
  stopping = true;
  clearInterval(statusTimer); clearInterval(pumpTimer); clearInterval(aiTimer); clearInterval(ollamaTimer); clearInterval(tickTimer);
  connected = false; qrData = "";
  try { await statusHeartbeat(); } catch { /* best effort */ }
  try { unlinkSync(pidPath); } catch { /* best effort */ }
  process.exit(0);
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
process.once("exit", () => { try { unlinkSync(pidPath); } catch { /* best effort */ } });

console.log("JJ-Media WhatsApp startet – Baileys + lokale Ollama-KI, kein Dify, kein KI-API-Abo.");
void checkOllama().then(() => statusHeartbeat());
connect().catch((error) => { console.error(error); shutdown(); });
