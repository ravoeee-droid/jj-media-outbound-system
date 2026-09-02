import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { authorized, incomingMessage, Ledger, signature, validateSend } from "./core.mjs";

const sample = () => ({ id: randomUUID(), to: "491701234567", body: "Wie besprochen: Hier sind die Informationen." });
const providerId = "true_491701234567@c.us_TEST123";

test("duplicate and simultaneous requests submit exactly one WhatsApp message", async () => {
  const ledger = new Ledger(":memory:");
  let calls = 0; let complete;
  const input = sample();
  const first = ledger.sendOnce(input, async () => { calls++; return new Promise((resolve) => { complete = resolve; }); });
  assert.deepEqual(await ledger.sendOnce(input, () => { calls++; }), { status: "sending" });
  complete(providerId);
  assert.deepEqual(await first, { status: "sent", providerId });
  assert.deepEqual(await ledger.sendOnce(input, () => { calls++; }), { status: "sent", providerId });
  assert.equal(calls, 1); ledger.close();
});

test("timeout after acceptance stays unknown across restarts and is not resent", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jj-wa-test-"));
  const path = join(directory, "ledger.sqlite"); const input = sample(); let calls = 0;
  let ledger = new Ledger(path);
  assert.equal((await ledger.sendOnce(input, () => { calls++; throw new Error("connection lost after send"); })).status, "unknown");
  ledger.close(); ledger = new Ledger(path);
  assert.equal((await ledger.sendOnce(input, () => { calls++; return providerId; })).status, "unknown");
  assert.equal(calls, 1); ledger.close(); rmSync(directory, { recursive: true });
});

test("an in-flight process crash does not turn into a resend", async () => {
  const directory = mkdtempSync(join(tmpdir(), "jj-wa-test-"));
  const path = join(directory, "ledger.sqlite"); const input = sample();
  let ledger = new Ledger(path);
  void ledger.sendOnce(input, () => new Promise(() => {})); ledger.close(); ledger = new Ledger(path);
  assert.equal((await ledger.sendOnce(input, () => { throw new Error("must never be called"); })).status, "unknown");
  ledger.close(); rmSync(directory, { recursive: true });
});

test("reusing an ID for different text or recipient is rejected", async () => {
  const ledger = new Ledger(":memory:"); const input = sample();
  await ledger.sendOnce(input, () => providerId);
  await assert.rejects(ledger.sendOnce({ ...input, body: "Another message" }, () => providerId), /idempotency_conflict/);
  await assert.rejects(ledger.sendOnce({ ...input, to: "491701111111" }, () => providerId), /idempotency_conflict/);
  ledger.close();
});

test("OpenWA boolean response never becomes a fabricated sent receipt", async () => {
  const ledger = new Ledger(":memory:");
  assert.equal((await ledger.sendOnce(sample(), () => true)).status, "unknown"); ledger.close();
});

test("attachments cannot trigger arbitrary URL downloads or group sending", () => {
  assert.throws(() => validateSend({ ...sample(), to: "123@g.us" }));
  assert.throws(() => validateSend({ ...sample(), attachment: { mime: "image/png", filename: "x.png", dataUrl: "http://169.254.169.254/latest" } }));
  assert.throws(() => validateSend({ ...sample(), attachment: { mime: "image/png", filename: "../../file", dataUrl: "data:image/png;base64,AAAA" } }));
  assert.throws(() => validateSend({ ...sample(), attachment: { mime: "text/html", filename: "x.html", dataUrl: "data:text/html;base64,AAAA" } }));
});

test("group chats, broadcasts and own messages never enter the CRM", () => {
  const message = { id: "test", from: "491701234567@c.us", body: "Hallo", type: "chat", t: 1788310000 };
  assert.equal(incomingMessage({ ...message, isGroupMsg: true }, "workspace"), null);
  assert.equal(incomingMessage({ ...message, fromMe: true }, "workspace"), null);
  assert.equal(incomingMessage({ ...message, broadcast: true }, "workspace"), null);
  assert.equal(incomingMessage(message, "workspace").kind, "text");
});

test("webhook queue persists retries and deduplicates event IDs", () => {
  const ledger = new Ledger(":memory:"); ledger.enqueue("m:1", { body: "Hallo" }); ledger.enqueue("m:1", { body: "Hallo" });
  const row = ledger.take(); assert.ok(row); assert.equal(ledger.take(), null);
  ledger.retry(row); assert.equal(ledger.pending(), 1); ledger.complete(row.id); assert.equal(ledger.pending(), 0);
  assert.equal(ledger.db.prepare("SELECT payload FROM hooks WHERE id=?").get(row.id).payload, "{}"); ledger.close();
});

test("bridge authentication rejects missing and wrong keys", () => {
  const key = "k".repeat(64); assert.equal(authorized(`Bearer ${key}`, key), true);
  assert.equal(authorized(`Bearer ${"x".repeat(64)}`, key), false); assert.equal(authorized(undefined, key), false);
  assert.notEqual(signature("a", key, "123")["x-jj-signature"], signature("b", key, "123")["x-jj-signature"]);
});
