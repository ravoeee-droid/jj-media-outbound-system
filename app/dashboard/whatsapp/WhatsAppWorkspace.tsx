"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { DEFAULT_AGENT, type AgentConfig, type AgentMode, type CalendarSlot, type KnowledgeEntry } from "@/lib/whatsapp/policy";
import styles from "./WhatsAppWorkspace.module.css";

type Lead = { id: string; company: string; contact: string; phone: string; pipelineStage?: string; slug?: string; videoStatus?: string; summary?: string; websiteUrl?: string; salesPriority?: number };
type Thread = { id: string; leadId: string; phone: string; mode: AgentMode; consent: string; consentNote: string; consentAt: string | null; status: string; handoffReason: string; summary: string; intent: string; unread: boolean; version: number; lastMessageAt: string | null; lastInboundId: string | null; offeredSlots: CalendarSlot[]; nextFollowUpAt: string | null };
type Message = { id: string; direction: string; body: string; status: string; kind: string; createdAt: string; idempotencyKey: string; metadata: { actor?: string; reason?: string; handoff?: boolean; confidence?: number; usedKnowledge?: { id: string; title: string }[]; error?: string; attachmentId?: string } };
type QueueItem = { id: string; threadId: string; status: string; error: string; messageId: string | null; body: string | null; sentAt: string | null; createdAt: string };
type Data = { config: AgentConfig; threads: { thread: Thread; lead: Lead }[]; leads: Lead[]; queue: QueueItem[]; connection: { configured: boolean; connected: boolean; message: string; phone: string; qr: string }; calendar: boolean; googleConfigured: boolean; secureAccess: boolean; lastTick: string | null; sentToday: number; workspaceId: string };
type Detail = { thread: Thread; lead: Lead; messages: Message[]; reservations: { id: string; status: string; startAt: string; joinUrl: string }[] };
type TestLine = { role: "user" | "assistant"; content: string; reason?: string; handoff?: boolean; sources?: { id: string; title: string }[] };
type ActionResult = { thread?: Thread; message?: Message | string; slots?: CalendarSlot[]; confirmation?: string; booking?: { eventId: string }; error?: string };

const modeLabels: Record<AgentMode, string> = { manual: "Manuell", copilot: "Copilot", autopilot: "Autopilot" };
const messageLabels: Record<string, string> = { received: "Eingegangen", draft: "KI-Entwurf", sending: "Wird gesendet", sent: "Gesendet", delivered: "Zugestellt", read: "Gelesen", unknown: "Status prüfen", used: "Übernommen" };
const statusLabels: Record<string, string> = { open: "Offen", handoff: "Übernahme nötig", booked: "Termin gebucht", closed: "Gestoppt" };
const queueLabels: Record<string, string> = { review: "Freigabe offen", queued: "Freigegeben", sending: "Wird gesendet", sent: "Gesendet", cancelled: "Gestoppt", skipped: "Übersprungen", unknown: "Status unklar" };
const categories: { value: KnowledgeEntry["category"]; label: string }[] = [{ value: "company", label: "Unternehmen" }, { value: "offer", label: "Angebot" }, { value: "price", label: "Preise & Laufzeiten" }, { value: "reference", label: "Referenz" }, { value: "faq", label: "Häufige Frage" }, { value: "objection", label: "Einwand" }, { value: "process", label: "Ablauf" }];
const tabs = [{ id: "inbox", label: "Inbox" }, { id: "daily", label: "Tageslauf" }, { id: "knowledge", label: "KI-Wissen & Regeln" }, { id: "connection", label: "Verbindungen" }] as const;

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, cache: "no-store" });
  const value = await response.json();
  if (!response.ok) throw new Error(value.error || "Die Anfrage konnte nicht abgeschlossen werden.");
  return value as T;
}
const dateLabel = (value: string | null) => value ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/Berlin" }).format(new Date(value)) : "Noch kein Kontakt";

export default function WhatsAppWorkspace() {
  const [data, setData] = useState<Data | null>(null);
  const [refreshedAt, setRefreshedAt] = useState(0);
  const [config, setConfig] = useState<AgentConfig>(DEFAULT_AGENT);
  const [dirty, setDirty] = useState(false);
  const dirtyRef = useRef(false);
  const [tab, setTab] = useState<string>("inbox");
  const [selected, setSelected] = useState<string | null>(null);
  const selectedRef = useRef<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [showNew, setShowNew] = useState(false);
  const [newLeadId, setNewLeadId] = useState("");
  const [newPhone, setNewPhone] = useState("");
  const [body, setBody] = useState("");
  const [draftId, setDraftId] = useState<string | undefined>();
  const [composerVersion, setComposerVersion] = useState<number | null>(null);
  const [attachment, setAttachment] = useState<{ id: string; filename: string } | null>(null);
  const sendKey = useRef("");
  const [consentNote, setConsentNote] = useState("");
  const [slots, setSlots] = useState<CalendarSlot[]>([]);
  const [bookingSlot, setBookingSlot] = useState<CalendarSlot | null>(null);
  const [entryId, setEntryId] = useState("jj-company");
  const [testLines, setTestLines] = useState<TestLine[]>([]);
  const [testInput, setTestInput] = useState("");
  const uploadRef = useRef<HTMLInputElement>(null);
  const chooseThread = useCallback((id: string | null) => {
    selectedRef.current = id; setSelected(id); setDetail(null); setBody(""); setDraftId(undefined); setComposerVersion(null); setAttachment(null); setSlots([]); setBookingSlot(null); setConsentNote(""); sendKey.current = "";
  }, []);

  const refresh = useCallback(async () => {
    const result = await request<Data>("/api/whatsapp");
    setData(result);
    setRefreshedAt(Date.now());
    if (!dirtyRef.current) setConfig(result.config);
    return result;
  }, []);
  const refreshDetail = useCallback(async (id: string) => {
    const result = await request<Detail>(`/api/whatsapp?thread=${id}`);
    if (selectedRef.current === id) setDetail(result);
    return result;
  }, []);

  useEffect(() => {
    let live = true;
    async function load() {
      try {
        const result = await refresh();
        if (!live) return;
        const params = new URLSearchParams(window.location.search);
        if (tabs.some((t) => t.id === params.get("tab"))) setTab(params.get("tab")!);
        const leadId = params.get("lead");
        const existing = result.threads.find((row) => row.lead.id === leadId);
        if (existing) chooseThread(existing.thread.id);
        else if (leadId) { const lead = result.leads.find((l) => l.id === leadId); if (lead) { setNewLeadId(lead.id); setNewPhone(lead.phone); setShowNew(true); } }
      } catch (err) { if (live) setError(err instanceof Error ? err.message : "WhatsApp konnte nicht geladen werden."); }
      finally { if (live) setLoading(false); }
    }
    void load();
    const poll = window.setInterval(() => { if (!document.hidden) void refresh().catch(() => undefined); }, 30_000);
    return () => { live = false; window.clearInterval(poll); };
  }, [refresh, chooseThread]);

  useEffect(() => {
    if (!selected) return;
    void refreshDetail(selected).catch((err) => setError(err.message));
    const poll = window.setInterval(() => { if (!document.hidden) void refreshDetail(selected).catch(() => undefined); }, 12_000);
    return () => window.clearInterval(poll);
  }, [selected, refreshDetail]);

  function changeConfig(patch: Partial<AgentConfig>) { dirtyRef.current = true; setDirty(true); setConfig((current) => ({ ...current, ...patch })); }
  async function saveConfig(next = config) {
    setBusy("save"); setError(""); setNotice("");
    try {
      const result = await request<{ config: AgentConfig }>("/api/whatsapp/agent", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(next) });
      setConfig(result.config); dirtyRef.current = false; setDirty(false); setNotice("Wissen und Regeln gespeichert."); await refresh();
    } catch (err) { setError(err instanceof Error ? err.message : "Speichern fehlgeschlagen."); }
    finally { setBusy(""); }
  }
  async function action(payload: Record<string, unknown>, label = String(payload.action)): Promise<ActionResult | null> {
    setBusy(label); setError(""); setNotice("");
    try {
      const result = await request<ActionResult>("/api/whatsapp", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      await refresh();
      if (selectedRef.current) await refreshDetail(selectedRef.current);
      return result;
    } catch (err) { setError(err instanceof Error ? err.message : "Vorgang fehlgeschlagen."); return null; }
    finally { setBusy(""); }
  }
  async function addContact(event: FormEvent) {
    event.preventDefault();
    const result = await action({ action: "open", leadId: newLeadId, phone: newPhone });
    if (result?.thread) { chooseThread(result.thread.id); setShowNew(false); setTab("inbox"); }
  }
  function editBody(text: string, source?: Message) {
    setBody(text); setDraftId(source?.id); setComposerVersion(detail?.thread.version ?? null); sendKey.current = crypto.randomUUID();
  }
  async function send(event: FormEvent) {
    event.preventDefault();
    if (!detail) return;
    const id = detail.thread.id;
    sendKey.current ||= crypto.randomUUID();
    const result = await action({ action: "send", threadId: id, body, key: sendKey.current, expectedVersion: composerVersion ?? detail.thread.version, attachmentId: attachment?.id, draftId });
    if (result && selectedRef.current === id) { setBody(""); setDraftId(undefined); setAttachment(null); setComposerVersion(null); sendKey.current = ""; setNotice("Nachricht von WhatsApp angenommen. Sie haben den Chat übernommen."); }
  }
  async function makeDraft() {
    if (!selected) return;
    const id = selected;
    const result = await action({ action: "draft", threadId: id });
    if (result?.message && typeof result.message !== "string" && selectedRef.current === id) editBody(result.message.body, result.message);
  }
  async function upload(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    const id = selectedRef.current;
    setBusy("upload"); setError("");
    try {
      const form = new FormData(); form.set("file", file);
      const result = await request<{ asset: { id: string; filename: string } }>("/api/whatsapp/upload", { method: "POST", body: form });
      if (selectedRef.current === id) { setAttachment(result.asset); setComposerVersion(detail?.thread.version ?? null); sendKey.current = crypto.randomUUID(); }
    } catch (err) { setError(err instanceof Error ? err.message : "Upload fehlgeschlagen."); }
    finally { setBusy(""); event.target.value = ""; }
  }
  function updateEntry(patch: Partial<KnowledgeEntry>) {
    const id = config.knowledge.find((entry) => entry.id === entryId)?.id ?? config.knowledge[0]?.id;
    changeConfig({ knowledge: config.knowledge.map((entry) => entry.id === id ? { ...entry, ...patch, ...(patch.content !== undefined || patch.title !== undefined || patch.source !== undefined || patch.category !== undefined ? { approved: false } : {}) } : entry) });
  }
  function addEntry() {
    const id = crypto.randomUUID(); changeConfig({ knowledge: [...config.knowledge, { id, title: "Neuer Wissenseintrag", category: "faq", content: "", source: "", approved: false }] }); setEntryId(id);
  }
  async function importKnowledge(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]; if (!file) return;
    if (!/\.(txt|md)$/i.test(file.name) || file.size > 8_000) { setError("Bitte eine TXT- oder Markdown-Datei bis 8 KB auswählen. Längere Inhalte auf mehrere Einträge verteilen."); return; }
    const text = await file.text(); const id = crypto.randomUUID();
    changeConfig({ knowledge: [...config.knowledge, { id, title: file.name.replace(/\.(txt|md)$/i, "").slice(0, 120), category: "faq", content: text, source: file.name, approved: false }] }); setEntryId(id); event.target.value = "";
  }
  async function testAgent(text = testInput) {
    if (!text.trim() || busy) return;
    const next: TestLine[] = [...testLines, { role: "user", content: text.trim() }];
    setTestLines(next); setTestInput(""); setBusy("test"); setError("");
    try {
      const result = await request<{ decision: { reply: string; reason: string; handoff: boolean; usedKnowledge: { id: string; title: string }[] } }>("/api/whatsapp/agent", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ config, history: next.slice(-20).map(({ role, content }) => ({ role, content })) }) });
      setTestLines([...next, { role: "assistant", content: result.decision.reply || "Der Kontakt wird gestoppt.", reason: result.decision.reason, handoff: result.decision.handoff, sources: result.decision.usedKnowledge }]);
    } catch (err) { setError(err instanceof Error ? err.message : "Der Test konnte nicht ausgeführt werden."); }
    finally { setBusy(""); }
  }

  const selectedEntry = config.knowledge.find((entry) => entry.id === entryId) ?? config.knowledge[0];
  const filtered = data?.threads.filter(({ thread, lead }) => `${lead.company} ${lead.contact} ${thread.phone}`.toLowerCase().includes(search.toLowerCase()) && (filter === "all" || filter === "unread" && thread.unread || filter === thread.status)) ?? [];
  const latestDraft = detail?.messages.filter((message) => message.status === "draft" && message.metadata.actor !== "human").at(-1);
  const activeQueue = data?.queue.filter((item) => item.status === "queued").length ?? 0;
  const reviewQueue = data?.queue.filter((item) => item.status === "review").length ?? 0;
  const staleDraft = Boolean(detail && composerVersion !== null && composerVersion !== detail.thread.version && (body || attachment));
  const threadQueue = data?.queue.find((q) => q.threadId === selected);
  const heartbeatLive = Boolean(data?.lastTick && refreshedAt - Date.parse(data.lastTick) < 5 * 60_000);

  return <section className={styles.root}>
    <div className={styles.connectionBar}>
      <span className={`${styles.dot} ${data?.connection.connected ? styles.connected : ""}`} /><strong>{data?.connection.message || "Verbindung wird geprüft …"}</strong>
      <span className={styles.spacer} />
      <span>{config.enabled ? modeLabels[config.defaultMode] : "KI pausiert"}</span>
      <button className={styles.textButton} onClick={() => setTab("connection")}>Verbindungen</button>
    </div>
    <div className={styles.metrics}>
      <div><span>Antworten offen</span><strong>{data?.threads.filter((r) => r.thread.unread).length ?? "–"}</strong></div>
      <div><span>Für euch</span><strong>{data?.threads.filter((r) => r.thread.status === "handoff").length ?? "–"}</strong></div>
      <div><span>Termine gebucht</span><strong>{data?.threads.filter((r) => r.thread.status === "booked").length ?? "–"}</strong></div>
      <div><span>Heute angeschrieben</span><strong>{data?.sentToday ?? "–"}<small> / {data?.config.dailyOutreachLimit ?? 30}</small></strong></div>
    </div>
    <nav className={styles.tabs} aria-label="WhatsApp-Bereiche">{tabs.map((item) => <button key={item.id} className={tab === item.id ? styles.tabActive : ""} aria-current={tab === item.id ? "page" : undefined} onClick={() => setTab(item.id)}>{item.label}{item.id === "knowledge" && dirty && <span aria-label="Ungespeicherte Änderungen"> •</span>}</button>)}</nav>
    {error && <div className={styles.error} role="alert">{error}<button aria-label="Fehlermeldung schließen" onClick={() => setError("")}>×</button></div>}
    {notice && <div className={styles.notice} role="status">{notice}</div>}
    {loading && <div className={styles.empty} role="status">Unterhaltungen werden geladen …</div>}
    {!loading && !data && <div className={styles.empty}><h2>WhatsApp konnte nicht geladen werden</h2><p>Bitte die Verbindung erneut prüfen.</p><button className={styles.primary} onClick={() => void refresh().then(() => setError("")).catch((err) => setError(err.message))}>Erneut laden</button></div>}

    {tab === "inbox" && data && <>
      <div className={styles.toolbar}><h2>Unterhaltungen <span>{data.threads.length}</span></h2><button className={styles.primary} onClick={() => setShowNew(!showNew)}>{showNew ? "Schließen" : "+ Kontakt öffnen"}</button></div>
      {showNew && <form className={styles.newContact} onSubmit={addContact}>
        <label>Lead<select required value={newLeadId} onChange={(event) => { setNewLeadId(event.target.value); setNewPhone(data.leads.find((lead) => lead.id === event.target.value)?.phone || ""); }}><option value="">Unternehmen auswählen</option>{data.leads.map((lead) => <option key={lead.id} value={lead.id}>{lead.company}</option>)}</select></label>
        <label>WhatsApp-Nummer<input required type="tel" value={newPhone} onChange={(event) => setNewPhone(event.target.value)} placeholder="+49 …" /></label>
        <button className={styles.primary} disabled={Boolean(busy)}>Kontakt öffnen</button>
        <small>Es wird noch keine Nachricht gesendet.</small>
      </form>}
      <div className={`${styles.inbox} ${selected ? styles.hasSelection : ""}`}>
        <aside className={styles.threadList}>
          <label className={styles.search}><span className={styles.srOnly}>Unterhaltung suchen</span><input placeholder="Unternehmen oder Kontakt suchen" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
          <select aria-label="Unterhaltungen filtern" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">Alle Unterhaltungen</option><option value="unread">Ungelesen</option><option value="handoff">Übernahme nötig</option><option value="booked">Termin gebucht</option><option value="closed">Gestoppt</option></select>
          <div className={styles.threadRows}>{filtered.map(({ thread, lead }) => <button key={thread.id} className={selected === thread.id ? styles.threadSelected : styles.threadButton} onClick={() => { chooseThread(thread.id); }}>
            <span className={styles.avatar}>{lead.company.slice(0, 2).toUpperCase()}</span><span className={styles.threadCopy}><strong>{lead.company}</strong><span>{thread.summary || lead.contact || `+${thread.phone}`}</span><small>{dateLabel(thread.lastMessageAt)}</small></span>{thread.unread && <span className={styles.unread} aria-label="Ungelesen" />}
          </button>)}{filtered.length === 0 && <p className={styles.listEmpty}>Noch keine passende Unterhaltung. Öffne einen Kontakt aus eurem CRM.</p>}</div>
        </aside>
        {!selected && <div className={styles.empty}><span className={styles.emptyIcon}>↗</span><h2>Aus Kontakten werden Gespräche.</h2><p>Öffne einen Lead, dokumentiere die WhatsApp-Zustimmung und bereite die erste Nachricht vor.</p><button className={styles.secondary} onClick={() => setShowNew(true)}>Kontakt auswählen</button></div>}
        {selected && !detail && <div className={styles.empty} role="status">Verlauf wird geladen …</div>}
        {detail && <>
          <section className={styles.chat} aria-label={`Chat mit ${detail.lead.company}`}>
            <header className={styles.chatHeader}><button className={styles.mobileBack} onClick={() => { chooseThread(null); }}>← Zurück</button><div><h3>{detail.lead.company}</h3><span>{detail.lead.contact || `+${detail.thread.phone}`}</span></div><span className={styles.badge}>{statusLabels[detail.thread.status]}</span><button className={styles.textButton} disabled={Boolean(busy)} onClick={() => void action({ action: "update", threadId: selected, patch: { unread: false } })}>Als gelesen</button></header>
            {detail.thread.status === "handoff" && <div className={styles.handoff}><strong>Das Team ist gefragt</strong><p>{detail.thread.handoffReason}</p></div>}
            <div className={styles.history} aria-live="polite">
              {detail.messages.filter((message) => !["draft", "used"].includes(message.status)).map((message) => <article key={message.id} className={`${styles.bubble} ${message.direction === "outbound" ? styles.outgoing : styles.incoming}`}>
                <span className={styles.bubbleAuthor}>{message.direction === "inbound" ? detail.lead.contact || detail.lead.company : message.metadata.actor === "human" ? "JJ-Media · Team" : "JJ-Media · KI"}</span>
                <p>{message.body || (message.kind === "audio" ? "Sprachnachricht · bitte in WhatsApp anhören" : "Anhang · bitte in WhatsApp öffnen")}</p>
                {message.kind === "attachment" && <span>Anhang mitgesendet</span>}
                <footer>{dateLabel(message.createdAt)} · {messageLabels[message.status] || message.status}</footer>
                {["unknown", "sending"].includes(message.status) && <button className={styles.textButton} disabled={Boolean(busy)} onClick={() => void action({ action: "reconcile", messageId: message.id }).then((result) => { if (typeof result?.message === "string") setNotice(result.message); })}>Versandstatus prüfen</button>}
              </article>)}
              {detail.messages.length === 0 && <div className={styles.historyEmpty}><h3>Bereit für die erste Nachricht</h3><p>Nach dokumentierter Zustimmung kannst du einen persönlichen Entwurf erstellen oder den Kontakt für den Tageslauf freigeben.</p></div>}
            </div>
            {latestDraft && <div className={styles.draft}><div><strong>✦ KI-Vorschlag</strong><span>{latestDraft.metadata.handoff ? "Persönliche Prüfung" : "Zur Freigabe"}</span></div><p>{latestDraft.body}</p>{latestDraft.metadata.reason && <small>{latestDraft.metadata.reason}</small>}{latestDraft.metadata.usedKnowledge?.length ? <small>Wissen: {latestDraft.metadata.usedKnowledge.map((k) => k.title).join(" · ")}</small> : null}<button className={styles.secondary} onClick={() => editBody(latestDraft.body, latestDraft)}>In Nachricht übernehmen</button></div>}
            <form className={styles.composer} onSubmit={send}>
              {detail.thread.consent !== "granted" && <p className={styles.warning}>Vor dem Versand die WhatsApp-Zustimmung dokumentieren.</p>}
              {staleDraft && <p className={styles.warning}>Der Kontakt wurde aktualisiert. Bitte den Verlauf prüfen und den Entwurf erneut übernehmen oder bearbeiten.</p>}
              <label className={styles.srOnly} htmlFor="whatsapp-message">Deine Nachricht</label><textarea id="whatsapp-message" rows={4} placeholder="Persönliche Nachricht schreiben …" value={body} maxLength={4_000} onChange={(event) => { setBody(event.target.value); setDraftId(undefined); if (composerVersion === null || staleDraft) setComposerVersion(detail.thread.version); sendKey.current = crypto.randomUUID(); }} />
              {attachment && <div className={styles.attachment}>{attachment.filename}<button type="button" aria-label="Anhang entfernen" onClick={() => setAttachment(null)}>×</button></div>}
              <div className={styles.composerActions}><button type="button" className={styles.secondary} disabled={Boolean(busy)} onClick={makeDraft}>✦ {busy === "draft" ? "KI schreibt …" : "KI-Entwurf"}</button><button type="button" className={styles.textButton} disabled={Boolean(busy)} onClick={() => uploadRef.current?.click()}>Anhang</button><input ref={uploadRef} className={styles.srOnly} type="file" accept="image/jpeg,image/png,image/webp,application/pdf,audio/mpeg,audio/mp4,audio/ogg,audio/wav,audio/webm" onChange={upload} /><span className={styles.spacer} /><button className={styles.primary} disabled={Boolean(busy) || !data.connection.connected || detail.thread.consent !== "granted" || detail.thread.status === "closed" || staleDraft || (!body.trim() && !attachment)}>{busy === "send" ? "Wird gesendet …" : "Senden ↗"}</button></div>
              <small>Mit einer manuellen Nachricht übernimmst du den Chat. Bilder, PDF und Audio bis 3 MB.</small>
            </form>
          </section>
          <aside className={styles.inspector}>
            <section><h3>Steuerung</h3><label>Modus<select value={detail.thread.mode} disabled={Boolean(busy)} onChange={(event) => void action({ action: "update", threadId: selected, patch: { mode: event.target.value, status: "open" } })}>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><p className={styles.hint}>{!config.enabled ? "Die KI ist global pausiert." : detail.thread.mode === "copilot" ? "Die KI entwirft. Ihr sendet." : detail.thread.mode === "autopilot" ? "Die KI antwortet innerhalb eurer Regeln." : "Das Team führt dieses Gespräch."}</p><button className={styles.secondary} disabled={Boolean(busy)} onClick={() => void action({ action: "handoff", threadId: selected })}>Chat übernehmen</button></section>
            <section><h3>WhatsApp-Zustimmung</h3><span className={`${styles.badge} ${detail.thread.consent === "granted" ? styles.good : ""}`}>{detail.thread.consent === "granted" ? "Dokumentiert" : detail.thread.consent === "revoked" ? "Widerrufen" : "Noch offen"}</span>{detail.thread.consentAt && <small>{dateLabel(detail.thread.consentAt)}</small>}{detail.thread.consentNote && <p className={styles.hint}>{detail.thread.consentNote}</p>}<label>Nachweis<textarea rows={3} value={consentNote} onChange={(event) => setConsentNote(event.target.value)} placeholder="Z. B. heute im Telefonat: Kontakt möchte Informationen und Rückfragen per WhatsApp erhalten." /></label><button className={styles.secondary} disabled={Boolean(busy) || consentNote.trim().length < 10} onClick={() => void action({ action: "update", threadId: selected, patch: { consent: "granted", consentNote } }).then((r) => { if (r) setConsentNote(""); })}>Zustimmung speichern</button><button className={styles.dangerButton} disabled={Boolean(busy) || detail.thread.consent === "revoked"} onClick={() => void action({ action: "update", threadId: selected, patch: { consent: "revoked", consentNote: "Vom Team gestoppt" } })}>Kontakt stoppen</button></section>
            <section><h3>Nächster Schritt</h3><button className={styles.secondary} disabled={Boolean(busy) || detail.thread.consent !== "granted"} onClick={() => void action({ action: "queue", threadId: selected, enabled: threadQueue?.status !== "queued" })}>{threadQueue?.status === "queued" ? "Aus Tageslauf nehmen" : "Für Tageslauf freigeben"}</button>{threadQueue && <small>{queueLabels[threadQueue.status]} {threadQueue.error}</small>}{detail.lead.videoStatus === "ready" && detail.lead.slug && <button className={styles.textButton} onClick={() => editBody(`Hallo ${detail.lead.contact || ""}, wie besprochen finden Sie hier die vorbereitete Analyse für ${detail.lead.company}:\n\n${window.location.origin}/v/${detail.lead.slug}\n\nWas interessiert Sie daran besonders?`)}>Fertige Analyse einfügen</button>}<Link className={styles.textLink} href="/dashboard/outbound#leads">CRM öffnen ↗</Link></section>
            <section><h3>Termin finden</h3><small>{config.durationMinutes} Minuten · {config.timezone}</small><button className={styles.secondary} disabled={Boolean(busy) || !data.calendar || !config.allowBooking} onClick={() => { const id = selected; void action({ action: "slots", threadId: id }).then((r) => { if (r?.slots && selectedRef.current === id) setSlots(r.slots); }); }}>Freie Zeiten laden</button>{(!data.calendar || !config.allowBooking) && <p className={styles.hint}>Kalender verbinden und Terminierung in den Regeln aktivieren.</p>}{slots.map((slot) => <button className={styles.slot} key={slot.id} disabled={Boolean(busy)} onClick={() => setBookingSlot(slot)}>{slot.label}</button>)}{bookingSlot && <div className={styles.bookingConfirm}><strong>{bookingSlot.label}</strong><p>Hat der Kontakt dieser Zeit zugestimmt?</p><button className={styles.primary} disabled={Boolean(busy)} onClick={() => { const id = selected; void action({ action: "book", threadId: id, slotId: bookingSlot.id, expectedVersion: detail.thread.version }).then((r) => { if (r?.confirmation && selectedRef.current === id) { editBody(r.confirmation); setBookingSlot(null); setSlots([]); setNotice("Termin im Google Kalender gebucht. Die Bestätigung ist zum Versand vorbereitet."); } }); }}>Bestätigten Termin buchen</button><button className={styles.textButton} onClick={() => setBookingSlot(null)}>Zurück</button></div>}{detail.reservations.filter((r) => r.status === "confirmed").map((r) => <p className={styles.confirmedBooking} key={r.id}>✓ {dateLabel(r.startAt)}{r.joinUrl && <a href={r.joinUrl} target="_blank" rel="noreferrer">Gespräch öffnen ↗</a>}</p>)}{detail.thread.nextFollowUpAt && <p className={styles.hint}>Wiedervorlage: {dateLabel(detail.thread.nextFollowUpAt)}</p>}</section>
          </aside>
        </>}
      </div>
    </>}

    {tab === "daily" && data && <div className={styles.daily}>
      <div className={styles.sectionHeader}><div><h2>Erst prüfen, dann senden.</h2><p>Jede Erstnachricht landet zuerst hier zur manuellen Freigabe. Nur bestätigte Nachrichten wechseln in den kontrollierten Tageslauf.</p></div><span className={`${styles.badge} ${config.dailyOutreachEnabled && heartbeatLive ? styles.good : ""}`}>{reviewQueue > 0 ? `${reviewQueue} Freigaben offen` : config.dailyOutreachEnabled ? heartbeatLive ? "Tageslauf aktiv" : "Wartet auf Verbindung" : "Tageslauf pausiert"}</span></div>
      <div className={styles.dailyCards}><div className={styles.panel}><span>Heute versendet</span><strong className={styles.largeNumber}>{data.sentToday}<small> / {config.dailyOutreachLimit}</small></strong><progress value={data.sentToday} max={config.dailyOutreachLimit} /><p>{reviewQueue} zur Prüfung · {activeQueue} freigegeben und wartend.</p></div><div className={styles.panel}><h3>Versand steuern</h3><p>{config.outreachStartHour}:00–{config.outreachEndHour}:00 Uhr · {config.timezone}<br />Freigegebene Erstnachrichten werden mit mindestens drei Minuten Abstand verarbeitet.</p><button className={config.dailyOutreachEnabled ? styles.secondary : styles.primary} disabled={Boolean(busy) || (!config.dailyOutreachEnabled && !data.connection.connected)} onClick={() => void saveConfig({ ...config, enabled: true, dailyOutreachEnabled: !config.dailyOutreachEnabled })}>{config.dailyOutreachEnabled ? "Tageslauf pausieren" : "Tageslauf aktivieren"}</button><button className={styles.textButton} onClick={() => setTab("knowledge")}>Limit & Regeln bearbeiten</button></div></div>
      <div className={styles.panel}><div className={styles.toolbar}><h3>Freigabe & Warteschlange</h3><button className={styles.secondary} onClick={() => { setTab("inbox"); setShowNew(true); }}>Kontakt hinzufügen</button></div><div className={styles.tableWrap}><table><thead><tr><th>Unternehmen</th><th>Nachricht</th><th>Status</th><th>Aktion</th></tr></thead><tbody>{data.queue.map((item) => { const row = data.threads.find((r) => r.thread.id === item.threadId); return <tr key={item.id}><td><strong>{row?.lead.company || "Kontakt"}</strong>{row?.lead.summary && <small>{row.lead.summary.slice(0, 150)}</small>}</td><td><span>{item.body || "Entwurf wird vorbereitet …"}</span>{item.error && <small>{item.error}</small>}</td><td><span className={styles.badge}>{queueLabels[item.status] || item.status}</span>{item.sentAt && <small>{dateLabel(item.sentAt)}</small>}</td><td>{item.status === "review" && <><button className={styles.primary} disabled={Boolean(busy) || !item.body} onClick={() => void action({ action: "review", queueId: item.id, decision: "approve" })}>✓ Freigeben</button><button className={styles.dangerButton} disabled={Boolean(busy)} onClick={() => void action({ action: "review", queueId: item.id, decision: "reject" })}>Ablehnen</button></>}<button className={styles.textButton} onClick={() => { chooseThread(item.threadId); setTab("inbox"); }}>Details ↗</button>{item.status === "queued" && <button className={styles.textButton} disabled={Boolean(busy)} onClick={() => void action({ action: "queue", threadId: item.threadId, enabled: false })}>Freigabe zurückziehen</button>}</td></tr>; })}</tbody></table>{data.queue.length === 0 && <div className={styles.empty}><h3>Noch keine Erstnachrichten vorbereitet</h3><p>Öffne einen Lead, dokumentiere seine WhatsApp-Zustimmung und gib ihn für den Tageslauf frei. Der Entwurf erscheint dann zuerst hier zur Kontrolle.</p></div>}</div></div>
    </div>}

    {tab === "knowledge" && <div className={styles.knowledge}>
      <div className={styles.sectionHeader}><div><h2>So arbeitet eure KI.</h2><p>Hinterlegt Wissen, Beispiele und klare Regeln. Die KI verwendet ausschließlich freigegebene Einträge.</p></div><button className={styles.primary} disabled={Boolean(busy) || !dirty} onClick={() => void saveConfig()}>{busy === "save" ? "Speichert …" : dirty ? "Änderungen speichern" : "Gespeichert"}</button></div>
      <div className={styles.knowledgeLayout}><div>
        <div className={styles.panel}><div className={styles.toolbar}><h3>Wissensbasis <span>{config.knowledge.filter((k) => k.approved).length} freigegeben</span></h3><button className={styles.secondary} onClick={addEntry}>+ Eintrag</button><label className={styles.importButton}>Text importieren<input className={styles.srOnly} type="file" accept=".txt,.md" onChange={importKnowledge} /></label></div>
          <div className={styles.knowledgeEditor}><div className={styles.entryList}>{config.knowledge.map((entry) => <button key={entry.id} onClick={() => setEntryId(entry.id)} className={selectedEntry?.id === entry.id ? styles.entrySelected : ""}><strong>{entry.title}</strong><small>{categories.find((c) => c.value === entry.category)?.label} · {entry.approved ? "Freigegeben" : "Entwurf"}</small></button>)}</div>
            {selectedEntry && <div className={styles.entryForm}><label>Titel<input value={selectedEntry.title} maxLength={120} onChange={(event) => { setEntryId(selectedEntry.id); updateEntry({ title: event.target.value }); }} /></label><label>Kategorie<select value={selectedEntry.category} onChange={(event) => updateEntry({ category: event.target.value as KnowledgeEntry["category"] })}>{categories.map((category) => <option value={category.value} key={category.value}>{category.label}</option>)}</select></label><label>Wissen & Antwortbeispiele<textarea rows={10} value={selectedEntry.content} maxLength={8_000} onChange={(event) => updateEntry({ content: event.target.value })} placeholder="Konkrete Fakten, freigegebene Preise oder bewährte Antworten …" /></label><label>Quelle oder Stand<input value={selectedEntry.source} maxLength={500} placeholder="Z. B. Angebot September 2026" onChange={(event) => updateEntry({ source: event.target.value })} /></label><label className={styles.checkbox}><input type="checkbox" checked={selectedEntry.approved} onChange={(event) => updateEntry({ approved: event.target.checked })} />Dieser Inhalt ist geprüft und für die KI freigegeben.</label><small>Inhaltliche Änderungen setzen die Freigabe zurück.</small><button className={styles.dangerButton} onClick={() => { changeConfig({ knowledge: config.knowledge.filter((k) => k.id !== selectedEntry.id) }); setEntryId(config.knowledge.find((k) => k.id !== selectedEntry.id)?.id || ""); }}>Eintrag entfernen</button></div>}
          </div>
        </div>
        <div className={styles.panel}><h3>Aufgabe & Gesprächsführung</h3><div className={styles.formGrid}><label>Name der KI<input value={config.name} onChange={(e) => changeConfig({ name: e.target.value })} /></label><label>Übergabe an<input value={config.handoffName} onChange={(e) => changeConfig({ handoffName: e.target.value })} /></label><label className={styles.full}>Ton & Schreibstil<textarea rows={3} value={config.tone} onChange={(e) => changeConfig({ tone: e.target.value })} /></label><label className={styles.full}>Anweisungen<textarea rows={5} value={config.instructions} onChange={(e) => changeConfig({ instructions: e.target.value })} /></label><label className={styles.full}>Fragen zur Qualifizierung<textarea rows={3} value={config.qualification} onChange={(e) => changeConfig({ qualification: e.target.value })} /></label><label className={styles.full}>Wann das Team übernimmt<textarea rows={3} value={config.handoffRules} onChange={(e) => changeConfig({ handoffRules: e.target.value })} /></label></div></div>
        <div className={styles.panel}><h3>Automatisierung</h3><div className={styles.formGrid}><label className={styles.checkbox}><input type="checkbox" checked={config.enabled} onChange={(e) => changeConfig({ enabled: e.target.checked, ...(!e.target.checked ? { dailyOutreachEnabled: false } : {}) })} />KI aktivieren</label><label>Standardmodus<select value={config.defaultMode} onChange={(e) => changeConfig({ defaultMode: e.target.value as AgentMode })}>{Object.entries(modeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Maximale KI-Antworten je Chat<input type="number" min={1} max={30} value={config.maxAutoReplies} onChange={(e) => changeConfig({ maxAutoReplies: Number(e.target.value) })} /></label><label>Neue Unternehmen pro Tag<input type="number" min={1} max={30} value={config.dailyOutreachLimit} onChange={(e) => changeConfig({ dailyOutreachLimit: Number(e.target.value) })} /></label><label>Versand ab<input type="number" min={0} max={22} value={config.outreachStartHour} onChange={(e) => changeConfig({ outreachStartHour: Number(e.target.value) })} /></label><label>Versand bis<input type="number" min={1} max={23} value={config.outreachEndHour} onChange={(e) => changeConfig({ outreachEndHour: Number(e.target.value) })} /></label><label className={styles.full}>Anweisung für die erste Nachricht<textarea rows={4} value={config.outreachInstructions} onChange={(e) => changeConfig({ outreachInstructions: e.target.value })} /></label></div><p className={styles.hint}>Autopilot muss zusätzlich pro Kontakt gewählt sein. Gestoppte Kontakte, fehlende Zustimmung und unklare Versandzustände werden nicht automatisch übersprungen.</p></div>
        <div className={styles.panel}><h3>Terminregeln</h3><label className={styles.checkbox}><input type="checkbox" checked={config.allowBooking} onChange={(e) => changeConfig({ allowBooking: e.target.checked })} />Freie Zeiten anbieten und bestätigte Termine buchen</label><div className={styles.formGrid}><label>Google-Kalender-ID<input value={config.calendarId} onChange={(e) => changeConfig({ calendarId: e.target.value })} /></label><label>Zeitzone<select value={config.timezone} onChange={(e) => changeConfig({ timezone: e.target.value })}><option>Europe/Berlin</option><option>Asia/Bangkok</option><option>Europe/Madrid</option><option>UTC</option></select></label><label>Gesprächsdauer<select value={config.durationMinutes} onChange={(e) => changeConfig({ durationMinutes: Number(e.target.value) })}>{[15, 30, 45, 60].map((v) => <option key={v} value={v}>{v} Minuten</option>)}</select></label><label>Vorlauf in Stunden<input type="number" min={1} max={168} value={config.noticeHours} onChange={(e) => changeConfig({ noticeHours: Number(e.target.value) })} /></label><label>Termine ab<input type="number" min={0} max={22} value={config.startHour} onChange={(e) => changeConfig({ startHour: Number(e.target.value) })} /></label><label>Termine bis<input type="number" min={1} max={23} value={config.endHour} onChange={(e) => changeConfig({ endHour: Number(e.target.value) })} /></label><label>Puffer in Minuten<input type="number" min={0} max={60} value={config.bufferMinutes} onChange={(e) => changeConfig({ bufferMinutes: Number(e.target.value) })} /></label></div><fieldset className={styles.weekdays}><legend>Arbeits- und Versandtage</legend>{["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((day, i) => <label key={day}><input type="checkbox" checked={config.weekdays.includes(i + 1)} onChange={(e) => changeConfig({ weekdays: e.target.checked ? [...config.weekdays, i + 1] : config.weekdays.filter((d) => d !== i + 1) })} />{day}</label>)}</fieldset><p className={styles.hint}>Eine Buchung erfolgt erst nach eindeutiger Auswahl. Vor dem Eintragen wird die Verfügbarkeit erneut geprüft.</p></div>
      </div>
      <aside className={`${styles.panel} ${styles.testPanel}`}><div className={styles.toolbar}><h3>Testchat</h3><button className={styles.textButton} disabled={Boolean(busy)} onClick={() => setTestLines([])}>Neu starten</button></div><p>Prüft eure aktuellen Eingaben. Es werden keine Nachrichten versendet und keine Termine gebucht.</p><div className={styles.testPrompts}>{["Was kostet eure Betreuung?", "Ich möchte einen Termin.", "Bitte keine Nachrichten mehr."].map((text) => <button key={text} disabled={Boolean(busy)} onClick={() => void testAgent(text)}>{text}</button>)}</div><div className={styles.testHistory} aria-live="polite">{testLines.map((line, index) => <article className={`${styles.bubble} ${line.role === "user" ? styles.outgoing : styles.incoming}`} key={index}><span className={styles.bubbleAuthor}>{line.role === "user" ? "Testkunde" : config.name}</span><p>{line.content}</p>{line.handoff && <small className={styles.warning}>Übergabe an das Team</small>}{line.reason && <small>{line.reason}</small>}{line.sources?.length ? <small>Wissen: {line.sources.map((source) => source.title).join(" · ")}</small> : null}</article>)}{busy === "test" && <p role="status">KI erstellt eine Antwort …</p>}</div><form onSubmit={(event) => { event.preventDefault(); void testAgent(); }}><label className={styles.srOnly} htmlFor="test-input">Kundenfrage testen</label><textarea id="test-input" rows={3} value={testInput} onChange={(e) => setTestInput(e.target.value)} placeholder="Schreibe wie ein Interessent …" maxLength={3_000} /><button className={styles.primary} disabled={Boolean(busy) || !testInput.trim()}>Antwort testen</button></form></aside></div>
    </div>}

    {tab === "connection" && data && <div className={styles.connections}>
      {!data.secureAccess && <div className={styles.panel}><h2>Outbound-Tool-Zugang absichern</h2><p>Vor dem ersten Versand oder einer Buchung braucht das Outbound Tool ein eigenes Passwort und einen geheimen Signaturschlüssel.</p><details><summary>Einrichtung für den Administrator</summary><p>In Vercel COCKPIT_PASSWORD mit mindestens 12 Zeichen und COCKPIT_AUTH_SECRET mit mindestens 32 zufälligen Zeichen hinterlegen. Danach die App neu bereitstellen und mit dem neuen Passwort anmelden.</p></details></div>}
      <div className={styles.panel}><div className={styles.toolbar}><h2>WhatsApp</h2><span className={`${styles.badge} ${data.connection.connected ? styles.good : ""}`}>{data.connection.connected ? "Verbunden" : "Einrichtung offen"}</span></div><p>{data.connection.message}</p>{data.connection.phone && <p>Verbundene Nummer: +{data.connection.phone}</p>}{data.connection.qr.startsWith("data:image/png;base64,") && <div className={styles.qr}><Image src={data.connection.qr} alt="QR-Code zum Verbinden von WhatsApp" width={256} height={256} unoptimized /><p>WhatsApp → Einstellungen → Verknüpfte Geräte → Gerät hinzufügen.</p></div>}{!data.connection.configured && <><p>Starte den JJ-Media WhatsApp-Dienst auf Jessys Windows-Laptop. Der Laptop verbindet sich selbst mit dem Outbound Tool – ohne VPS, Tunnel, Chromium oder offene Ports.</p><details><summary>Einrichtung auf dem Laptop</summary><p>Einmal <strong>INSTALL-WHATSAPP.bat</strong> ausführen und den Outbound-Tool-Zugang bestätigen. Danach startet der Dienst automatisch mit Windows. Falls er einmal nicht läuft, genügt ein Doppelklick auf <strong>START-WHATSAPP.bat</strong>.</p></details></>}<button className={styles.secondary} disabled={Boolean(busy)} onClick={() => { setBusy("refresh"); void refresh().catch((err) => setError(err.message)).finally(() => setBusy("")); }}>Verbindung erneut prüfen</button></div>
      <div className={styles.panel}><div className={styles.toolbar}><h2>Google Kalender</h2><span className={`${styles.badge} ${data.calendar ? styles.good : ""}`}>{data.calendar ? "Verbunden" : "Freigabe erforderlich"}</span></div><p>Die KI prüft freie Zeiten und trägt einen Termin nach bestätigter Auswahl ein. Kalender und Arbeitszeiten legst du in den Terminregeln fest.</p>{data.googleConfigured ? <a className={styles.primary} href="/admin/api/gmail/connect?calendar=1">{data.calendar ? "Kalenderzugriff erneuern" : "Google Kalender verbinden"}</a> : <><p>Die Google-Anbindung muss zuerst eingerichtet werden. Anschließend kannst du hier dein Kalenderkonto freigeben.</p><details><summary>Google-Zugang einrichten</summary><p>AUTH_GOOGLE_ID und AUTH_GOOGLE_SECRET in Vercel hinterlegen. Als freigegebene Redirect-URI die Cockpit-Domain mit /admin/api/gmail/callback verwenden. Die Google Calendar API muss im Google-Projekt aktiviert sein.</p></details></>}</div>
      <div className={styles.panel}><h2>KI & Tageslauf</h2><p>Der Testchat prüft den KI-Zugang mit eurer Wissensbasis. Er funktioniert auch, während der automatische Versand pausiert ist.</p><button className={styles.secondary} onClick={() => setTab("knowledge")}>KI testen</button><dl><dt>Tageslauf</dt><dd>{config.dailyOutreachEnabled ? "Aktiviert" : "Pausiert"}</dd><dt>WhatsApp-Laptop</dt><dd>{heartbeatLive ? "Verbunden" : "Kein aktuelles Signal"}</dd><dt>Letztes Signal</dt><dd>{data.lastTick ? dateLabel(data.lastTick) : "Noch keines"}</dd></dl><p className={styles.hint}>Tageslauf und Antworten benötigen eine aktive WhatsApp-Verbindung. Die KI bleibt bei fehlendem Zugang, unklaren Angaben oder technischem Fehler stehen und zeigt die Aufgabe im Outbound Tool.</p></div>
    </div>}
  </section>;
}
