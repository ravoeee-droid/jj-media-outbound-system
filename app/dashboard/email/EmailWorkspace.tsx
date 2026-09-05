"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./EmailWorkspace.module.css";

type MailView = "inbox" | "unread" | "starred" | "sent" | "drafts" | "all" | "trash";
type ThreadRow = { id: string; from: string; to: string; subject: string; date: string; internalDate: string; snippet: string; unread: boolean; starred: boolean; draft: boolean; sent: boolean; messageCount: number; labels: string[] };
type MailMessage = { id: string; threadId: string; labels: string[]; from: string; to: string; cc: string; subject: string; date: string; messageId: string; references: string; body: string; snippet: string; internalDate: string };
type ThreadDetail = { id: string; subject: string; unread: boolean; starred: boolean; messages: MailMessage[] };
type Profile = { emailAddress: string };
type Composer = { to: string; cc: string; bcc: string; subject: string; body: string };

const folders: Array<{ key: MailView; label: string; hint: string; glyph: string }> = [
  { key: "inbox", label: "Posteingang", hint: "Aktuelle Gespräche", glyph: "⌂" },
  { key: "unread", label: "Ungelesen", hint: "Braucht Aufmerksamkeit", glyph: "●" },
  { key: "starred", label: "Markiert", hint: "Priorisierte Mails", glyph: "★" },
  { key: "sent", label: "Gesendet", hint: "Ausgehende E-Mails", glyph: "↗" },
  { key: "drafts", label: "Entwürfe", hint: "Noch nicht versendet", glyph: "✎" },
  { key: "all", label: "Alle E-Mails", hint: "Gesamtes Postfach", glyph: "≡" },
  { key: "trash", label: "Papierkorb", hint: "Gelöschte E-Mails", glyph: "⌫" },
];
const emptyComposer: Composer = { to: "", cc: "", bcc: "", subject: "", body: "" };

function dateLabel(value: string, internalDate: string) {
  const date = internalDate ? new Date(Number(internalDate)) : new Date(value);
  if (Number.isNaN(date.getTime())) return value || "—";
  const today = new Date();
  if (date.toDateString() === today.toDateString()) return date.toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
  if (date.getFullYear() === today.getFullYear()) return date.toLocaleDateString("de-DE", { day: "2-digit", month: "short" });
  return date.toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "2-digit" });
}
function displayName(value: string) { return value.replace(/<[^>]+>/g, "").replace(/^"|"$/g, "").trim() || value || "Unbekannt"; }
function address(value: string) { return value.match(/<([^>]+@[^>]+)>/)?.[1]?.trim() || value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0] || ""; }
function initials(value: string) { return displayName(value).split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "@"; }

export default function EmailWorkspace() {
  const [view, setView] = useState<MailView>("inbox");
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedThreadId, setSelectedThreadId] = useState<string | null>(null);
  const [detail, setDetail] = useState<ThreadDetail | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [composerOpen, setComposerOpen] = useState(false);
  const [composer, setComposer] = useState<Composer>(emptyComposer);
  const [reply, setReply] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  const notify = useCallback((message: string) => { setToast(message); window.setTimeout(() => setToast(""), 2600); }, []);

  const loadList = useCallback(async (nextView: MailView, nextSearch: string, quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ view: nextView });
      if (nextSearch.trim()) params.set("q", nextSearch.trim());
      const response = await fetch(`/api/email?${params}`, { cache: "no-store" });
      const payload = await response.json() as { connected?: boolean; threads?: ThreadRow[]; profile?: Profile; error?: string };
      if (!response.ok) throw new Error(payload.error || "STRATO Postfach konnte nicht geladen werden.");
      setConnected(Boolean(payload.connected));
      setThreads(payload.threads || []);
      setProfile(payload.profile || null);
      setSelectedIds([]);
    } catch (err) { setError(err instanceof Error ? err.message : "STRATO Postfach konnte nicht geladen werden."); }
    finally { if (!quiet) setLoading(false); }
  }, []);

  const loadThread = useCallback(async (threadId: string) => {
    setSelectedThreadId(threadId); setDetailLoading(true); setError("");
    try {
      const response = await fetch(`/api/email?threadId=${encodeURIComponent(threadId)}`, { cache: "no-store" });
      const payload = await response.json() as { thread?: ThreadDetail; profile?: Profile; error?: string };
      if (!response.ok || !payload.thread) throw new Error(payload.error || "E-Mail konnte nicht geladen werden.");
      setDetail(payload.thread); if (payload.profile) setProfile(payload.profile);
      if (payload.thread.unread) {
        void fetch("/api/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "modify", threadIds: [threadId], operation: "read" }) })
          .then(() => setThreads((current) => current.map((row) => row.id === threadId ? { ...row, unread: false } : row)));
      }
    } catch (err) { setError(err instanceof Error ? err.message : "E-Mail konnte nicht geladen werden."); setDetail(null); }
    finally { setDetailLoading(false); }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void loadList(view, search), 0); return () => window.clearTimeout(timer); }, [loadList, search, view]);
  useEffect(() => {
    const timer = window.setInterval(() => { if (document.visibilityState === "visible" && connected && !busy) void loadList(view, search, true); }, 60_000);
    return () => window.clearInterval(timer);
  }, [busy, connected, loadList, search, view]);
  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA"].includes(target.tagName);
      if (event.key === "/" && !typing) { event.preventDefault(); searchRef.current?.focus(); }
      if (event.key.toLowerCase() === "c" && !typing && connected) { event.preventDefault(); setComposer(emptyComposer); setComposerOpen(true); }
      if (event.key === "Escape") setComposerOpen(false);
    };
    window.addEventListener("keydown", listener); return () => window.removeEventListener("keydown", listener);
  }, [connected]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = threads.length > 0 && threads.every((thread) => selected.has(thread.id));

  async function modify(operation: string, ids = selectedIds.length ? selectedIds : selectedThreadId ? [selectedThreadId] : []) {
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "modify", threadIds: ids, operation }) });
      const payload = await response.json() as { error?: string; changed?: number };
      if (!response.ok) throw new Error(payload.error || "Aktion fehlgeschlagen.");
      const remove = ["archive", "trash", "spam"].includes(operation) || operation === "untrash";
      if (remove) setThreads((current) => current.filter((row) => !ids.includes(row.id)));
      else setThreads((current) => current.map((row) => ids.includes(row.id) ? { ...row, unread: operation === "unread" ? true : operation === "read" ? false : row.unread, starred: operation === "star" ? true : operation === "unstar" ? false : row.starred } : row));
      if (selectedThreadId && ids.includes(selectedThreadId) && remove) { setSelectedThreadId(null); setDetail(null); }
      setSelectedIds([]); notify(`${payload.changed ?? ids.length} E-Mail${ids.length === 1 ? "" : "s"} aktualisiert.`);
    } catch (err) { notify(err instanceof Error ? err.message : "Aktion fehlgeschlagen."); }
    finally { setBusy(false); }
  }

  async function submitComposer(event: FormEvent, asDraft = false) {
    event.preventDefault(); if (busy) return; setBusy(true);
    try {
      const response = await fetch("/api/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: asDraft ? "draft" : "send", ...composer }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "E-Mail konnte nicht verarbeitet werden.");
      setComposerOpen(false); setComposer(emptyComposer); notify(asDraft ? "Entwurf bei STRATO gespeichert." : "E-Mail über STRATO gesendet.");
      if (view === "sent" || view === "drafts") void loadList(view, search, true);
    } catch (err) { notify(err instanceof Error ? err.message : "E-Mail konnte nicht verarbeitet werden."); }
    finally { setBusy(false); }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault(); if (!detail || !reply.trim() || busy) return;
    const own = profile?.emailAddress?.toLowerCase() || "";
    const inbound = [...detail.messages].reverse().find((message) => address(message.from).toLowerCase() !== own) || detail.messages.at(-1);
    const to = address(inbound?.from || "");
    if (!to) { notify("Empfänger konnte nicht erkannt werden."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/email", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "reply", threadId: detail.id, to, subject: detail.subject, body: reply.trim() }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Antwort konnte nicht gesendet werden.");
      setReply(""); notify("Antwort über STRATO gesendet.");
    } catch (err) { notify(err instanceof Error ? err.message : "Antwort konnte nicht gesendet werden."); }
    finally { setBusy(false); }
  }

  if (!loading && connected === false) return (
    <section className={styles.connectCard}>
      <div className={styles.connectIcon}>@</div><p className={styles.kicker}>STRATO Mail</p><h2>Dein STRATO-Postfach direkt im Growth OS.</h2>
      <p>Für den Live-Zugriff fehlen nur die serverseitigen Zugangsdaten. Danach funktionieren Posteingang, Suche, Antworten, Senden, Entwürfe, Markierungen und Ordner direkt hier.</p>
      <div className={styles.shortcutCard}><span>✓</span><div><strong>Server sind bereits vorkonfiguriert</strong><small>IMAP 993 · SMTP 465 · SSL/TLS</small></div></div>
      <small>In Vercel einmal <strong>STRATO_MAIL_EMAIL</strong> und <strong>STRATO_MAIL_PASSWORD</strong> hinterlegen. Das Passwort gehört nicht in den Browser oder in GitHub.</small>
    </section>
  );

  return (
    <div className={styles.emailShell}>
      <aside className={styles.mailNav}>
        <button className={styles.composeButton} type="button" onClick={() => { setComposer(emptyComposer); setComposerOpen(true); }}><span>＋</span> Neue E-Mail</button>
        <div className={styles.accountCard}><span className={styles.accountAvatar}>{profile?.emailAddress?.[0]?.toUpperCase() || "@"}</span><div><strong>{profile?.emailAddress || "STRATO Mail"}</strong><small>IMAP + SMTP · Live</small></div><i /></div>
        <nav className={styles.folderList}>{folders.map((folder) => <button key={folder.key} type="button" onClick={() => { setView(folder.key); setSearch(""); setSearchInput(""); setSelectedThreadId(null); setDetail(null); }} className={view === folder.key ? styles.folderActive : styles.folderButton}><span className={styles.folderGlyph}>{folder.glyph}</span><span><strong>{folder.label}</strong><small>{folder.hint}</small></span></button>)}</nav>
        <div className={styles.shortcutCard}><span>⌨</span><div><strong>Schneller arbeiten</strong><small><kbd>/</kbd> Suche · <kbd>C</kbd> neue E-Mail</small></div></div>
      </aside>

      <section className={`${styles.threadColumn} ${selectedThreadId ? styles.threadColumnHiddenMobile : ""}`}>
        <div className={styles.threadToolbar}><form className={styles.searchBox} onSubmit={(event) => { event.preventDefault(); setSearch(searchInput.trim()); setSelectedThreadId(null); setDetail(null); }}><span>⌕</span><input ref={searchRef} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="STRATO Mail durchsuchen …  z. B. from:kunde.de" />{searchInput && <button type="button" onClick={() => { setSearchInput(""); setSearch(""); }}>×</button>}</form><button className={styles.iconButton} type="button" title="Aktualisieren" onClick={() => void loadList(view, search)}>↻</button></div>
        <div className={styles.listHeader}><label className={styles.checkWrap}><input type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? threads.map((thread) => thread.id) : [])} /><span /></label><div><strong>{folders.find((folder) => folder.key === view)?.label}</strong><small>{loading ? "Synchronisiert mit STRATO …" : `${threads.length} E-Mails geladen`}</small></div>{selectedIds.length > 0 && <span className={styles.selectionBadge}>{selectedIds.length} ausgewählt</span>}</div>
        {selectedIds.length > 0 && <div className={styles.bulkBar}><button type="button" onClick={() => void modify("archive")}>Archiv</button><button type="button" onClick={() => void modify("read")}>Gelesen</button><button type="button" onClick={() => void modify("unread")}>Ungelesen</button><button type="button" onClick={() => void modify("star")}>★</button><button type="button" onClick={() => void modify("trash")}>Papierkorb</button></div>}
        <div className={styles.threadList}>
          {loading && Array.from({ length: 7 }).map((_, index) => <div className={styles.skeletonRow} key={index}><i /><span /><b /></div>)}
          {!loading && error && <div className={styles.emptyState}><strong>STRATO Postfach konnte nicht geladen werden.</strong><p>{error}</p><button type="button" onClick={() => void loadList(view, search)}>Erneut versuchen</button></div>}
          {!loading && !error && threads.length === 0 && <div className={styles.emptyState}><strong>Hier ist gerade nichts.</strong><p>{search ? "Versuche einen anderen Suchbegriff." : "Für diese Ansicht wurden keine E-Mails gefunden."}</p></div>}
          {!loading && !error && threads.map((thread) => <article key={thread.id} className={`${styles.threadRow} ${thread.unread ? styles.threadUnread : ""} ${selectedThreadId === thread.id ? styles.threadActive : ""}`}><label className={styles.checkWrap} onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(thread.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, thread.id])] : current.filter((id) => id !== thread.id))} /><span /></label><button className={thread.starred ? styles.starActive : styles.starButton} type="button" onClick={() => void modify(thread.starred ? "unstar" : "star", [thread.id])}>★</button><button className={styles.threadOpen} type="button" onClick={() => void loadThread(thread.id)}><span className={styles.avatar}>{initials(thread.from)}</span><span className={styles.threadMain}><span className={styles.threadTop}><strong>{displayName(thread.from)}</strong><time>{dateLabel(thread.date, thread.internalDate)}</time></span><span className={styles.subjectLine}>{thread.draft && <em>Entwurf</em>}{thread.subject}</span><span className={styles.snippet}>{thread.snippet || "STRATO Mail"}</span></span></button></article>)}
        </div>
      </section>

      <section className={`${styles.detailColumn} ${selectedThreadId ? styles.detailVisibleMobile : ""}`}>
        {!selectedThreadId && <div className={styles.detailEmpty}><span>✉</span><strong>E-Mail auswählen</strong><p>Öffne eine E-Mail, um sie vollständig zu lesen und direkt zu antworten.</p></div>}
        {selectedThreadId && detailLoading && <div className={styles.detailLoading}><i /><i /><i /></div>}
        {selectedThreadId && !detailLoading && detail && <><header className={styles.detailHeader}><button className={styles.backButton} type="button" onClick={() => { setSelectedThreadId(null); setDetail(null); }}>←</button><div><p>STRATO Mail</p><h2>{detail.subject}</h2><span>{detail.messages.length} Nachricht</span></div><div className={styles.detailActions}><button type="button" onClick={() => void modify(detail.starred ? "unstar" : "star", [detail.id])}>{detail.starred ? "★" : "☆"}</button>{view === "trash" ? <button type="button" onClick={() => void modify("untrash", [detail.id])}>↥</button> : <button type="button" onClick={() => void modify("archive", [detail.id])}>⌄</button>}<button type="button" onClick={() => void modify("trash", [detail.id])}>⌫</button></div></header><div className={styles.messageScroll}>{detail.messages.map((message) => <article className={styles.messageCard} key={message.id}><div className={styles.messageMeta}><span className={styles.avatar}>{initials(message.from)}</span><div><strong>{displayName(message.from)}</strong><small>an {message.to || profile?.emailAddress || "mich"}</small></div><time>{dateLabel(message.date, message.internalDate)}</time></div><pre>{message.body || "(kein Textinhalt)"}</pre></article>)}</div><form className={styles.replyBox} onSubmit={sendReply}><div className={styles.replyLabel}><span>↩</span><strong>Antworten</strong></div><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Antwort schreiben …" rows={5} /><div><button className={styles.primaryButton} type="submit" disabled={!reply.trim() || busy}>{busy ? "Wird gesendet …" : "Antwort über STRATO senden"}</button></div></form></>}
      </section>

      {composerOpen && <div className={styles.composerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}><form className={styles.composer} onSubmit={(event) => void submitComposer(event, false)}><header><div><p>STRATO Mail</p><h3>Neue E-Mail</h3></div><button type="button" onClick={() => setComposerOpen(false)}>×</button></header><div className={styles.composerFields}><label><span>An</span><input required value={composer.to} onChange={(event) => setComposer((current) => ({ ...current, to: event.target.value }))} placeholder="name@unternehmen.de" /></label><label><span>CC</span><input value={composer.cc} onChange={(event) => setComposer((current) => ({ ...current, cc: event.target.value }))} /></label><label><span>BCC</span><input value={composer.bcc} onChange={(event) => setComposer((current) => ({ ...current, bcc: event.target.value }))} /></label><label><span>Betreff</span><input required value={composer.subject} onChange={(event) => setComposer((current) => ({ ...current, subject: event.target.value }))} /></label><textarea required value={composer.body} onChange={(event) => setComposer((current) => ({ ...current, body: event.target.value }))} placeholder="Nachricht schreiben …" /></div><footer><button className={styles.secondaryButton} type="button" disabled={busy || !composer.to || !composer.subject || !composer.body} onClick={(event) => void submitComposer(event as unknown as FormEvent, true)}>Als Entwurf speichern</button><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Wird gesendet …" : "Senden →"}</button></footer></form></div>}
      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}
