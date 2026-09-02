from pathlib import Path


def replace_once(path: str, old: str, new: str):
    file = Path(path)
    text = file.read_text(encoding="utf-8")
    if old not in text:
        raise SystemExit(f"Expected block not found in {path}: {old[:120]!r}")
    file.write_text(text.replace(old, new, 1), encoding="utf-8")


service = "lib/whatsapp/service.ts"

replace_once(
    service,
    '''export async function queueThread(workspaceId: string, threadId: string, enabled: boolean) {
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
''',
    '''export async function queueThread(workspaceId: string, threadId: string, enabled: boolean) {
  const { thread, lead } = await threadRecord(workspaceId, threadId);
  const db = getDb();
  if (!enabled) {
    await db.update(whatsappQueue).set({ status: "cancelled", error: "Vom Team aus dem Tageslauf genommen", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.threadId, threadId), inArray(whatsappQueue.status, ["review", "queued"])));
    return;
  }
  if (thread.consent !== "granted" || isSuppressed(lead.tags) || thread.status !== "open") throw new Error("Für den Tageslauf braucht der Kontakt eine dokumentierte Zustimmung und eine offene Unterhaltung.");
  const [contacted] = await db.select({ id: whatsappMessages.id }).from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.threadId, threadId), inArray(whatsappMessages.status, ["sending", "sent", "delivered", "read", "unknown", "received"]))).limit(1);
  if (contacted) throw new Error("Mit diesem Kontakt gibt es bereits eine Unterhaltung. Bitte in der Inbox fortsetzen.");
  const saved = await db.insert(whatsappQueue).values({ workspaceId, threadId, status: "review", error: "Erstnachricht wird vorbereitet" }).onConflictDoUpdate({ target: [whatsappQueue.workspaceId, whatsappQueue.threadId], set: { status: "review", messageId: null, error: "Erstnachricht wird vorbereitet", attemptedAt: null, sentAt: null, updatedAt: new Date() }, setWhere: inArray(whatsappQueue.status, ["cancelled", "skipped"]) }).returning();
  if (!saved.length) throw new Error("Für diesen Kontakt läuft bereits ein Vorgang. Bitte den Status und gegebenenfalls den Entwurf in der Inbox prüfen.");
  try {
    const message = await createReply(workspaceId, threadId, false, true);
    if (!message || message.metadata.handoff === true) {
      await db.update(whatsappQueue).set({ status: "review", messageId: message?.id, error: "Entwurf bitte persönlich prüfen", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.threadId, threadId)));
      return;
    }
    await db.update(whatsappQueue).set({ status: "review", messageId: message.id, error: "Freigabe durch das Team erforderlich", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.threadId, threadId)));
    await activity(workspaceId, lead.id, "WhatsApp-Erstnachricht zur Freigabe vorbereitet", message.body, { messageId: message.id });
  } catch (error) {
    await db.update(whatsappQueue).set({ status: "review", error: error instanceof Error ? error.message : "Entwurf konnte nicht vorbereitet werden", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.threadId, threadId)));
  }
}

export async function reviewQueueItem(workspaceId: string, queueId: string, decision: "approve" | "reject") {
  const db = getDb();
  const [item] = await db.select().from(whatsappQueue).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.id, queueId))).limit(1);
  if (!item) throw new Error("Der Freigabe-Vorgang wurde nicht gefunden.");
  const { thread, lead } = await threadRecord(workspaceId, item.threadId);
  if (decision === "reject") {
    if (["sent", "sending"].includes(item.status)) throw new Error("Diese Nachricht kann nicht mehr abgelehnt werden.");
    await db.update(whatsappQueue).set({ status: "cancelled", error: "Vom Team abgelehnt", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.id, queueId)));
    await activity(workspaceId, lead.id, "WhatsApp-Erstnachricht abgelehnt");
    return { status: "cancelled" };
  }
  if (item.status === "queued") return { status: "queued" };
  if (item.status !== "review") throw new Error("Nur Nachrichten in der Freigabe können bestätigt werden.");
  canContact(thread, lead);
  if (!item.messageId) throw new Error("Für diesen Kontakt liegt noch kein freigabefähiger Entwurf vor.");
  const [message] = await db.select().from(whatsappMessages).where(and(eq(whatsappMessages.workspaceId, workspaceId), eq(whatsappMessages.id, item.messageId), eq(whatsappMessages.threadId, item.threadId))).limit(1);
  if (!message || message.status !== "draft" || message.metadata.actor !== "outreach") throw new Error("Der Entwurf ist nicht mehr aktuell. Bitte den Kontakt neu vorbereiten.");
  if (message.metadata.handoff === true) throw new Error("Dieser Entwurf benötigt eine persönliche Prüfung und kann nicht automatisch freigegeben werden.");
  await db.update(whatsappQueue).set({ status: "queued", error: "Freigegeben – wartet auf kontrollierten Versand", updatedAt: new Date() }).where(and(eq(whatsappQueue.workspaceId, workspaceId), eq(whatsappQueue.id, queueId), eq(whatsappQueue.status, "review")));
  await activity(workspaceId, lead.id, "WhatsApp-Erstnachricht freigegeben", message.body, { messageId: message.id });
  return { status: "queued" };
}
'''
)

replace_once(
    service,
    'if (today.some((row) => row.attemptedAt && Date.now() - row.attemptedAt.getTime() < 120_000)) return { sent: 0, reason: "spacing" };',
    'if (today.some((row) => row.attemptedAt && Date.now() - row.attemptedAt.getTime() < 180_000)) return { sent: 0, reason: "spacing" };'
)

replace_once(
    service,
    '''    } else {
      decision = await draftReply({ config, history, lead: safeLeadContext(lead), slots: thread.offeredSlots, outreach, workspaceId });
      if (decision.intent === "booking" && !decision.handoff) {''',
    '''    } else if (outreach) {
      decision = {
        reply: `Hallo, bin ich da bei ${lead.company} gelandet?`,
        intent: "outreach",
        confidence: 1,
        handoff: false,
        reason: "Fest definierter, vom Team kontrollierbarer Gesprächseinstieg.",
        summary: "Erstkontakt zur Identitätsbestätigung vorbereitet.",
        knowledgeIds: [],
        followUpAt: null,
      };
    } else {
      decision = await draftReply({ config, history, lead: safeLeadContext(lead), slots: thread.offeredSlots, outreach, workspaceId });
      if (decision.intent === "booking" && !decision.handoff) {'''
)

# Pending review items must also stop on handoff, opt-out or inbound activity.
service_text = Path(service).read_text(encoding="utf-8")
service_text = service_text.replace('eq(whatsappQueue.status, "queued")))', 'inArray(whatsappQueue.status, ["review", "queued"])))')
Path(service).write_text(service_text, encoding="utf-8")

route = "app/api/whatsapp/route.ts"
replace_once(
    route,
    'import { leads, settings, whatsappQueue, whatsappReservations, whatsappThreads } from "@/db/schema";',
    'import { leads, settings, whatsappMessages, whatsappQueue, whatsappReservations, whatsappThreads } from "@/db/schema";'
)
replace_once(
    route,
    'import { createReply, handoff, openThread, queueThread, reconcileMessage, sendManual, threadMessages, threadRecord, updateThread } from "@/lib/whatsapp/service";',
    'import { createReply, handoff, openThread, queueThread, reconcileMessage, reviewQueueItem, sendManual, threadMessages, threadRecord, updateThread } from "@/lib/whatsapp/service";'
)
replace_once(
    route,
    '  z.object({ action: z.literal("queue"), threadId: z.string().uuid(), enabled: z.boolean() }),',
    '  z.object({ action: z.literal("queue"), threadId: z.string().uuid(), enabled: z.boolean() }),\n  z.object({ action: z.literal("review"), queueId: z.string().uuid(), decision: z.enum(["approve", "reject"]) }),'
)
replace_once(
    route,
    '''      db.select({ id: leads.id, company: leads.company, contact: leads.contact, phone: leads.phone }).from(leads).where(eq(leads.workspaceId, workspace.workspaceId)).orderBy(desc(leads.salesPriority)).limit(1_000),
      db.select().from(whatsappQueue).where(eq(whatsappQueue.workspaceId, workspace.workspaceId)).orderBy(desc(whatsappQueue.updatedAt)).limit(1_000),''',
    '''      db.select({ id: leads.id, company: leads.company, contact: leads.contact, phone: leads.phone, summary: leads.summary, websiteUrl: leads.websiteUrl, salesPriority: leads.salesPriority }).from(leads).where(eq(leads.workspaceId, workspace.workspaceId)).orderBy(desc(leads.salesPriority)).limit(1_000),
      db.select({ id: whatsappQueue.id, threadId: whatsappQueue.threadId, status: whatsappQueue.status, error: whatsappQueue.error, messageId: whatsappQueue.messageId, sentAt: whatsappQueue.sentAt, createdAt: whatsappQueue.createdAt, updatedAt: whatsappQueue.updatedAt, body: whatsappMessages.body }).from(whatsappQueue).leftJoin(whatsappMessages, and(eq(whatsappMessages.workspaceId, whatsappQueue.workspaceId), eq(whatsappMessages.id, whatsappQueue.messageId))).where(eq(whatsappQueue.workspaceId, workspace.workspaceId)).orderBy(desc(whatsappQueue.updatedAt)).limit(1_000),'''
)
replace_once(
    route,
    '      case "queue": await queueThread(workspaceId, input.threadId, input.enabled); return Response.json({ ok: true });',
    '      case "queue": await queueThread(workspaceId, input.threadId, input.enabled); return Response.json({ ok: true });\n      case "review": return Response.json(await reviewQueueItem(workspaceId, input.queueId, input.decision));'
)

ui = "app/dashboard/whatsapp/WhatsAppWorkspace.tsx"
replace_once(
    ui,
    'type Lead = { id: string; company: string; contact: string; phone: string; pipelineStage?: string; slug?: string; videoStatus?: string; summary?: string; websiteUrl?: string };',
    'type Lead = { id: string; company: string; contact: string; phone: string; pipelineStage?: string; slug?: string; videoStatus?: string; summary?: string; websiteUrl?: string; salesPriority?: number };'
)
replace_once(
    ui,
    'type QueueItem = { id: string; threadId: string; status: string; error: string; sentAt: string | null; createdAt: string };',
    'type QueueItem = { id: string; threadId: string; status: string; error: string; messageId: string | null; body: string | null; sentAt: string | null; createdAt: string };'
)
replace_once(
    ui,
    'const queueLabels: Record<string, string> = { queued: "Vorgemerkt", sending: "Wird gesendet", sent: "Gesendet", cancelled: "Gestoppt", skipped: "Übersprungen", review: "Bitte prüfen", unknown: "Status unklar" };',
    'const queueLabels: Record<string, string> = { review: "Freigabe offen", queued: "Freigegeben", sending: "Wird gesendet", sent: "Gesendet", cancelled: "Gestoppt", skipped: "Übersprungen", unknown: "Status unklar" };'
)
replace_once(
    ui,
    '  const activeQueue = data?.queue.filter((item) => item.status === "queued").length ?? 0;',
    '  const activeQueue = data?.queue.filter((item) => item.status === "queued").length ?? 0;\n  const reviewQueue = data?.queue.filter((item) => item.status === "review").length ?? 0;'
)
replace_once(
    ui,
    '''      <div className={styles.sectionHeader}><div><h2>Bis zu {config.dailyOutreachLimit} Unternehmen am Tag.</h2><p>Freigegebene Kontakte erhalten eine individuelle erste Nachricht. Antworten landen direkt in der Inbox.</p></div><span className={`${styles.badge} ${config.dailyOutreachEnabled && heartbeatLive ? styles.good : ""}`}>{config.dailyOutreachEnabled ? heartbeatLive ? "Tageslauf aktiv" : "Wartet auf Verbindung" : "Tageslauf pausiert"}</span></div>''',
    '''      <div className={styles.sectionHeader}><div><h2>Erst prüfen, dann senden.</h2><p>Jede Erstnachricht landet zuerst hier zur manuellen Freigabe. Nur bestätigte Nachrichten wechseln in den kontrollierten Tageslauf.</p></div><span className={`${styles.badge} ${config.dailyOutreachEnabled && heartbeatLive ? styles.good : ""}`}>{data.queue.some((item) => item.status === "review") ? `${reviewQueue} Freigaben offen` : config.dailyOutreachEnabled ? heartbeatLive ? "Tageslauf aktiv" : "Wartet auf Verbindung" : "Tageslauf pausiert"}</span></div>'''
)
replace_once(
    ui,
    '''<p>{activeQueue} Kontakte warten auf den nächsten Versand.</p>''',
    '''<p>{reviewQueue} zur Prüfung · {activeQueue} freigegeben und wartend.</p>'''
)
replace_once(
    ui,
    '''<p>{config.outreachStartHour}:00–{config.outreachEndHour}:00 Uhr · {config.timezone}<br />Höchstens eine neue Nachricht alle zwei Minuten.</p>''',
    '''<p>{config.outreachStartHour}:00–{config.outreachEndHour}:00 Uhr · {config.timezone}<br />Freigegebene Erstnachrichten werden mit mindestens drei Minuten Abstand verarbeitet.</p>'''
)
replace_once(
    ui,
    '''<div className={styles.panel}><div className={styles.toolbar}><h3>Warteschlange</h3><button className={styles.secondary} onClick={() => { setTab("inbox"); setShowNew(true); }}>Kontakt hinzufügen</button></div><div className={styles.tableWrap}><table><thead><tr><th>Unternehmen</th><th>Status</th><th>Hinweis</th><th>Aktion</th></tr></thead><tbody>{data.queue.map((item) => { const row = data.threads.find((r) => r.thread.id === item.threadId); return <tr key={item.id}><td><strong>{row?.lead.company || "Kontakt"}</strong></td><td><span className={styles.badge}>{queueLabels[item.status] || item.status}</span></td><td>{item.error || (item.sentAt ? dateLabel(item.sentAt) : "Wird individuell vorbereitet")}</td><td><button className={styles.textButton} onClick={() => { chooseThread(item.threadId); setTab("inbox"); }}>Öffnen ↗</button>{item.status === "queued" && <button className={styles.textButton} disabled={Boolean(busy)} onClick={() => void action({ action: "queue", threadId: item.threadId, enabled: false })}>Herausnehmen</button>}</td></tr>; })}</tbody></table>{data.queue.length === 0 && <div className={styles.empty}><h3>Noch keine Kontakte freigegeben</h3><p>Öffne einen Lead, dokumentiere seine Zustimmung und klicke „Für Tageslauf freigeben“.</p></div>}</div></div>''',
    '''<div className={styles.panel}><div className={styles.toolbar}><h3>Freigabe & Warteschlange</h3><button className={styles.secondary} onClick={() => { setTab("inbox"); setShowNew(true); }}>Kontakt hinzufügen</button></div><div className={styles.tableWrap}><table><thead><tr><th>Unternehmen</th><th>Nachricht</th><th>Status</th><th>Aktion</th></tr></thead><tbody>{data.queue.map((item) => { const row = data.threads.find((r) => r.thread.id === item.threadId); return <tr key={item.id}><td><strong>{row?.lead.company || "Kontakt"}</strong>{row?.lead.summary && <small>{row.lead.summary.slice(0, 150)}</small>}</td><td><span>{item.body || "Entwurf wird vorbereitet …"}</span>{item.error && <small>{item.error}</small>}</td><td><span className={styles.badge}>{queueLabels[item.status] || item.status}</span>{item.sentAt && <small>{dateLabel(item.sentAt)}</small>}</td><td>{item.status === "review" && <><button className={styles.primary} disabled={Boolean(busy) || !item.body} onClick={() => void action({ action: "review", queueId: item.id, decision: "approve" })}>✓ Freigeben</button><button className={styles.dangerButton} disabled={Boolean(busy)} onClick={() => void action({ action: "review", queueId: item.id, decision: "reject" })}>Ablehnen</button></>}<button className={styles.textButton} onClick={() => { chooseThread(item.threadId); setTab("inbox"); }}>Details ↗</button>{item.status === "queued" && <button className={styles.textButton} disabled={Boolean(busy)} onClick={() => void action({ action: "queue", threadId: item.threadId, enabled: false })}>Freigabe zurückziehen</button>}</td></tr>; })}</tbody></table>{data.queue.length === 0 && <div className={styles.empty}><h3>Noch keine Erstnachrichten vorbereitet</h3><p>Öffne einen Lead, dokumentiere seine WhatsApp-Zustimmung und gib ihn für den Tageslauf frei. Der Entwurf erscheint dann zuerst hier zur Kontrolle.</p></div>}</div></div>'''
)

# Keep language in the product consistent: the user-facing product is the Outbound Tool, not a separate cockpit.
ui_text = Path(ui).read_text(encoding="utf-8")
ui_text = ui_text.replace("Cockpit-Zugang einrichten", "Outbound-Tool-Zugang absichern")
ui_text = ui_text.replace("braucht das Cockpit ein eigenes Passwort", "braucht das Outbound Tool ein eigenes Passwort")
ui_text = ui_text.replace("Aufgabe im Cockpit", "Aufgabe im Outbound Tool")
Path(ui).write_text(ui_text, encoding="utf-8")

# Document the deliberate review gate and fixed cadence. This is operational control, not an anti-detection mechanism.
doc = Path("docs/whatsapp-workspace.md")
if doc.exists():
    text = doc.read_text(encoding="utf-8")
    marker = "##"
    addition = '''\n\n## Manuelle Freigabe für Erstnachrichten\n\n- Neue Erstkontakte werden nie direkt aus der Vorbereitung versendet. Sie landen zuerst im Tageslauf mit Status `review`.\n- Der erste Text ist deterministisch: `Hallo, bin ich da bei <Unternehmensname> gelandet?`\n- Das Team sieht Unternehmen, Lead-Zusammenfassung und Nachricht nebeneinander und entscheidet `Freigeben` oder `Ablehnen`.\n- Nur freigegebene Einträge wechseln auf `queued`. Der Tageslauf verarbeitet sie innerhalb des erlaubten Zeitfensters mit mindestens drei Minuten Abstand.\n- Die Freigabe ersetzt keine WhatsApp-Einwilligung. Ohne dokumentierte Zustimmung bleibt der Versand technisch gesperrt.\n- Opt-out, Sperr-Tags, geschlossene Chats oder eine Team-Übernahme stoppen auch bereits vorbereitete Einträge.\n'''
    if "## Manuelle Freigabe für Erstnachrichten" not in text:
        doc.write_text(text.rstrip() + addition + "\n", encoding="utf-8")

print("WhatsApp review gate applied")
