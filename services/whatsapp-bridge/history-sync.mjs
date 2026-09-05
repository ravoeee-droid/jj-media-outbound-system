const HISTORY_ENDPOINT = "/admin/api/whatsapp/history";

function digitsFromPnJid(value) {
  if (typeof value !== "string" || !value.endsWith("@s.whatsapp.net")) return "";
  return value.slice(0, -"@s.whatsapp.net".length).split(":")[0].replace(/\D/g, "");
}

function contactName(contact) {
  return String(contact?.name || contact?.notify || contact?.verifiedName || contact?.displayName || contact?.username || "").trim().slice(0, 180);
}

function messageLabel(kind) {
  if (kind === "audio") return "[Sprachnachricht]";
  if (kind === "image") return "[Bild]";
  if (kind === "video") return "[Video]";
  if (kind === "document") return "[Dokument]";
  return "";
}

export function installHistorySync({ sock, config, messageContent, phoneFromKey }) {
  let stopped = false;
  let chain = Promise.resolve();
  let lastSweep = 0;
  const names = new Map();
  const phoneByJid = new Map();

  async function historyApi(payload, timeout = 115_000) {
    const response = await fetch(`${config.baseUrl}${HISTORY_ENDPOINT}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: `dg_cockpit=${config.cookie}` },
      body: JSON.stringify(payload),
      redirect: "error",
      signal: AbortSignal.timeout(timeout),
    });
    if (response.status === 401) throw new Error("Laptop-Anmeldung abgelaufen. INSTALL-WHATSAPP.bat erneut ausführen.");
    const value = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(value.error || `History API meldet HTTP ${response.status}`);
    return value;
  }

  function rememberContact(contact) {
    const id = String(contact?.id || "");
    const lid = String(contact?.lid || contact?.lidJid || "");
    const phoneJid = String(contact?.phoneNumber || contact?.pnJid || "");
    const pn = digitsFromPnJid(phoneJid) || digitsFromPnJid(id);
    const name = contactName(contact);
    for (const jid of [id, lid, phoneJid].filter(Boolean)) {
      if (name) names.set(jid, name);
      if (pn) phoneByJid.set(jid, pn);
    }
  }

  function rememberCollections(contacts = [], chats = []) {
    for (const contact of contacts || []) rememberContact(contact);
    for (const chat of chats || []) rememberContact(chat);
  }

  function resolvePhone(entry) {
    const direct = phoneFromKey(entry?.key || {});
    if (direct) return direct;
    const key = entry?.key || {};
    for (const jid of [key.remoteJidAlt, key.remoteJid, key.participantAlt, key.participant]) {
      const mapped = phoneByJid.get(String(jid || ""));
      if (mapped) return mapped;
      const pn = digitsFromPnJid(String(jid || ""));
      if (pn) return pn;
    }
    return "";
  }

  function resolveName(entry) {
    if (entry?.pushName) return String(entry.pushName).trim().slice(0, 180);
    const key = entry?.key || {};
    for (const jid of [key.remoteJid, key.remoteJidAlt, key.participant, key.participantAlt]) {
      const name = names.get(String(jid || ""));
      if (name) return name;
    }
    return "";
  }

  function toRecord(entry) {
    const key = entry?.key || {};
    const jid = String(key.remoteJid || "");
    if (!key.id || jid === "status@broadcast" || jid.endsWith("@g.us") || jid.endsWith("@newsletter")) return null;
    const phone = resolvePhone(entry);
    if (!phone) return null;
    const content = messageContent(entry.message);
    if (!content || content.kind === "other") return null;
    const timestampMs = Number(entry.messageTimestamp || Date.now() / 1000) * 1000;
    const timestamp = new Date(Number.isFinite(timestampMs) ? timestampMs : Date.now()).toISOString();
    return {
      id: String(key.id),
      phone,
      name: resolveName(entry),
      body: String(content.body || messageLabel(content.kind)).slice(0, 8_000),
      kind: content.kind,
      timestamp,
      fromMe: key.fromMe === true,
    };
  }

  async function sendRecords(records) {
    const usable = records.filter(Boolean);
    if (!usable.length) return { inserted: 0 };
    let inserted = 0;
    let unresolved = records.length - usable.length;
    for (let i = 0; i < usable.length; i += 100) {
      if (stopped) break;
      const batch = usable.slice(i, i + 100);
      const result = await historyApi({ action: "batch", workerId: config.workerId, messages: batch });
      inserted += Number(result.inserted || 0);
      unresolved += Number(result.unresolved || 0);
    }
    return { inserted, unresolved };
  }

  function enqueue(entries, label = "Historie") {
    const records = (entries || []).map(toRecord);
    chain = chain.then(async () => {
      if (stopped) return;
      const result = await sendRecords(records);
      if (result.inserted || result.unresolved) console.log(`✓ ${label}: ${result.inserted} Nachrichten importiert${result.unresolved ? `, ${result.unresolved} ohne auflösbare Nummer übersprungen` : ""}.`);
      await sweep();
    }).catch((error) => console.warn(`${label}: ${error.message}`));
    return chain;
  }

  async function sweep(force = false) {
    if (stopped) return;
    if (!force && Date.now() - lastSweep < 20_000) return;
    lastSweep = Date.now();
    try { await historyApi({ action: "sweep", workerId: config.workerId }, 110_000); }
    catch (error) { console.warn(`Lead-Radar: ${error.message}`); }
  }

  sock.ev.on("contacts.upsert", (contacts) => rememberCollections(contacts, []));
  sock.ev.on("chats.upsert", (chats) => rememberCollections([], chats));
  sock.ev.on("messaging-history.set", ({ chats, contacts, messages, isLatest, syncType }) => {
    rememberCollections(contacts, chats);
    const label = `WhatsApp-Historie${syncType !== undefined ? ` (${syncType})` : ""}`;
    void enqueue(messages, label).then(() => { if (isLatest) void sweep(true); });
  });
  sock.ev.on("messages.upsert", ({ messages, type }) => {
    if (type === "append") void enqueue(messages, "WhatsApp-Nachlauf");
  });

  const timer = setInterval(() => void sweep(), 30_000);

  return {
    ingest(entry) { return enqueue([entry], "Neuer WhatsApp-Kontakt"); },
    sweep: () => sweep(true),
    stop() { stopped = true; clearInterval(timer); },
  };
}
