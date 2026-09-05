"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import styles from "./EmailWorkspace.module.css";

type MailView = "inbox" | "unread" | "starred" | "sent" | "drafts" | "all" | "trash";
type ThreadRow = {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  internalDate: string;
  snippet: string;
  unread: boolean;
  starred: boolean;
  draft: boolean;
  sent: boolean;
  messageCount: number;
  labels: string[];
};
type MailMessage = {
  id: string;
  threadId: string;
  labels: string[];
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  messageId: string;
  references: string;
  body: string;
  snippet: string;
  internalDate: string;
};
type ThreadDetail = {
  id: string;
  subject: string;
  unread: boolean;
  starred: boolean;
  messages: MailMessage[];
};
type Profile = { emailAddress: string; messagesTotal?: number; threadsTotal?: number };
type Composer = { to: string; cc: string; bcc: string; subject: string; body: string };

const folders: Array<{ key: MailView; label: string; hint: string; glyph: string }> = [
  { key: "inbox", label: "Posteingang", hint: "Aktuelle Gespräche", glyph: "⌂" },
  { key: "unread", label: "Ungelesen", hint: "Braucht Aufmerksamkeit", glyph: "●" },
  { key: "starred", label: "Markiert", hint: "Priorisierte Threads", glyph: "★" },
  { key: "sent", label: "Gesendet", hint: "Ausgehende E-Mails", glyph: "↗" },
  { key: "drafts", label: "Entwürfe", hint: "Noch nicht versendet", glyph: "✎" },
  { key: "all", label: "Alle E-Mails", hint: "Ohne Spam & Papierkorb", glyph: "≡" },
  { key: "trash", label: "Papierkorb", hint: "Gelöschte Threads", glyph: "⌫" },
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

function displayName(value: string) {
  if (!value) return "Unbekannter Absender";
  return value.replace(/<[^>]+>/g, "").replace(/^"|"$/g, "").trim() || value;
}

function address(value: string) {
  const match = value.match(/<([^>]+@[^>]+)>/);
  if (match) return match[1].trim();
  const direct = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return direct?.[0] || value.trim();
}

function initials(value: string) {
  return displayName(value).split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "@";
}

function bodyPreview(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

export default function EmailWorkspace() {
  const [view, setView] = useState<MailView>("inbox");
  const [threads, setThreads] = useState<ThreadRow[]>([]);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [canManageMail, setCanManageMail] = useState(false);
  const [reconnectRequired, setReconnectRequired] = useState(false);
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

  const notify = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }, []);

  const loadList = useCallback(async (nextView = view, nextSearch = search, quiet = false) => {
    if (!quiet) setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ view: nextView });
      if (nextSearch.trim()) params.set("q", nextSearch.trim());
      const response = await fetch(`/api/email?${params}`, { cache: "no-store" });
      const payload = await response.json() as {
        connected?: boolean;
        canManageMail?: boolean;
        reconnectRequired?: boolean;
        threads?: ThreadRow[];
        profile?: Profile;
        error?: string;
      };
      if (!response.ok) throw new Error(payload.error || "E-Mails konnten nicht geladen werden.");
      setConnected(Boolean(payload.connected));
      setCanManageMail(Boolean(payload.canManageMail));
      setReconnectRequired(Boolean(payload.reconnectRequired));
      setThreads(payload.threads || []);
      if (payload.profile) setProfile(payload.profile);
      setSelectedIds([]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "E-Mails konnten nicht geladen werden.");
    } finally {
      if (!quiet) setLoading(false);
    }
  }, [search, view]);

  const loadThread = useCallback(async (threadId: string) => {
    setSelectedThreadId(threadId);
    setDetailLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/email?threadId=${encodeURIComponent(threadId)}`, { cache: "no-store" });
      const payload = await response.json() as { thread?: ThreadDetail; profile?: Profile; error?: string };
      if (!response.ok || !payload.thread) throw new Error(payload.error || "Thread konnte nicht geladen werden.");
      setDetail(payload.thread);
      if (payload.profile) setProfile(payload.profile);
      if (payload.thread.unread) {
        void fetch("/api/email", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "modify", threadIds: [threadId], operation: "read" }),
        }).then(() => setThreads((current) => current.map((row) => row.id === threadId ? { ...row, unread: false } : row)));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Thread konnte nicht geladen werden.");
      setDetail(null);
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => { void loadList(view, search); }, [view, search, loadList]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible" && connected && canManageMail && !busy) void loadList(view, search, true);
    }, 45_000);
    return () => window.clearInterval(timer);
  }, [busy, canManageMail, connected, loadList, search, view]);

  useEffect(() => {
    const listener = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const typing = target && ["INPUT", "TEXTAREA"].includes(target.tagName);
      if (event.key === "/" && !typing) {
        event.preventDefault();
        searchRef.current?.focus();
      }
      if (event.key.toLowerCase() === "c" && !typing && connected && canManageMail) {
        event.preventDefault();
        setComposer(emptyComposer);
        setComposerOpen(true);
      }
      if (event.key === "Escape") {
        setComposerOpen(false);
        if (window.innerWidth < 980) { setSelectedThreadId(null); setDetail(null); }
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, [canManageMail, connected]);

  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const allSelected = threads.length > 0 && threads.every((thread) => selected.has(thread.id));

  function switchView(next: MailView) {
    setView(next);
    setSearch("");
    setSearchInput("");
    setSelectedThreadId(null);
    setDetail(null);
  }

  function submitSearch(event: FormEvent) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setSelectedThreadId(null);
    setDetail(null);
  }

  async function modify(operation: string, ids = selectedIds.length ? selectedIds : selectedThreadId ? [selectedThreadId] : []) {
    if (!ids.length || busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "modify", threadIds: ids, operation }),
      });
      const payload = await response.json() as { error?: string; changed?: number };
      if (!response.ok && response.status !== 207) throw new Error(payload.error || "Aktion fehlgeschlagen.");
      const remove = ["archive", "trash", "spam"].includes(operation) && view === "inbox" || operation === "trash" && view !== "trash";
      if (remove) setThreads((current) => current.filter((row) => !ids.includes(row.id)));
      else setThreads((current) => current.map((row) => ids.includes(row.id) ? {
        ...row,
        unread: operation === "unread" ? true : operation === "read" ? false : row.unread,
        starred: operation === "star" ? true : operation === "unstar" ? false : row.starred,
      } : row));
      setSelectedIds([]);
      if (selectedThreadId && ids.includes(selectedThreadId) && remove) { setSelectedThreadId(null); setDetail(null); }
      notify(`${payload.changed ?? ids.length} Thread${ids.length === 1 ? "" : "s"} aktualisiert.`);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  function openComposer(prefill: Partial<Composer> = {}) {
    setComposer({ ...emptyComposer, ...prefill });
    setComposerOpen(true);
  }

  async function submitComposer(event: FormEvent, asDraft = false) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: asDraft ? "draft" : "send", ...composer }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || (asDraft ? "Entwurf konnte nicht gespeichert werden." : "E-Mail konnte nicht gesendet werden."));
      setComposerOpen(false);
      setComposer(emptyComposer);
      notify(asDraft ? "Entwurf in Gmail gespeichert." : "E-Mail gesendet.");
      if (view === "sent" || view === "drafts") void loadList(view, search, true);
    } catch (err) {
      notify(err instanceof Error ? err.message : "E-Mail konnte nicht verarbeitet werden.");
    } finally {
      setBusy(false);
    }
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!detail || !reply.trim() || busy) return;
    const own = profile?.emailAddress?.toLowerCase() || "";
    const lastInbound = [...detail.messages].reverse().find((message) => address(message.from).toLowerCase() !== own) || detail.messages.at(-1);
    const to = address(lastInbound?.from || "");
    if (!to) { notify("Empfänger konnte nicht erkannt werden."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/email", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "reply", threadId: detail.id, to, subject: detail.subject, body: reply.trim() }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Antwort konnte nicht gesendet werden.");
      setReply("");
      notify("Antwort gesendet.");
      await loadThread(detail.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : "Antwort konnte nicht gesendet werden.");
    } finally {
      setBusy(false);
    }
  }

  if (!loading && connected === false) {
    return (
      <section className={styles.connectCard}>
        <div className={styles.connectIcon}>@</div>
        <p className={styles.kicker}>E-Mail Workspace</p>
        <h2>Gmail direkt im Growth OS.</h2>
        <p>Posteingang lesen, antworten, neue E-Mails schreiben, Entwürfe speichern, markieren, archivieren und suchen – ohne zwischen Tools zu wechseln.</p>
        <a className={styles.primaryButton} href="/api/gmail/connect?destination=email">Gmail verbinden</a>
        <small>Die Verbindung läuft über dein eigenes Google-Konto. Zugangsdaten werden nicht im Browser gespeichert.</small>
      </section>
    );
  }

  if (!loading && connected && (!canManageMail || reconnectRequired)) {
    return (
      <section className={styles.connectCard}>
        <div className={styles.connectIcon}>↻</div>
        <p className={styles.kicker}>Berechtigung erweitern</p>
        <h2>Gmail ist verbunden, aber der Posteingang ist noch nicht freigegeben.</h2>
        <p>Die bisherige Verbindung konnte nur E-Mails senden. Für Inbox, Suche, Archiv, Markierungen und Antworten braucht das Tool einmalig die erweiterten Gmail-Rechte.</p>
        <a className={styles.primaryButton} href="/api/gmail/connect?destination=email">Gmail neu verbinden</a>
      </section>
    );
  }

  return (
    <div className={styles.emailShell}>
      <aside className={styles.mailNav}>
        <button className={styles.composeButton} type="button" onClick={() => openComposer()}><span>＋</span> Neue E-Mail</button>
        <div className={styles.accountCard}>
          <span className={styles.accountAvatar}>{profile?.emailAddress?.[0]?.toUpperCase() || "@"}</span>
          <div><strong>{profile?.emailAddress || "Gmail"}</strong><small>Live verbunden</small></div>
          <i />
        </div>
        <nav className={styles.folderList}>
          {folders.map((folder) => (
            <button key={folder.key} type="button" onClick={() => switchView(folder.key)} className={view === folder.key ? styles.folderActive : styles.folderButton}>
              <span className={styles.folderGlyph}>{folder.glyph}</span>
              <span><strong>{folder.label}</strong><small>{folder.hint}</small></span>
            </button>
          ))}
        </nav>
        <div className={styles.shortcutCard}><span>⌨</span><div><strong>Schneller arbeiten</strong><small><kbd>/</kbd> Suche · <kbd>C</kbd> neue E-Mail</small></div></div>
      </aside>

      <section className={`${styles.threadColumn} ${selectedThreadId ? styles.threadColumnHiddenMobile : ""}`}>
        <div className={styles.threadToolbar}>
          <form className={styles.searchBox} onSubmit={submitSearch}>
            <span>⌕</span>
            <input ref={searchRef} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} placeholder="E-Mails durchsuchen …  z. B. from:kunde.de" />
            {searchInput && <button type="button" onClick={() => { setSearchInput(""); setSearch(""); }}>×</button>}
          </form>
          <button className={styles.iconButton} type="button" title="Aktualisieren" onClick={() => void loadList(view, search)} disabled={loading}>↻</button>
        </div>

        <div className={styles.listHeader}>
          <label className={styles.checkWrap}><input type="checkbox" checked={allSelected} onChange={(event) => setSelectedIds(event.target.checked ? threads.map((thread) => thread.id) : [])} /><span /></label>
          <div><strong>{folders.find((folder) => folder.key === view)?.label}</strong><small>{search ? `Suche: ${search}` : loading ? "Wird synchronisiert …" : `${threads.length} Threads geladen`}</small></div>
          {selectedIds.length > 0 && <span className={styles.selectionBadge}>{selectedIds.length} ausgewählt</span>}
        </div>

        {selectedIds.length > 0 && (
          <div className={styles.bulkBar}>
            <button type="button" onClick={() => void modify("archive")}>Archiv</button>
            <button type="button" onClick={() => void modify("read")}>Gelesen</button>
            <button type="button" onClick={() => void modify("unread")}>Ungelesen</button>
            <button type="button" onClick={() => void modify("star")}>★</button>
            <button type="button" onClick={() => void modify("trash")}>Papierkorb</button>
          </div>
        )}

        <div className={styles.threadList}>
          {loading && Array.from({ length: 7 }).map((_, index) => <div className={styles.skeletonRow} key={index}><i /><span /><b /></div>)}
          {!loading && error && <div className={styles.emptyState}><strong>Postfach konnte nicht geladen werden.</strong><p>{error}</p><button type="button" onClick={() => void loadList(view, search)}>Erneut versuchen</button></div>}
          {!loading && !error && threads.length === 0 && <div className={styles.emptyState}><strong>Hier ist gerade nichts.</strong><p>{search ? "Versuche einen anderen Suchbegriff." : "Für diese Ansicht wurden keine E-Mails gefunden."}</p></div>}
          {!loading && !error && threads.map((thread) => (
            <article key={thread.id} className={`${styles.threadRow} ${thread.unread ? styles.threadUnread : ""} ${selectedThreadId === thread.id ? styles.threadActive : ""}`}>
              <label className={styles.checkWrap} onClick={(event) => event.stopPropagation()}><input type="checkbox" checked={selected.has(thread.id)} onChange={(event) => setSelectedIds((current) => event.target.checked ? [...new Set([...current, thread.id])] : current.filter((id) => id !== thread.id))} /><span /></label>
              <button className={thread.starred ? styles.starActive : styles.starButton} type="button" aria-label="Markierung umschalten" onClick={() => void modify(thread.starred ? "unstar" : "star", [thread.id])}>★</button>
              <button className={styles.threadOpen} type="button" onClick={() => void loadThread(thread.id)}>
                <span className={styles.avatar}>{initials(thread.from)}</span>
                <span className={styles.threadMain}>
                  <span className={styles.threadTop}><strong>{displayName(thread.from)}</strong><time>{dateLabel(thread.date, thread.internalDate)}</time></span>
                  <span className={styles.subjectLine}>{thread.draft && <em>Entwurf</em>}{thread.subject}{thread.messageCount > 1 && <b>{thread.messageCount}</b>}</span>
                  <span className={styles.snippet}>{thread.snippet}</span>
                </span>
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className={`${styles.detailColumn} ${selectedThreadId ? styles.detailVisibleMobile : ""}`}>
        {!selectedThreadId && <div className={styles.detailEmpty}><span>✉</span><strong>E-Mail auswählen</strong><p>Öffne einen Thread, um den gesamten Verlauf zu lesen und direkt zu antworten.</p></div>}
        {selectedThreadId && detailLoading && <div className={styles.detailLoading}><i /><i /><i /></div>}
        {selectedThreadId && !detailLoading && detail && (
          <>
            <header className={styles.detailHeader}>
              <button className={styles.backButton} type="button" onClick={() => { setSelectedThreadId(null); setDetail(null); }}>←</button>
              <div><p>E-Mail Thread</p><h2>{detail.subject}</h2><span>{detail.messages.length} Nachricht{detail.messages.length === 1 ? "" : "en"}</span></div>
              <div className={styles.detailActions}>
                <button type="button" title="Markieren" onClick={() => void modify(detail.starred ? "unstar" : "star", [detail.id])}>{detail.starred ? "★" : "☆"}</button>
                {view === "trash" ? <button type="button" title="Wiederherstellen" onClick={() => void modify("untrash", [detail.id])}>↥</button> : <button type="button" title="Archivieren" onClick={() => void modify("archive", [detail.id])}>⌄</button>}
                <button type="button" title="Papierkorb" onClick={() => void modify("trash", [detail.id])}>⌫</button>
              </div>
            </header>
            <div className={styles.messageScroll}>
              {detail.messages.map((message) => (
                <article className={styles.messageCard} key={message.id}>
                  <div className={styles.messageMeta}>
                    <span className={styles.avatar}>{initials(message.from)}</span>
                    <div><strong>{displayName(message.from)}</strong><small>an {message.to || profile?.emailAddress || "mich"}</small></div>
                    <time>{dateLabel(message.date, message.internalDate)}</time>
                  </div>
                  <pre>{message.body || message.snippet || "(kein Textinhalt)"}</pre>
                </article>
              ))}
            </div>
            <form className={styles.replyBox} onSubmit={sendReply}>
              <div className={styles.replyLabel}><span>↩</span><strong>Antworten</strong><small>an {address([...detail.messages].reverse().find((message) => address(message.from).toLowerCase() !== profile?.emailAddress?.toLowerCase())?.from || detail.messages.at(-1)?.from || "")}</small></div>
              <textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Antwort schreiben …" rows={5} />
              <div><button type="button" className={styles.secondaryButton} onClick={() => openComposer({ to: address(detail.messages[0]?.from || ""), subject: `Re: ${detail.subject}` })}>In neuem Fenster</button><button className={styles.primaryButton} type="submit" disabled={!reply.trim() || busy}>{busy ? "Wird gesendet …" : "Antwort senden"}</button></div>
            </form>
          </>
        )}
      </section>

      {composerOpen && (
        <div className={styles.composerBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) setComposerOpen(false); }}>
          <form className={styles.composer} onSubmit={(event) => void submitComposer(event, false)}>
            <header><div><p>Neue Nachricht</p><h3>E-Mail verfassen</h3></div><button type="button" onClick={() => setComposerOpen(false)}>×</button></header>
            <div className={styles.composerFields}>
              <label><span>An</span><input required type="text" value={composer.to} onChange={(event) => setComposer((current) => ({ ...current, to: event.target.value }))} placeholder="name@unternehmen.de" /></label>
              <label><span>CC</span><input type="text" value={composer.cc} onChange={(event) => setComposer((current) => ({ ...current, cc: event.target.value }))} placeholder="optional" /></label>
              <label><span>BCC</span><input type="text" value={composer.bcc} onChange={(event) => setComposer((current) => ({ ...current, bcc: event.target.value }))} placeholder="optional" /></label>
              <label><span>Betreff</span><input required value={composer.subject} onChange={(event) => setComposer((current) => ({ ...current, subject: event.target.value }))} placeholder="Worum geht es?" /></label>
              <textarea required value={composer.body} onChange={(event) => setComposer((current) => ({ ...current, body: event.target.value }))} placeholder="Nachricht schreiben …" />
            </div>
            <footer><button className={styles.secondaryButton} type="button" disabled={busy || !composer.to || !composer.subject || !composer.body} onClick={(event) => void submitComposer(event as unknown as FormEvent, true)}>Als Entwurf speichern</button><button className={styles.primaryButton} type="submit" disabled={busy}>{busy ? "Wird gesendet …" : "Senden →"}</button></footer>
          </form>
        </div>
      )}
      {toast && <div className={styles.toast}>{toast}</div>}
    </div>
  );
}
