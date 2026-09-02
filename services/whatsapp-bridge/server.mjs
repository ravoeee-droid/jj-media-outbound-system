import { createServer } from "node:http";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { createRequire } from "node:module";
import { authorized, BridgeError, incomingMessage, Ledger, signature, validateSend } from "./core.mjs";

const require = createRequire(import.meta.url);
const { create, ev } = require("@open-wa/wa-automate");
const key = process.env.WHATSAPP_BRIDGE_KEY || "";
const secret = process.env.WHATSAPP_WEBHOOK_SECRET || "";
const workspaceId = process.env.WHATSAPP_WORKSPACE_ID || "";
const webhook = new URL(process.env.WHATSAPP_WEBHOOK_URL || "http://invalid");
if (key.length < 32 || secret.length < 32 || !/^[a-f0-9-]{36}$/i.test(workspaceId) || webhook.protocol !== "https:") throw new Error("Configure bridge key, webhook secret, workspace ID and HTTPS webhook URL before starting.");
const directory = process.env.DATA_DIR || "./data";
mkdirSync(directory, { recursive: true, mode: 0o700 });
const ledger = new Ledger(join(directory, "delivery.sqlite"));
let client;
let connected = false;
let phone = "";
let qr = "";
let qrAt = 0;
let lastWebhookAt = null;
let activeHooks = 0;
let ticking = false;
let stopping = false;

function json(response, status, body) {
  response.writeHead(status, { "content-type": "application/json", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  response.end(JSON.stringify(body));
}

const server = createServer(async (request, response) => {
  if (!authorized(request.headers.authorization, key)) return json(response, 401, { error: "unauthorized" });
  try {
    const url = new URL(request.url, "http://localhost");
    if (request.method === "GET" && url.pathname === "/health") return json(response, 200, { connected, phone, qr: !connected && Date.now() - qrAt < 90_000 ? qr : "", lastWebhookAt, pendingEvents: ledger.pending() });
    if (request.method === "GET" && url.pathname === "/status") return json(response, 200, ledger.status(url.searchParams.get("id") || ""));
    if (request.method !== "POST" || url.pathname !== "/send") return json(response, 404, { error: "not_found" });
    if (Number(request.headers["content-length"] || 0) > 4_300_000) throw new BridgeError("payload_too_large", 413);
    const chunks = []; let size = 0;
    for await (const chunk of request) { size += chunk.length; if (size > 4_300_000) throw new BridgeError("payload_too_large", 413); chunks.push(chunk); }
    let input;
    try { input = validateSend(JSON.parse(Buffer.concat(chunks).toString("utf8"))); } catch (error) { if (error instanceof BridgeError) throw error; throw new BridgeError("invalid_json"); }
    const previous = ledger.status(input.id);
    if (previous.status === "not_found" && (!client || !connected || await client.getConnectionState() !== "CONNECTED")) throw new BridgeError("not_connected", 503);
    const result = await ledger.sendOnce(input, async (message) => {
      const to = `${message.to}@c.us`;
      if (message.attachment) return client.sendFile(to, message.attachment.dataUrl, message.attachment.filename, message.body, undefined, true, false, message.attachment.mime === "application/pdf");
      return client.sendText(to, message.body);
    });
    return json(response, result.status === "sent" ? 200 : 202, result);
  } catch (error) { return json(response, error instanceof BridgeError ? error.status : 503, { error: error instanceof BridgeError ? error.message : "bridge_unavailable" }); }
});
server.requestTimeout = 30_000;
server.headersTimeout = 10_000;
server.listen(Number(process.env.PORT || 3001), "0.0.0.0");

async function postWebhook(payload) {
  return fetch(webhook, { method: "POST", headers: { "content-type": "application/json", ...signature(payload, secret) }, body: payload, redirect: "error", signal: AbortSignal.timeout(110_000) });
}
async function deliverHook(row) {
  activeHooks++;
  try {
    const response = await postWebhook(row.payload);
    if (response.ok) { ledger.complete(row.id); lastWebhookAt = new Date().toISOString(); }
    else { ledger.retry(row, response.status === 400 || response.status === 413); console.warn(`Webhook deferred (HTTP ${response.status}); inspect cockpit/connection settings.`); }
  } catch { ledger.retry(row); }
  finally { activeHooks--; }
}
const hookTimer = setInterval(() => {
  if (stopping) return;
  // Parallel delivery lets a STOP invalidate an earlier slow AI turn immediately.
  while (activeHooks < 4) { const row = ledger.take(); if (!row) break; void deliverHook(row); }
}, 1_000);
const tickTimer = setInterval(async () => {
  if (stopping || ticking || !connected) return;
  ticking = true;
  try { const response = await postWebhook(JSON.stringify({ event: "tick", workspaceId })); if (response.ok) lastWebhookAt = new Date().toISOString(); } catch { /* Next heartbeat retries; app jobs are idempotent. */ }
  finally { ticking = false; }
}, 60_000);
const healthTimer = setInterval(async () => {
  if (!client || stopping) return;
  try { connected = await client.getConnectionState() === "CONNECTED"; } catch { connected = false; }
}, 15_000);
const cleanupTimer = setInterval(() => ledger.prune(), 3_600_000);

ev.on("qr.**", (value) => {
  if (typeof value === "string" && value.startsWith("data:image/png;base64,")) { qr = value; qrAt = Date.now(); connected = false; }
});

async function startWhatsApp() {
  client = await create({
    sessionId: "jj-media", sessionDataPath: directory, multiDevice: true,
    headless: true, executablePath: process.env.CHROME_PATH || "/usr/bin/chromium",
    qrTimeout: 0, authTimeout: 0, qrLogSkip: true, popup: false, disableSpins: true,
    logConsole: false, logConsoleErrors: false, skipUpdateCheck: true, safeMode: true,
    chromiumArgs: ["--no-sandbox", "--disable-dev-shm-usage"],
  });
  connected = await client.getConnectionState() === "CONNECTED";
  phone = String(await client.getHostNumber()); qr = "";
  await client.onStateChanged((state) => { connected = state === "CONNECTED"; if (connected) qr = ""; });
  await client.onMessage((message) => {
    const payload = incomingMessage(message, workspaceId);
    if (payload) ledger.enqueue(`message:${payload.id}`, payload);
  });
  await client.onAck((message) => {
    const status = Number(message.ack) >= 3 ? "read" : Number(message.ack) === 2 ? "delivered" : Number(message.ack) === 1 ? "sent" : null;
    if (!status || typeof message.id !== "string") return;
    // Give sendFile/sendText time to return their IDs before associating receipts.
    setTimeout(() => { if (!stopping && ledger.hasProvider(message.id)) ledger.enqueue(`receipt:${message.id}:${status}`, { event: "receipt", workspaceId, providerId: message.id, status }); }, 5_000);
  });
  console.info("JJ-Media WhatsApp bridge ready. Connection status is available in the cockpit.");
}
startWhatsApp().catch(() => { connected = false; console.error("WhatsApp session failed to start. Check server/browser configuration, then restart the bridge."); process.exitCode = 1; server.close(); for (const timer of [hookTimer, tickTimer, healthTimer, cleanupTimer]) clearInterval(timer); });

for (const signal of ["SIGTERM", "SIGINT"]) process.once(signal, async () => {
  stopping = true; for (const timer of [hookTimer, tickTimer, healthTimer, cleanupTimer]) clearInterval(timer);
  server.close();
  // A killed send remains unknown on restart, so it can never be submitted twice.
  try { await client?.kill(); } finally { process.exit(0); }
});
