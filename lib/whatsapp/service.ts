import { and, asc, count, desc, eq, gt, inArray, sql } from "drizzle-orm";
import { get as getBlob } from "@vercel/blob";
import { getDb } from "@/db";
import { activities, assets, leads, settings, tasks, whatsappMessages, whatsappQueue, whatsappThreads, workspaces } from "@/db/schema";
import { draftReply, type AgentDecision, type ChatLine } from "./ai";
import { availableSlots, bookSlot, localClock } from "./calendar";
import { getAgentConfig, withLease } from "./config";
import { chosenSlot, effectiveMode, isOptOut, isSuppressed, normalizePhone, requiresHuman, type AgentMode, type CalendarSlot } from "./policy";
import { bridgeConfigured, deliveryStatus, sendThroughBridge } from "./provider";
import { requireSecureAccess } from "./access";

export async function threadRecord(workspaceId: string, threadId: string) {
  const [row] = await getDb().select({ thread: whatsappThreads, lead: leads }).from(whatsappThreads).innerJoin(leads, and(eq(leads.id, whatsappThreads.leadId), eq(leads.workspaceId, whatsappThreads.workspaceId))).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, threadId))).limit(1);
  if (!row) throw new Error("Der WhatsApp-Kontakt wurde nicht gefunden.");
  return row;
}

export async function threadMessages(workspaceId: string, threadId: string) {
  await threadRecord(workspaceId, threadId);
  const rows = await getDb().select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.threadId, threadId))).orderBy(desc(whatsappMessages.createdAt)).limit(100);
  return rows.reverse();
}

export async function openThread(workspaceId: string, leadId: string, phoneInput?: string) {
  const db = getDb();
  const [lead] = await db.select().from(leads).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId))).limit(1);
  if (!lead) throw new Error("Der Lead wurde nicht gefunden.");
  const [existing] = await db.select().from(whatsappThreads).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.leadId, leadId))).limit(1);
  if (existing) return existing;
  const phone = normalizePhone(phoneInput || lead.phone);
  if (!phone) throw new Error("Bitte eine gültige WhatsApp-Nummer mit Landesvorwahl hinterlegen.");
  const config = await getAgentConfig(workspaceId);
  const [created] = await db.insert(whatsappThreads).values({ workspaceId, leadId, phone, mode: config.defaultMode }).onConflictDoNothing().returning();
  if (!created) throw new Error("Diese WhatsApp-Nummer ist bereits einem anderen Lead zugeordnet. Bitte dessen Unterhaltung öffnen.");
  return created;
}

async function activity(workspaceId: string, leadId: string, title: string, detail = "", metadata: Record<string, unknown> = {}) {
  await getDb().insert(activities).values({ workspaceId, leadId, type: "whatsapp", title, detail, metadata });
}

export async function handoff(workspaceId: string, threadId: string, reason: string) {
  const { lead } = await threadRecord(workspaceId, threadId);
  await getDb().update(whatsappThreads).set({ mode: "manual", status: "handoff", handoffReason: reason, version: sql`${whatsappThreads.version} + 1`, updatedAt: new Date() }).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, threadId)));
  await getDb().update(whatsappQueue).set({ status: "cancelled", error: reason, updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.threadId, threadId), eq(whatsappQueue.status, "queued")));
  const [task] = await getDb().select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.leadId, lead.id), eq(tasks.type, "whatsapp_handoff"), eq(tasks.status, "open"))).limit(1);
  if (!task) await getDb().insert(tasks).values({ workspaceId, leadId: lead.id, title: `WhatsApp übernehmen: ${lead.company}`, type: "whatsapp_handoff", priority: "high", dueAt: new Date() });
  await activity(workspaceId, lead.id, "WhatsApp an das Team übergeben", reason);
}

export async function updateThread(workspaceId: string, threadId: string, patch: { mode?: AgentMode; consent?: "unknown" | "granted" | "revoked"; consentNote?: string; status?: "open" | "handoff" | "closed"; unread?: boolean }) {
  const { thread, lead } = await threadRecord(workspaceId, threadId);
  const db = getDb();
  if (patch.consent === "granted") {
    if (!patch.consentNote || patch.consentNote.trim().length < 10) throw new Error("Bitte festhalten, wann, wie und wofür der Kontakt zugestimmt hat.");
    if (isSuppressed(lead.tags)) throw new Error("Dieser Lead ist gesperrt. Eine neue Einwilligung muss zuerst in der CRM-Akte geprüft werden.");
  }
  if (patch.mode === "autopilot") {
    const config = await getAgentConfig(workspaceId);
    if (!config.enabled || config.defaultMode !== "autopilot") throw new Error("Bitte Autopilot zuerst in den KI-Regeln aktivieren.");
    if (thread.consent !== "granted" && patch.consent !== "granted") throw new Error("Für Autopilot fehlt die WhatsApp-Zustimmung.");
  }
  const next: Omit<Partial<typeof whatsappThreads.$inferInsert>, "version"> & { version: ReturnType<typeof sql> } = { ...patch, version: sql`${whatsappThreads.version} + 1`, updatedAt: new Date() };
  if (patch.consent === "granted") next.consentAt = new Date();
  if (patch.consent === "revoked") { next.mode = "manual"; next.status = "closed"; next.offeredSlots = []; next.operatorSlots = []; }
  if (patch.status === "open") next.handoffReason = "";
  await db.update(whatsappThreads).set(next).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, threadId)));
  if (patch.consent) await activity(workspaceId, lead.id, patch.consent === "granted" ? "WhatsApp-Zustimmung dokumentiert" : "WhatsApp-Zustimmung geändert", patch.consentNote || patch.consent);
  if (patch.consent === "revoked" || patch.status === "closed") {
    await db.update(whatsappQueue).set({ status: "cancelled", error: "Kontakt gestoppt", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.threadId, threadId), eq(whatsappQueue.status, "queued")));
    await db.update(tasks).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.leadId, lead.id), eq(tasks.type, "whatsapp_followup"), eq(tasks.status, "open")));
  }
  return (await threadRecord(workspaceId, threadId)).thread;
}

export async function queueThread(workspaceId: string, threadId: string, enabled: boolean) {
  const { thread, lead } = await threadRecord(workspaceId, threadId);
  const db = getDb();
  if (!enabled) {
    await db.update(whatsappQueue).set({ status: "cancelled", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.threadId, threadId), eq(whatsappQueue.status, "queued")));
    return;
  }
  if (thread.consent !== "granted" || isSuppressed(lead.tags) || thread.status !== "open") throw new Error("Für den Tageslauf braucht der Kontakt eine dokumentierte Zustimmung und eine offene Unterhaltung.");
  const [contacted] = await db.select({ id: whatsappMessages.id }).from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.threadId, threadId), inArray(whatsappMessages.status, ["sending", "sent", "delivered", "read", "unknown", "received"]))).limit(1);
  if (contacted) throw new Error("Mit diesem Kontakt gibt es bereits eine Unterhaltung. Bitte in der Inbox fortsetzen.");
  const saved = await db.insert(whatsappQueue).values({ workspaceId, threadId }).onConflictDoUpdate({ target: [whatsappQueue.workspaceId, whatsappQueue.threadId], set: { status: "queued", error: "", updatedAt: new Date() }, setWhere: inArray(whatsappQueue.status, ["cancelled", "skipped"]) }).returning();
  if (!saved.length) throw new Error("Für diesen Kontakt läuft bereits ein Vorgang. Bitte den Status und gegebenenfalls den Entwurf in der Inbox prüfen.");
  await activity(workspaceId, lead.id, "Für den WhatsApp-Tageslauf freigegeben");
}

function canContact(thread: typeof whatsappThreads.$inferSelect, lead: typeof leads.$inferSelect) {
  if (thread.consent !== "granted") throw new Error("Für diesen Kontakt fehlt die WhatsApp-Zustimmung.");
  if (thread.status === "closed" || isSuppressed(lead.tags) || lead.pipelineStage === "lost") throw new Error("Dieser Kontakt ist für Nachrichten gestoppt.");
}

async function deliver(args: { workspaceId: string; threadId: string; messageId: string; actor: "human" | "agent" | "outreach"; expectedVersion: number; configVersion?: number }) {
  requireSecureAccess();
  const db = getDb();
  const { thread, lead } = await threadRecord(args.workspaceId, args.threadId);
  canContact(thread, lead);
  if (thread.version !== args.expectedVersion) throw new Error("Die Unterhaltung wurde inzwischen aktualisiert. Bitte den neuen Verlauf prüfen.");
  if (args.actor !== "human") {
    const config = await getAgentConfig(args.workspaceId);
    if (!config.enabled || config.version !== args.configVersion) throw new Error("Die KI-Regeln wurden geändert. Der Entwurf muss neu geprüft werden.");
    if (args.actor === "agent" && effectiveMode(config, thread.mode) !== "autopilot") throw new Error("Autopilot wurde angehalten.");
    if (args.actor === "outreach" && (!config.dailyOutreachEnabled || thread.status !== "open")) throw new Error("Der Tageslauf wurde angehalten.");
  }
  const [message] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, args.workspaceId), eq(whatsappMessages.threadId, args.threadId), eq(whatsappMessages.id, args.messageId))).limit(1);
  if (!message) throw new Error("Nachricht nicht gefunden.");
  if (["sent", "delivered", "read"].includes(message.status)) return message;
  if (message.status !== "draft") throw new Error("Der Versandstatus ist noch unklar. Bitte zuerst in WhatsApp prüfen; die Nachricht wird nicht erneut verschickt.");
  if (!bridgeConfigured()) throw new Error("WhatsApp ist noch nicht verbunden.");
  let attachment: { dataUrl: string; filename: string; mime: string } | undefined;
  if (typeof message.metadata.attachmentId === "string") {
    const [asset] = await db.select().from(assets).where(and(eq(assets.workspaceId, args.workspaceId), eq(assets.id, message.metadata.attachmentId), inArray(assets.kind, ["whatsapp_image", "whatsapp_document", "whatsapp_audio"]))).limit(1);
    if (!asset || asset.size > 3 * 1024 * 1024) throw new Error("Der ausgewählte Anhang ist nicht verfügbar.");
    const file = await getBlob(asset.blobUrl, { access: "private" });
    if (!file?.stream) throw new Error("Der Anhang konnte nicht geladen werden.");
    const buffer = Buffer.from(await new Response(file.stream).arrayBuffer());
    if (buffer.length > 3 * 1024 * 1024) throw new Error("Der Anhang überschreitet 3 MB.");
    attachment = { dataUrl: `data:${asset.contentType};base64,${buffer.toString("base64")}`, filename: asset.filename, mime: asset.contentType };
  }
  // Recheck the stop switch after potentially slow attachment loading.
  const fresh = await threadRecord(args.workspaceId, args.threadId);
  canContact(fresh.thread, fresh.lead);
  if (fresh.thread.version !== args.expectedVersion) throw new Error("Der Kontakt wurde zwischenzeitlich aktualisiert. Versand angehalten.");
  if (args.actor !== "human") {
    const latest = await getAgentConfig(args.workspaceId);
    if (!latest.enabled || latest.version !== args.configVersion || (args.actor === "agent" && effectiveMode(latest, fresh.thread.mode) !== "autopilot") || (args.actor === "outreach" && (!latest.dailyOutreachEnabled || fresh.thread.status !== "open"))) throw new Error("Der automatische Versand wurde angehalten.");
  }
  const [claimed] = await db.update(whatsappMessages).set({ status: "sending", updatedAt: new Date() }).where(and(eq(whatsappMessages.id, message.id), eq(whatsappMessages.workspaceId, args.workspaceId), eq(whatsappMessages.status, "draft"))).returning();
  if (!claimed) throw new Error("Diese Nachricht wird bereits verarbeitet.");
  let providerId: string;
  try {
    providerId = await sendThroughBridge({ id: message.id, to: thread.phone, body: message.body, attachment });
  } catch (error) {
    await db.update(whatsappMessages).set({ status: "unknown", metadata: { ...message.metadata, error: error instanceof Error ? error.message : "Versandstatus unklar" }, updatedAt: new Date() }).where(and(eq(whatsappMessages.id, message.id), eq(whatsappMessages.workspaceId, args.workspaceId)));
    throw error;
  }
  const [sent] = await db.update(whatsappMessages).set({ status: "sent", providerId, sentAt: new Date(), updatedAt: new Date() }).where(and(eq(whatsappMessages.id, message.id), eq(whatsappMessages.workspaceId, args.workspaceId))).returning();
  await db.update(whatsappThreads).set({ lastMessageAt: new Date(), version: sql`${whatsappThreads.version} + 1`, ...(args.actor === "human" ? { mode: "manual" as const } : {}), ...(Array.isArray(message.metadata.slots) ? { offeredSlots: message.metadata.slots as CalendarSlot[] } : {}), updatedAt: new Date() }).where(and(eq(whatsappThreads.id, thread.id), eq(whatsappThreads.workspaceId, args.workspaceId)));
  await db.update(leads).set({ lastContactAt: new Date(), lastActivityAt: new Date(), updatedAt: new Date(), ...(lead.pipelineStage === "new" ? { pipelineStage: "contacted" } : {}) }).where(and(eq(leads.id, lead.id), eq(leads.workspaceId, args.workspaceId)));
  await activity(args.workspaceId, lead.id, "WhatsApp gesendet", message.body, { messageId: message.id, providerId, actor: args.actor });
  return sent;
}

export async function sendManual(args: { workspaceId: string; threadId: string; body: string; key: string; expectedVersion: number; attachmentId?: string; draftId?: string }) {
  return withLease(args.workspaceId, `thread:${args.threadId}`, async () => {
    const db = getDb();
    const existing = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, args.workspaceId), eq(whatsappMessages.idempotencyKey, `manual:${args.key}`))).limit(1);
    if (existing[0]) {
      if (existing[0].threadId !== args.threadId || existing[0].body !== args.body || (existing[0].metadata.attachmentId || undefined) !== args.attachmentId) throw new Error("Dieser Versandvorgang gehört zu einer anderen Nachricht.");
      if (["sent", "delivered", "read"].includes(existing[0].status)) return existing[0];
      return deliver({ ...args, messageId: existing[0].id, actor: "human" });
    }
    const { thread, lead } = await threadRecord(args.workspaceId, args.threadId);
    canContact(thread, lead);
    if (thread.version !== args.expectedVersion) throw new Error("Es gibt neue Nachrichten. Bitte zuerst den Verlauf prüfen.");
    let slots: CalendarSlot[] | undefined;
    if (args.draftId) {
      const [draft] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, args.workspaceId), eq(whatsappMessages.threadId, args.threadId), eq(whatsappMessages.id, args.draftId), eq(whatsappMessages.status, "draft"))).limit(1);
      if (draft?.body === args.body && Array.isArray(draft.metadata.slots)) slots = draft.metadata.slots as CalendarSlot[];
    }
    const [message] = await db.insert(whatsappMessages).values({ workspaceId: args.workspaceId, threadId: args.threadId, direction: "outbound", body: args.body, kind: args.attachmentId ? "attachment" : "text", idempotencyKey: `manual:${args.key}`, metadata: { actor: "human", ...(slots ? { slots } : {}), ...(args.attachmentId ? { attachmentId: args.attachmentId } : {}) } }).returning();
    const result = await deliver({ ...args, messageId: message.id, actor: "human" });
    if (slots) await db.update(whatsappThreads).set({ offeredSlots: slots, updatedAt: new Date() }).where(and(eq(whatsappThreads.workspaceId, args.workspaceId), eq(whatsappThreads.id, args.threadId)));
    if (args.draftId) await db.update(whatsappMessages).set({ status: "used", updatedAt: new Date() }).where(and(eq(whatsappMessages.workspaceId, args.workspaceId), eq(whatsappMessages.id, args.draftId), eq(whatsappMessages.threadId, args.threadId), eq(whatsappMessages.status, "draft")));
    return result;
  });
}

export async function reconcileMessage(workspaceId: string, messageId: string) {
  const db = getDb();
  const [message] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.id, messageId), eq(whatsappMessages.direction, "outbound"))).limit(1);
  if (!message || !["unknown", "sending"].includes(message.status)) throw new Error("Für diese Nachricht ist keine Statusprüfung erforderlich.");
  const result = await deliveryStatus(message.id);
  if (result.status === "sent" && result.providerId) {
    await db.update(whatsappMessages).set({ status: "sent", providerId: result.providerId, sentAt: new Date(), updatedAt: new Date() }).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.id, message.id)));
    await db.update(whatsappQueue).set({ status: "sent", sentAt: new Date(), error: "", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.messageId, message.id)));
    const { thread, lead } = await threadRecord(workspaceId, message.threadId);
    await db.update(whatsappThreads).set({ lastMessageAt: new Date(), version: sql`${whatsappThreads.version} + 1`, ...(message.metadata.actor === "human" ? { mode: "manual" as const } : {}), ...(thread.consent === "granted" && Array.isArray(message.metadata.slots) ? { offeredSlots: message.metadata.slots as CalendarSlot[] } : {}), updatedAt: new Date() }).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, thread.id)));
    await db.update(leads).set({ lastContactAt: new Date(), lastActivityAt: new Date(), updatedAt: new Date() }).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, lead.id)));
    return { status: "sent", message: "WhatsApp hat den Versand bestätigt." };
  }
  // Unknown is never blindly resent. The durable bridge is the source of truth.
  return { status: result.status, message: result.status === "not_found" ? "Der Server kennt diese Nachricht nicht. Bitte in WhatsApp prüfen, bevor Sie einen neuen Versand starten." : "Der Status ist weiterhin unklar. Bitte direkt in WhatsApp prüfen." };
}

async function followUp(workspaceId: string, threadId: string, date: string, sourceId: string) {
  const when = new Date(date);
  if (when.getTime() < Date.now() || when.getTime() > Date.now() + 366 * 86_400_000) return;
  const { lead } = await threadRecord(workspaceId, threadId);
  const title = `WhatsApp-Wiedervorlage: ${lead.company}`;
  const [existing] = await getDb().select({ id: tasks.id }).from(tasks).where(and(eq(tasks.workspaceId, workspaceId), eq(tasks.leadId, lead.id), eq(tasks.type, "whatsapp_followup"), eq(tasks.status, "open"))).limit(1);
  if (existing) await getDb().update(tasks).set({ dueAt: when, updatedAt: new Date() }).where(eq(tasks.id, existing.id));
  else await getDb().insert(tasks).values({ workspaceId, leadId: lead.id, type: "whatsapp_followup", title, dueAt: when });
  await getDb().update(whatsappThreads).set({ nextFollowUpAt: when, updatedAt: new Date() }).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, threadId)));
  await getDb().update(leads).set({ nextFollowUpAt: when, updatedAt: new Date() }).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, lead.id)));
  await activity(workspaceId, lead.id, "WhatsApp-Wiedervorlage vorgeschlagen", when.toISOString(), { sourceId });
}

function safeLeadContext(lead: typeof leads.$inferSelect) {
  return { company: lead.company, contact: lead.contact, city: lead.city, profile: lead.websiteUrl, summary: lead.summary.slice(0, 3_000), pitch: lead.pitch.slice(0, 2_000), evidence: lead.evidence.slice(0, 8) };
}

export async function createReply(workspaceId: string, threadId: string, automatic = false, outreach = false) {
  return withLease(workspaceId, `thread:${threadId}`, async () => {
    const db = getDb();
    const { thread, lead } = await threadRecord(workspaceId, threadId);
    const config = await getAgentConfig(workspaceId);
    const mode = effectiveMode(config, thread.mode);
    if (automatic && (mode === "manual" || thread.status !== "open" || thread.consent !== "granted" || isSuppressed(lead.tags))) return null;
    if (automatic && !thread.lastInboundId) return null;
    const key = outreach ? `outreach:${threadId}` : automatic ? `reply:${thread.lastInboundId}` : `draft:${crypto.randomUUID()}`;
    const [existing] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.idempotencyKey, key))).limit(1);
    if (existing) {
      if (automatic && existing.status === "draft" && mode === "autopilot" && existing.metadata.configVersion === config.version && existing.metadata.threadVersion === thread.version && existing.metadata.handoff === false) {
        return deliver({ workspaceId, threadId, messageId: existing.id, actor: "agent", expectedVersion: thread.version, configVersion: config.version });
      }
      return existing;
    }
    const rows = await threadMessages(workspaceId, threadId);
    const sent = rows.filter((m) => ["received", "sent", "delivered", "read"].includes(m.status));
    const history: ChatLine[] = sent.filter((m) => m.body).slice(-24).map((m) => ({ role: m.direction === "inbound" ? "user" : "assistant", content: m.body }));
    if (outreach || history.length === 0) history.push({ role: "user", content: `Bitte eine erste kurze Nachricht für ${lead.company} nach der dokumentierten Zustimmung formulieren. Zustimmung: ${thread.consentNote}` });
    const lastInbound = rows.find((m) => m.id === thread.lastInboundId);
    if (automatic && lastInbound && lastInbound.kind !== "text") { await handoff(workspaceId, threadId, "Anhang oder Sprachnachricht persönlich ansehen."); return null; }
    if (automatic) {
      const [total] = await db.select({ value: count() }).from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.threadId, threadId), eq(whatsappMessages.direction, "outbound"), inArray(whatsappMessages.status, ["sent", "delivered", "read", "sending", "unknown"]), sql`${whatsappMessages.metadata}->>'actor' = 'agent'`));
      if (total.value >= config.maxAutoReplies) { await handoff(workspaceId, threadId, "Die maximale Zahl automatischer Antworten wurde erreicht."); return null; }
    }

    const selected = lastInbound ? chosenSlot(lastInbound.body, thread.offeredSlots, Date.now(), config.timezone) : null;
    const [workspace] = await db.select().from(workspaces).where(eq(workspaces.id, workspaceId)).limit(1);
    if (!workspace) throw new Error("Workspace nicht gefunden.");
    let decision: AgentDecision & { model?: string; usedKnowledge?: unknown[] };
    if (selected && automatic && mode === "autopilot") {
      const result = await bookSlot({ userId: workspace.ownerId, workspaceId, threadId, lead, config, slot: selected, expectedVersion: thread.version, automatic: true });
      decision = { reply: `Ihr Potenzialgespräch mit ${config.handoffName} ist für ${result.label} (${config.timezone}) gebucht.${result.joinUrl ? `\n\nZum Gespräch: ${result.joinUrl}` : " Unser Team meldet sich mit den Gesprächsdetails."}`, intent: "booking", confidence: 1, handoff: false, reason: "Vom Google Kalender bestätigt", summary: `Termin: ${result.label}`, knowledgeIds: [], followUpAt: null };
    } else {
      decision = await draftReply({ config, history, lead: safeLeadContext(lead), slots: thread.offeredSlots, outreach, workspaceId });
      if (decision.intent === "booking" && !decision.handoff) {
        if (config.allowBooking) {
          try {
            const slots = await availableSlots(workspace.ownerId, workspaceId, config);
            if (!slots.length) throw new Error("In den nächsten 14 Tagen sind keine passenden Zeiten verfügbar.");
            // Offers become selectable only after their message is actually sent.
            decision.reply = `Diese Zeiten sind für ein ${config.durationMinutes}-minütiges Gespräch frei (${config.timezone}):\n\n${slots.map((slot, i) => `${i + 1}. ${slot.label}`).join("\n")}\n\nWelche Nummer passt Ihnen?`;
            (decision as AgentDecision & { slots?: CalendarSlot[] }).slots = slots;
          } catch (error) { decision.handoff = true; decision.reason = error instanceof Error ? error.message : "Kalender bitte prüfen"; decision.reply = "Gerne. Ich gebe Ihren Terminwunsch an unser Team weiter, damit wir eine passende Zeit finden."; }
        } else { decision.handoff = true; decision.reason = "Automatische Terminierung ist noch nicht aktiviert."; }
      }
    }
    const fresh = await threadRecord(workspaceId, threadId);
    const currentConfig = await getAgentConfig(workspaceId);
    if (fresh.thread.version !== thread.version || fresh.thread.lastInboundId !== thread.lastInboundId || currentConfig.version !== config.version) throw new Error("Während des Entwurfs gab es Änderungen. Bitte den aktuellen Verlauf erneut prüfen.");
    const [message] = await db.insert(whatsappMessages).values({ workspaceId, threadId, direction: "outbound", status: "draft", body: decision.reply, idempotencyKey: key, sourceId: thread.lastInboundId, metadata: { ...decision, actor: outreach ? "outreach" : "agent", configVersion: config.version, threadVersion: thread.version } }).onConflictDoNothing().returning();
    if (!message) return null;
    await db.update(whatsappThreads).set({ summary: decision.summary, intent: decision.intent, updatedAt: new Date() }).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, threadId)));
    if (decision.intent === "interested") await db.update(leads).set({ salesPriority: Math.max(lead.salesPriority, 85), lastActivityAt: new Date(), updatedAt: new Date() }).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, lead.id)));
    if (decision.intent === "follow_up" && decision.followUpAt) await followUp(workspaceId, threadId, decision.followUpAt, thread.lastInboundId || message.id);
    if (decision.intent === "no_interest") { await updateThread(workspaceId, threadId, { status: "closed" }); return message; }
    if (automatic && decision.handoff) { await handoff(workspaceId, threadId, decision.reason || "Persönliche Antwort erforderlich"); return message; }
    if (automatic && mode === "autopilot" && !decision.handoff) {
      const result = await deliver({ workspaceId, threadId, messageId: message.id, actor: "agent", expectedVersion: thread.version, configVersion: config.version });
      const offered = (decision as AgentDecision & { slots?: CalendarSlot[] }).slots;
      if (offered) await db.update(whatsappThreads).set({ offeredSlots: offered, updatedAt: new Date() }).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, threadId)));
      return result;
    }
    return message;
  });
}

export async function receiveMessage(workspaceId: string, input: { id: string; phone: string; body: string; kind: string; timestamp: string; fromMe?: boolean }) {
  const phone = normalizePhone(input.phone);
  if (!phone || input.fromMe) return { ignored: true };
  const db = getDb();
  const [thread] = await db.select().from(whatsappThreads).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.phone, phone))).limit(1);
  // Never ingest private chats or scraped contacts outside the selected CRM contacts.
  if (!thread) return { ignored: true };
  const [message] = await db.insert(whatsappMessages).values({ workspaceId, threadId: thread.id, direction: "inbound", status: "received", body: input.body, kind: input.kind, providerId: input.id, idempotencyKey: `inbound:${input.id}`, metadata: { providerTimestamp: input.timestamp } }).onConflictDoNothing().returning();
  if (message) {
    await db.update(whatsappThreads).set({ lastInboundId: message.id, lastMessageAt: new Date(), unread: true, version: sql`${whatsappThreads.version} + 1`, updatedAt: new Date() }).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.id, thread.id)));
    await db.update(whatsappQueue).set({ status: "cancelled", error: "Kontakt hat geantwortet", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.threadId, thread.id), eq(whatsappQueue.status, "queued")));
    await activity(workspaceId, thread.leadId, "WhatsApp-Antwort erhalten", input.body, { messageId: message.id });
  }
  if (isOptOut(input.body)) {
    await updateThread(workspaceId, thread.id, { consent: "revoked", consentNote: input.body });
    const { lead } = await threadRecord(workspaceId, thread.id);
    await db.update(leads).set({ tags: [...new Set([...lead.tags, "opt-out"])], updatedAt: new Date() }).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, lead.id)));
    return { stopped: true };
  }
  if (requiresHuman(input.body)) { await handoff(workspaceId, thread.id, "Der Kontakt möchte eine persönliche Bearbeitung oder verhandeln."); return { handoff: true }; }
  try { await createReply(workspaceId, thread.id, true); }
  catch (error) {
    // Busy means another turn owns this conversation; the next bridge tick recovers it.
    if (!(error instanceof Error && error.message.includes("gerade verarbeitet"))) await handoff(workspaceId, thread.id, error instanceof Error ? error.message : "KI-Antwort bitte prüfen");
  }
  return { received: true, duplicate: !message };
}

export async function receiveReceipt(workspaceId: string, providerId: string, status: "sent" | "delivered" | "read") {
  const ranks = { sending: 0, unknown: 0, sent: 1, delivered: 2, read: 3 };
  const [message] = await getDb().select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.providerId, providerId), eq(whatsappMessages.direction, "outbound"))).limit(1);
  if (!message) return;
  if ((ranks[message.status as keyof typeof ranks] ?? 0) < ranks[status]) await getDb().update(whatsappMessages).set({ status, updatedAt: new Date() }).where(and(eq(whatsappMessages.id, message.id), eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.status, message.status)));
}

export async function runDailyOutreach(workspaceId: string) {
  return withLease(workspaceId, "outreach", async () => {
    const db = getDb();
    const config = await getAgentConfig(workspaceId);
    const clock = localClock(new Date(), config.timezone);
    if (!config.enabled || !config.dailyOutreachEnabled || !bridgeConfigured()) return { sent: 0, reason: "paused" };
    if (!config.weekdays.includes(clock.weekday) || clock.hour < config.outreachStartHour || clock.hour >= config.outreachEndHour) return { sent: 0, reason: "outside_hours" };
    const rows = await db.select().from(whatsappQueue).where(and(eq(whatsappQueue.workspaceId, workspaceId), gt(whatsappQueue.attemptedAt, new Date(Date.now() - 36 * 3_600_000))));
    const today = rows.filter((row) => row.attemptedAt && localClock(row.attemptedAt, config.timezone).day === clock.day);
    if (today.length >= config.dailyOutreachLimit) return { sent: 0, reason: "daily_limit" };
    if (today.some((row) => row.attemptedAt && Date.now() - row.attemptedAt.getTime() < 120_000)) return { sent: 0, reason: "spacing" };
    const [queued] = await db.select().from(whatsappQueue).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.status, "queued"))).orderBy(asc(whatsappQueue.createdAt)).limit(1);
    if (!queued) return { sent: 0, reason: "empty" };
    const { thread, lead } = await threadRecord(workspaceId, queued.threadId);
    try { canContact(thread, lead); }
    catch (error) { await db.update(whatsappQueue).set({ status: "skipped", error: error instanceof Error ? error.message : "Kontakt gesperrt", updatedAt: new Date() }).where(eq(whatsappQueue.id, queued.id)); return { sent: 0, reason: "ineligible" }; }
    if (thread.status !== "open" || thread.lastInboundId) { await db.update(whatsappQueue).set({ status: "skipped", error: "Bereits in Bearbeitung", updatedAt: new Date() }).where(eq(whatsappQueue.id, queued.id)); return { sent: 0, reason: "already_contacted" }; }
    try {
      const message = await createReply(workspaceId, thread.id, false, true);
      if (!message || message.metadata.handoff === true) {
        await db.update(whatsappQueue).set({ status: "review", messageId: message?.id, error: "Entwurf bitte persönlich prüfen", updatedAt: new Date() }).where(eq(whatsappQueue.id, queued.id));
        return { sent: 0, reason: "review" };
      }
      return await withLease(workspaceId, `thread:${thread.id}`, async () => {
        const current = await threadRecord(workspaceId, thread.id);
        if (current.thread.lastInboundId || current.thread.status !== "open") {
          await db.update(whatsappQueue).set({ status: "cancelled", error: "Unterhaltung wird bereits bearbeitet", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.id, queued.id), eq(whatsappQueue.status, "queued")));
          return { sent: 0, reason: "cancelled" };
        }
        const [stillQueued] = await db.update(whatsappQueue).set({ status: "sending", messageId: message.id, attemptedAt: new Date(), updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.id, queued.id), eq(whatsappQueue.status, "queued"))).returning();
        if (!stillQueued) return { sent: 0, reason: "cancelled" };
        await deliver({ workspaceId, threadId: thread.id, messageId: message.id, actor: "outreach", expectedVersion: Number(message.metadata.threadVersion), configVersion: Number(message.metadata.configVersion) });
        await db.update(whatsappQueue).set({ status: "sent", sentAt: new Date(), updatedAt: new Date() }).where(eq(whatsappQueue.id, queued.id));
        return { sent: 1, reason: "sent" };
      });
    } catch (error) {
      const [message] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.idempotencyKey, `outreach:${thread.id}`))).limit(1);
      await db.update(whatsappQueue).set({ status: message && ["sending", "unknown", "sent", "delivered", "read"].includes(message.status) ? "unknown" : "review", error: error instanceof Error ? error.message : "Bitte prüfen", updatedAt: new Date() }).where(eq(whatsappQueue.id, queued.id));
      return { sent: 0, reason: "review" };
    }
  });
}

export async function runWhatsappTick(workspaceId: string) {
  const db = getDb();
  await db.insert(settings).values({ workspaceId, key: "jj_whatsapp_last_tick", value: new Date().toISOString() }).onConflictDoUpdate({ target: [settings.workspaceId, settings.key], set: { value: new Date().toISOString(), updatedAt: new Date() } });
  const config = await getAgentConfig(workspaceId);
  if (!config.enabled) return { reason: "paused" };
  if (config.defaultMode === "manual") return runDailyOutreach(workspaceId);
  const pending = await db.select().from(whatsappThreads).where(and(eq(whatsappThreads.workspaceId, workspaceId), eq(whatsappThreads.status, "open"), inArray(whatsappThreads.mode, ["copilot", "autopilot"]), eq(whatsappThreads.consent, "granted"), sql`${whatsappThreads.lastInboundId} is not null`, sql`not exists (select 1 from ${whatsappMessages} where ${whatsappMessages.workspaceId} = ${whatsappThreads.workspaceId} and ${whatsappMessages.idempotencyKey} = 'reply:' || ${whatsappThreads.lastInboundId}::text)`)).orderBy(asc(whatsappThreads.lastMessageAt)).limit(1);
  // At most one expensive turn per tick keeps the worker bounded.
  for (const thread of pending) {
    if (!thread.lastInboundId || thread.mode === "manual") continue;
    const [message] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.idempotencyKey, `reply:${thread.lastInboundId}`))).limit(1);
    if (message) continue;
    try { await createReply(workspaceId, thread.id, true); } catch (error) {
      if (!(error instanceof Error && error.message.includes("gerade verarbeitet"))) await handoff(workspaceId, thread.id, error instanceof Error ? error.message : "KI bitte prüfen");
    }
    return { replyProcessed: true };
  }
  return runDailyOutreach(workspaceId);
}
