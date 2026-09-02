import test from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { agentConfigSchema, chosenSlot, DEFAULT_AGENT, effectiveMode, guardDecision, isOptOut, normalizePhone, requiresHuman, selectKnowledge } from "../lib/whatsapp/policy.ts";
import { verifyWebhook } from "../lib/whatsapp/provider.ts";

const now = Date.parse("2026-09-02T08:00:00Z");
const slot = (hour, day = "02", expiresAt = "2026-09-02T08:15:00Z") => ({ id: `${day}-${hour}`, start: `2026-09-${day}T${hour}:00:00Z`, end: `2026-09-${day}T${hour}:15:00Z`, label: `Mi., ${day}.09.2026, ${Number(hour) + 2}:00`, expiresAt, configVersion: 0, calendarId: "primary" });

test("defaults pause all automation and cap daily first contacts at 30", () => {
  assert.equal(DEFAULT_AGENT.enabled, false); assert.equal(DEFAULT_AGENT.dailyOutreachEnabled, false);
  assert.equal(DEFAULT_AGENT.allowBooking, false); assert.equal(DEFAULT_AGENT.defaultMode, "copilot");
  assert.equal(agentConfigSchema.safeParse({ dailyOutreachLimit: 31 }).success, false);
  assert.equal(agentConfigSchema.safeParse({ outreachStartHour: 18, outreachEndHour: 9 }).success, false);
});

test("global pause, global copilot, and human takeover override per-contact autopilot", () => {
  assert.equal(effectiveMode(DEFAULT_AGENT, "autopilot"), "manual");
  const active = { ...DEFAULT_AGENT, enabled: true, defaultMode: "autopilot" };
  assert.equal(effectiveMode(active, "autopilot"), "autopilot");
  assert.equal(effectiveMode(active, "manual"), "manual");
  assert.equal(effectiveMode({ ...active, defaultMode: "copilot" }, "autopilot"), "copilot");
  assert.equal(effectiveMode({ ...active, defaultMode: "manual" }, "autopilot"), "manual");
});

test("unapproved company data and placeholder prices are never retrieved", () => {
  const entries = selectKnowledge(DEFAULT_AGENT.knowledge, "Preise Leistung Referenzen");
  assert.ok(entries.every((entry) => entry.approved)); assert.ok(!entries.some((entry) => entry.id === "jj-prices"));
  assert.deepEqual(selectKnowledge([{ ...DEFAULT_AGENT.knowledge[0], approved: false }], "JJ-Media"), []);
});

test("stop and personal handoff requests are recognized without asking the model", () => {
  for (const message of ["STOP", "Bitte nicht mehr kontaktieren", "Schreiben Sie mir nicht mehr", "Löschen Sie meine Nummer", "Kein Interesse"]) assert.equal(isOptOut(message), true, message);
  assert.equal(isOptOut("Wann können wir sprechen?"), false);
  for (const message of ["Zu teuer", "Ich will einen Rabatt", "Ruf mich morgen an", "Ich möchte mit Jessica sprechen"]) assert.equal(requiresHuman(message), true, message);
});

test("German numbers normalize consistently and groups/invalid values are rejected", () => {
  assert.equal(normalizePhone("+49 (170) 123-4567"), "491701234567");
  assert.equal(normalizePhone("0170 1234567"), "491701234567");
  assert.equal(normalizePhone("00491701234567"), "491701234567");
  assert.equal(normalizePhone("491701234567@g.us"), null); assert.equal(normalizePhone("123"), null);
});

test("only an explicit choice of a sent, unexpired offer authorizes booking", () => {
  const offered = [slot("10"), slot("12"), slot("14")];
  assert.equal(chosenSlot("2 bitte", offered, now)?.id, offered[1].id);
  assert.equal(chosenSlot("14 Uhr passt", offered, now)?.id, offered[1].id);
  for (const message of ["14 Uhr passt nicht", "Vielleicht 14 Uhr", "14 Uhr?", "14 Uhr oder 16 Uhr", "Ja", "Morgen 14 Uhr passt", "Übermorgen 14 Uhr passt", "Donnerstag 14 Uhr passt", "Am 03.09.2026 um 14 Uhr bitte", "Nächste Woche 14 Uhr passt"]) assert.equal(chosenSlot(message, offered, now), null, message);
  assert.equal(chosenSlot("1", [], now), null);
  assert.equal(chosenSlot("1", [slot("10", "02", "2026-09-02T07:00:00Z"), offered[1]], now), null, "expiry must not renumber offers");
  assert.equal(chosenSlot("14 Uhr passt", [slot("12"), slot("12", "03")], now), null, "same time on multiple days is ambiguous");
});

test("unverified prices, invented sources, low confidence and booking claims require review", () => {
  const base = { reply: "Gerne, wie können wir helfen?", intent: "other", confidence: 0.95, handoff: false, reason: "", knowledgeIds: ["jj-company"] };
  const knowledge = selectKnowledge(DEFAULT_AGENT.knowledge, "JJ-Media");
  assert.equal(guardDecision(base, "Hallo", knowledge).handoff, false);
  for (const change of [{ reply: "Das kostet 499 €" }, { knowledgeIds: ["invented"] }, { confidence: 0.5 }, { reply: "Ihr Termin ist gebucht", intent: "booking" }, { intent: "handoff" }, { intent: "question", knowledgeIds: [] }]) assert.equal(guardDecision({ ...base, ...change }, "Hallo", knowledge).handoff, true);
  assert.equal(guardDecision(base, "STOP", knowledge).handoff, true);
  assert.equal(guardDecision(base, "Ich will einen Rabatt", knowledge).handoff, true);
});

test("webhooks reject altered bodies, stale timestamps and invalid signatures", () => {
  const secret = "test-secret-".repeat(5), raw = '{"event":"tick"}', timestamp = String(Date.now());
  const signature = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  assert.equal(verifyWebhook(raw, timestamp, signature, secret), true);
  assert.equal(verifyWebhook(raw + " ", timestamp, signature, secret), false);
  const stale = String(Date.now() - 600_000), staleSignature = createHmac("sha256", secret).update(`${stale}.${raw}`).digest("hex");
  assert.equal(verifyWebhook(raw, stale, staleSignature, secret), false);
  assert.equal(verifyWebhook(raw, timestamp, "invalid", secret), false);
  assert.equal(verifyWebhook(raw, timestamp, signature, "short"), false);
});

test("database proxy accepts legitimate upserts while keeping table and statement restrictions", () => {
  const source = readFileSync(new URL("../supabase/functions/jj-media-db-proxy/index.ts", import.meta.url), "utf8");
  const tables = source.slice(source.indexOf("const allowedTables"), source.indexOf("function json"));
  const validation = source.slice(source.indexOf("function validateSql"), source.indexOf("Deno.serve")).replace("input: string", "input");
  const validate = new Function(`${tables}\n${validation}\nreturn validateSql;`)();
  assert.doesNotThrow(() => validate('insert into "jj_whatsapp_locks" ("workspace_id","key") values ($1,$2) on conflict ("workspace_id","key") do update set "expires_at" = $3 returning "token"'));
  assert.doesNotThrow(() => validate('update "jj_whatsapp_threads" set "version"="version"+1 where "id"=$1'));
  for (const sql of ["drop table leads", "set role postgres", "select * from auth.users", "select * from unknown_table", "select * from leads; delete from leads"]) assert.throws(() => validate(sql));
});
