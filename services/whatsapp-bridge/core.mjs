import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { DatabaseSync } from "node:sqlite";

export class BridgeError extends Error {
  constructor(code, status = 400) { super(code); this.status = status; }
}

export function authorized(header, key) {
  if (!key || key.length < 32 || typeof header !== "string") return false;
  return timingSafeEqual(createHash("sha256").update(header).digest(), createHash("sha256").update(`Bearer ${key}`).digest());
}

export function signature(payload, secret, timestamp = String(Date.now())) {
  return { "x-jj-timestamp": timestamp, "x-jj-signature": createHmac("sha256", secret).update(`${timestamp}.${payload}`).digest("hex") };
}

export function validateSend(input) {
  if (!input || !/^[a-f0-9-]{36}$/i.test(input.id || "") || !/^[1-9]\d{7,14}$/.test(input.to || "") || typeof input.body !== "string" || input.body.length > 4_000) throw new BridgeError("invalid_message");
  const message = { id: input.id, to: input.to, body: input.body };
  if (input.attachment) {
    const { dataUrl, filename, mime } = input.attachment;
    if (!["image/jpeg", "image/png", "image/webp", "application/pdf", "audio/mpeg", "audio/mp4", "audio/ogg", "audio/wav", "audio/webm"].includes(mime) || typeof filename !== "string" || !filename || filename.length > 180 || /[/\\\u0000-\u001f]/.test(filename) || typeof dataUrl !== "string") throw new BridgeError("invalid_attachment");
    const prefix = `data:${mime};base64,`;
    if (!dataUrl.startsWith(prefix) || !/^[a-zA-Z0-9+/]+={0,2}$/.test(dataUrl.slice(prefix.length))) throw new BridgeError("invalid_attachment");
    const size = Buffer.from(dataUrl.slice(prefix.length), "base64").length;
    if (!size || size > 3 * 1024 * 1024) throw new BridgeError("attachment_too_large", 413);
    message.attachment = { dataUrl, filename, mime };
  }
  if (!message.body.trim() && !message.attachment) throw new BridgeError("empty_message");
  return message;
}

export class Ledger {
  constructor(filename) {
    this.db = new DatabaseSync(filename);
    this.db.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA synchronous=FULL;
      PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS sends (
        id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, status TEXT NOT NULL,
        provider_id TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS sends_provider_id ON sends(provider_id);
      CREATE TABLE IF NOT EXISTS hooks (
        id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending',
        attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL, created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS hooks_due ON hooks(state, next_at);
      UPDATE sends SET status='unknown' WHERE status='sending';
      UPDATE hooks SET state='pending' WHERE state='running';
    `);
  }
  close() { this.db.close(); }
  status(id) {
    const row = this.db.prepare("SELECT status, provider_id FROM sends WHERE id=?").get(id);
    return row ? { status: row.status, ...(row.provider_id ? { providerId: row.provider_id } : {}) } : { status: "not_found" };
  }
  hasProvider(providerId) { return Boolean(this.db.prepare("SELECT id FROM sends WHERE provider_id=?").get(providerId)); }
  async sendOnce(raw, send) {
    const input = validateSend(raw);
    const fingerprint = createHash("sha256").update(JSON.stringify(input)).digest("hex");
    const previous = this.db.prepare("SELECT fingerprint FROM sends WHERE id=?").get(input.id);
    if (previous) {
      if (previous.fingerprint !== fingerprint) throw new BridgeError("idempotency_conflict", 409);
      return this.status(input.id);
    }
    const now = Date.now();
    // Commit before calling WhatsApp. A process crash leaves an unknown send, never an automatic retry.
    this.db.prepare("INSERT INTO sends(id,fingerprint,status,created_at,updated_at) VALUES(?,?,'sending',?,?)").run(input.id, fingerprint, now, now);
    try {
      const providerId = await send(input);
      // OpenWA may return true without an ID; that is not a delivery confirmation.
      if (typeof providerId !== "string" || !/^(?:true|false)_\d+@(?:c\.us|lid)_[a-zA-Z0-9_-]+$/.test(providerId)) throw new Error("unconfirmed_send");
      this.db.prepare("UPDATE sends SET status='sent', provider_id=?, updated_at=? WHERE id=?").run(providerId, Date.now(), input.id);
      return this.status(input.id);
    } catch {
      this.db.prepare("UPDATE sends SET status='unknown', updated_at=? WHERE id=?").run(Date.now(), input.id);
      return { status: "unknown" };
    }
  }
  enqueue(id, payload, delay = 0) {
    this.db.prepare("INSERT OR IGNORE INTO hooks(id,payload,next_at,created_at) VALUES(?,?,?,?)").run(id, JSON.stringify(payload), Date.now() + delay, Date.now());
  }
  take() {
    const row = this.db.prepare("SELECT * FROM hooks WHERE state='pending' AND next_at<=? ORDER BY created_at LIMIT 1").get(Date.now());
    if (!row) return null;
    this.db.prepare("UPDATE hooks SET state='running' WHERE id=?").run(row.id);
    return row;
  }
  complete(id) {
    // Keep only IDs after delivery: no indefinite second copy of conversation text.
    this.db.prepare("UPDATE hooks SET state='done', payload='{}' WHERE id=?").run(id);
  }
  retry(row, permanent = false) {
    const attempts = row.attempts + 1;
    this.db.prepare("UPDATE hooks SET state=?, attempts=?, next_at=? WHERE id=?").run(permanent ? "blocked" : "pending", attempts, Date.now() + Math.min(300_000, 1_000 * 2 ** Math.min(attempts, 9)), row.id);
  }
  pending() { return this.db.prepare("SELECT count(*) AS total FROM hooks WHERE state NOT IN ('done')").get().total; }
  prune() { this.db.prepare("DELETE FROM hooks WHERE state='done' AND created_at<?").run(Date.now() - 30 * 86_400_000); }
}

export function incomingMessage(message, workspaceId) {
  if (message.fromMe || message.isGroupMsg || message.broadcast || typeof message.from !== "string" || !/^\d+@c\.us$/.test(message.from) || typeof message.id !== "string") return null;
  const kind = ({ chat: "text", text: "text", image: "image", ptt: "audio", audio: "audio", document: "document", video: "video" })[message.type] || "other";
  const timestamp = Number(message.t || message.timestamp) * 1000;
  return {
    event: "message", workspaceId, id: message.id, phone: message.from.replace(/@c\.us$/, ""),
    body: String(message.body || message.caption || "").slice(0, 8_000), kind,
    timestamp: new Date(Number.isFinite(timestamp) && timestamp > 0 ? timestamp : Date.now()).toISOString(), fromMe: false,
  };
}
