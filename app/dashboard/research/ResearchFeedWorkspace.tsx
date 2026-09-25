"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./ResearchFeedWorkspace.module.css";

type Candidate = {
  id: string;
  company: string;
  websiteUrl: string;
  phone: string;
  email: string;
  city: string;
  region: string;
  source: string;
  sourceQuery: string;
  score: number;
  reason: string;
  reviewCount: number;
  ratingX10: number;
  discoveredAt: string;
  raw?: { instagramUrl?: string; socialLinks?: string[] };
};

type Payload = {
  config: { enabled: boolean; target: number; queries: string[] };
  candidates: Candidate[];
  counts: { call_ready: number; new: number; shortlisted: number; dismissed: number; imported: number };
  status: "call_ready" | "new" | "shortlisted" | "dismissed" | "imported";
  latestRunAt: string | null;
  latestSource: string | null;
  capabilities: { googlePlaces: boolean; dailyCron: boolean };
  error?: string;
};

type SupplyPayload = {
  config: { enabled: boolean; queueTarget: number; assigneeIds: string[] };
  callers: Array<{ userId: string; name: string; email: string; role: string; queueCount: number }>;
  lastRun: {
    finishedAt: string;
    created: number;
    imported: number;
    skippedExisting: number;
    remainingPool: number;
    callers: Array<{ userId: string; name: string; before: number; added: number; after: number; target: number }>;
  } | null;
  error?: string;
};

function formatDate(value: string | null) {
  if (!value) return "Noch kein Lauf";
  const date = new Date(value);
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

export default function ResearchFeedWorkspace() {
  const [data, setData] = useState<Payload | null>(null);
  const [status, setStatus] = useState<"call_ready" | "new" | "shortlisted" | "dismissed" | "imported">("call_ready");
  const [queriesText, setQueriesText] = useState("");
  const [target, setTarget] = useState(100);
  const [enabled, setEnabled] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [supplyData, setSupplyData] = useState<SupplyPayload | null>(null);
  const [supplyEnabled, setSupplyEnabled] = useState(false);
  const [queueTarget, setQueueTarget] = useState(30);
  const [assigneeIds, setAssigneeIds] = useState<Set<string>>(new Set());

  async function load(nextStatus = status, silent = false) {
    if (!silent) setLoading(true);
    try {
      const response = await fetch("/api/research-feed?status=" + nextStatus, { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "Recherche-Feed konnte nicht geladen werden.");
      setData(payload);
      setQueriesText(payload.config.queries.join("\n"));
      setTarget(payload.config.target);
      setEnabled(payload.config.enabled);
      setSelected(new Set());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recherche-Feed konnte nicht geladen werden.");
    } finally {
      if (!silent) setLoading(false);
    }
  }

  useEffect(() => { void load(status); }, [status]);

  async function loadSupply(silent = false) {
    if (!silent) setError("");
    try {
      const response = await fetch("/api/lead-supply", { cache: "no-store" });
      const payload = await response.json() as SupplyPayload;
      if (!response.ok) throw new Error(payload.error || "Auto-Nachschub konnte nicht geladen werden.");
      setSupplyData(payload);
      setSupplyEnabled(payload.config.enabled);
      setQueueTarget(payload.config.queueTarget);
      setAssigneeIds(new Set(payload.config.assigneeIds));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Auto-Nachschub konnte nicht geladen werden.");
    }
  }

  useEffect(() => { void loadSupply(); }, []);

  const candidates = data?.candidates || [];
  const top30 = useMemo(() => candidates.slice(0, 30), [candidates]);

  function toggle(id: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else if (next.size < 30) next.add(id);
      else setError("Maximal 30 Kandidaten gleichzeitig in den Intake geben.");
      return next;
    });
  }

  function selectTop30() {
    setSelected(new Set(top30.map((item) => item.id)));
  }

  async function persistConfig() {
    const queries = queriesText.split(/\r?\n/).map((item) => item.trim()).filter(Boolean);
    const response = await fetch("/api/research-feed", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled, target, queries }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Suchprofil konnte nicht gespeichert werden.");
  }

  async function saveConfig() {
    if (busy) return;
    setBusy("save");
    setError("");
    setMessage("");
    try {
      await persistConfig();
      setMessage("Suchprofil gespeichert.");
      await load(status, true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Suchprofil konnte nicht gespeichert werden.");
    } finally {
      setBusy("");
    }
  }

  async function generateNow() {
    if (busy) return;
    setBusy("generate");
    setError("");
    setMessage("");
    try {
      await persistConfig();
      const response = await fetch("/api/research-feed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "generate" }),
      });
      const result = await response.json() as { inserted?: number; discovered?: number; duplicates?: number; callReady?: number; readyAfter?: number; source?: string; error?: string; configured?: boolean };
      if (!response.ok) throw new Error(result.error || "Recherche konnte nicht gestartet werden.");
      if (result.configured === false) throw new Error("Bitte zuerst mindestens ein Suchprofil eintragen.");
      setMessage(String(result.callReady || 0) + " neue Call-ready Leads · jetzt " + String(result.readyAfter || 0) + " / " + String(target) + " bereit · " + String(result.duplicates || 0) + " Dubletten entfernt.");
      setStatus("call_ready");
      await load("call_ready", true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Recherche fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  }

  async function changeStatus(action: "dismiss" | "restore") {
    if (!selected.size || busy) return;
    setBusy(action);
    setError("");
    try {
      const response = await fetch("/api/research-feed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, ids: [...selected] }),
      });
      const result = await response.json() as { error?: string };
      if (!response.ok) throw new Error(result.error || "Aktion fehlgeschlagen.");
      await load(status, true);
      setMessage(action === "dismiss" ? "Kandidaten verworfen." : "Kandidaten wieder in den Feed gelegt.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Aktion fehlgeschlagen.");
    } finally {
      setBusy("");
    }
  }

  function toggleAssignee(userId: string) {
    setAssigneeIds((current) => {
      const next = new Set(current);
      if (next.has(userId)) next.delete(userId);
      else next.add(userId);
      return next;
    });
  }

  async function persistSupply() {
    const response = await fetch("/api/lead-supply", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        enabled: supplyEnabled,
        queueTarget,
        assigneeIds: [...assigneeIds],
      }),
    });
    const result = await response.json() as { error?: string };
    if (!response.ok) throw new Error(result.error || "Auto-Nachschub konnte nicht gespeichert werden.");
  }

  async function saveSupply() {
    if (busy) return;
    setBusy("supply-save");
    setError("");
    setMessage("");
    try {
      await persistSupply();
      await loadSupply(true);
      setMessage("Auto-Nachschub gespeichert.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Auto-Nachschub konnte nicht gespeichert werden.");
    } finally {
      setBusy("");
    }
  }

  async function fillQueuesNow() {
    if (busy || !assigneeIds.size) return;
    setBusy("supply-run");
    setError("");
    setMessage("");
    try {
      await persistSupply();
      const response = await fetch("/api/lead-supply", { method: "POST" });
      const result = await response.json() as {
        summary?: {
          created: number;
          imported: number;
          remainingPool: number;
          callers: Array<{ name: string; before: number; added: number; after: number; target: number }>;
        };
        error?: string;
      };
      if (!response.ok || !result.summary) throw new Error(result.error || "Queues konnten nicht aufgefüllt werden.");
      const callerText = result.summary.callers
        .map((caller) => caller.name + ": +" + caller.added + " → " + caller.after + "/" + caller.target)
        .join(" · ");
      setMessage(String(result.summary.created) + " neue Call-Leads verteilt · " + callerText + " · " + String(result.summary.remainingPool) + " Call-ready im Vorrat.");
      await Promise.all([loadSupply(true), load(status, true)]);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Queues konnten nicht aufgefüllt werden.");
    } finally {
      setBusy("");
    }
  }

  async function toIntake() {
    if (!selected.size || busy) return;
    setBusy("intake");
    setError("");
    try {
      const response = await fetch("/api/research-feed", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "prepare_intake", ids: [...selected] }),
      });
      const result = await response.json() as { source?: string; raw?: unknown[]; candidateIds?: string[]; error?: string };
      if (!response.ok || !result.raw?.length) throw new Error(result.error || "Kandidaten konnten nicht vorbereitet werden.");
      sessionStorage.setItem("jj:research-intake", JSON.stringify({
        raw: result.raw,
        source: result.source || "Recherche-Feed",
        candidateIds: result.candidateIds || [...selected],
      }));
      window.location.assign("/dashboard/intake?from=research");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Intake konnte nicht geöffnet werden.");
      setBusy("");
    }
  }

  return (
    <div className={styles.root}>
      <section className={styles.configCard}>
        <div>
          <small>SUCHPROFILE</small>
          <h2>Welche Unternehmen soll der Lead Scout morgens call-ready bereitstellen?</h2>
          <p>Eine Suche pro Zeile. Der Scout findet, dedupliziert, prüft Kontaktdaten und füllt den Call-ready-Vorrat bis zum Tagesziel auf.</p>
        </div>
        <div className={styles.configFields}>
          <label>
            <span>Suchanfragen</span>
            <textarea rows={5} value={queriesText} onChange={(event) => setQueriesText(event.target.value)} placeholder={"Reisebüro Baden-Württemberg\nBoutique Hotel Baden-Württemberg\nKosmetikstudio Stuttgart\nÄsthetische Medizin Baden-Württemberg\nPremium Dienstleister Karlsruhe"} />
          </label>
          <label className={styles.target}>
            <span>Call-ready Ziel</span>
            <select value={target} onChange={(event) => setTarget(Number(event.target.value))}>
              {[20, 40, 60, 80, 100].map((value) => <option key={value} value={value}>{value} Kandidaten</option>)}
            </select>
          </label>
          <label className={styles.switch}>
            <input type="checkbox" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
            <span />
            <div><strong>Täglich automatisch</strong><small>{data?.capabilities.dailyCron ? "Cron ist technisch verfügbar." : "CRON_SECRET fehlt noch."}</small></div>
          </label>
          <div className={styles.configActions}>
            <button type="button" onClick={() => void saveConfig()} disabled={Boolean(busy)}>{busy === "save" ? "Speichert …" : "Speichern"}</button>
            <button type="button" className={styles.primary} onClick={() => void generateNow()} disabled={Boolean(busy) || !queriesText.trim()}>{busy === "generate" ? "Recherche läuft …" : "Jetzt recherchieren"}</button>
          </div>
        </div>
      </section>

      <section className={styles.supplyCard}>
        <div className={styles.supplyIntro}>
          <small>AUTO-NACHSCHUB</small>
          <h2>Wie viele offene Calls soll jeder Mitarbeiter morgens haben?</h2>
          <p>Nur Call-ready Kandidaten mit validierter Telefonnummer werden automatisch ins CRM übernommen. Rohdaten und unklare Kontakte bleiben im Lead Scout.</p>
          {supplyData?.lastRun && (
            <div className={styles.lastSupply}>
              <strong>Letzter Lauf · {formatDate(supplyData.lastRun.finishedAt)}</strong>
              <span>{supplyData.lastRun.created} neu verteilt · {supplyData.lastRun.remainingPool} im Vorrat</span>
            </div>
          )}
        </div>
        <div className={styles.supplyControls}>
          <div className={styles.supplyTop}>
            <label className={styles.target}>
              <span>Offene Calls je Mitarbeiter</span>
              <select value={queueTarget} onChange={(event) => setQueueTarget(Number(event.target.value))}>
                {[10, 20, 30, 40, 50, 60].map((value) => <option key={value} value={value}>{value} Calls</option>)}
              </select>
            </label>
            <label className={styles.switch}>
              <input type="checkbox" checked={supplyEnabled} onChange={(event) => setSupplyEnabled(event.target.checked)} />
              <span />
              <div><strong>Automatisch verteilen</strong><small>Nur ausgewählte Caller werden aufgefüllt.</small></div>
            </label>
          </div>
          <div className={styles.callers}>
            {(supplyData?.callers || []).map((caller) => (
              <button
                type="button"
                key={caller.userId}
                data-active={assigneeIds.has(caller.userId) ? "yes" : "no"}
                onClick={() => toggleAssignee(caller.userId)}
              >
                <span>{assigneeIds.has(caller.userId) ? "✓" : "+"}</span>
                <div><strong>{caller.name}</strong><small>{caller.role} · aktuell {caller.queueCount} offene Calls</small></div>
                <b>{caller.queueCount}/{queueTarget}</b>
              </button>
            ))}
            {!supplyData?.callers?.length && <p>Noch kein aktiver Vertrieb-/Setter-Zugang für automatische Call-Queues vorhanden.</p>}
          </div>
          <div className={styles.supplyActions}>
            <span>{assigneeIds.size} Mitarbeiter ausgewählt</span>
            <button type="button" onClick={() => void saveSupply()} disabled={Boolean(busy)}>{busy === "supply-save" ? "Speichert …" : "Speichern"}</button>
            <button type="button" className={styles.primary} onClick={() => void fillQueuesNow()} disabled={Boolean(busy) || !assigneeIds.size}>{busy === "supply-run" ? "Verteilt …" : "Queues jetzt auffüllen"}</button>
          </div>
        </div>
      </section>

      <section className={styles.infoBar}>
        <div><strong>Quelle</strong><span>{data?.capabilities.googlePlaces ? "Google Places + Web-Fallback" : "Web-Suche · Google Places optional"}</span></div>
        <div><strong>Letzter Fund</strong><span>{formatDate(data?.latestRunAt || null)}</span></div>
        <div><strong>Call-ready</strong><span>Nur Leads mit validierter, plausibler Telefonnummer</span></div>
        <div><strong>Auto-Verteilung</strong><span>{supplyEnabled ? assigneeIds.size + " Caller · Ziel " + queueTarget + " je Queue" : "Manuell / pausiert"}</span></div>
      </section>

      <section className={styles.feedCard}>
        <div className={styles.feedHead}>
          <div className={styles.tabs}>
            <button data-active={status === "call_ready"} onClick={() => setStatus("call_ready")}>Call-ready <b>{data?.counts.call_ready || 0}</b></button>
            <button data-active={status === "new"} onClick={() => setStatus("new")}>Prüfen <b>{data?.counts.new || 0}</b></button>
            <button data-active={status === "shortlisted"} onClick={() => setStatus("shortlisted")}>Im Intake <b>{data?.counts.shortlisted || 0}</b></button>
            <button data-active={status === "dismissed"} onClick={() => setStatus("dismissed")}>Verworfen <b>{data?.counts.dismissed || 0}</b></button>
            <button data-active={status === "imported"} onClick={() => setStatus("imported")}>Übernommen <b>{data?.counts.imported || 0}</b></button>
          </div>
          <div className={styles.bulk}>
            <span>{selected.size} ausgewählt</span>
            {(status === "call_ready" || status === "new") && <button onClick={selectTop30}>Top 30</button>}
            {(status === "call_ready" || status === "new") && <button className={styles.primary} disabled={!selected.size || Boolean(busy)} onClick={() => void toIntake()}>{busy === "intake" ? "Öffnet …" : "Im Intake prüfen"}</button>}
            {(status === "call_ready" || status === "new" || status === "shortlisted") && <button disabled={!selected.size || Boolean(busy)} onClick={() => void changeStatus("dismiss")}>Verwerfen</button>}
            {status === "shortlisted" && <button disabled={!selected.size || Boolean(busy)} onClick={() => void changeStatus("restore")}>Zurück in Neu</button>}
            {status === "dismissed" && <button disabled={!selected.size || Boolean(busy)} onClick={() => void changeStatus("restore")}>Wiederherstellen</button>}
          </div>
        </div>

        <div className={styles.tableWrap}>
          <table>
            <thead><tr><th /><th>Unternehmen</th><th>Kontakt</th><th>Score</th><th>Warum interessant</th><th>Quelle</th></tr></thead>
            <tbody>
              {!loading && candidates.map((item) => (
                <tr key={item.id}>
                  <td><input type="checkbox" checked={selected.has(item.id)} onChange={() => toggle(item.id)} /></td>
                  <td>
                    <strong>{item.company}</strong>
                    <small>{[item.city, item.region].filter(Boolean).join(", ") || "Standort aus Quelle"}</small>
                    <span className={styles.links}>
                      {item.websiteUrl && <a href={item.websiteUrl} target="_blank" rel="noreferrer">Website ↗</a>}
                      {item.raw?.instagramUrl && <a href={item.raw.instagramUrl} target="_blank" rel="noreferrer">Instagram ↗</a>}
                    </span>
                  </td>
                  <td><strong>{item.phone || item.email || "Kontakt noch offen"}</strong><small>{item.email && item.phone ? item.email : ""}</small></td>
                  <td><span className={styles.score}>{item.score}</span></td>
                  <td><strong>{item.reason}</strong><small>{item.reviewCount ? String(item.reviewCount) + " Bewertungen · " + (item.ratingX10 / 10).toFixed(1) + "★" : "Website-/Kontaktsignale bewertet"}</small></td>
                  <td><strong>{item.source === "google_places" ? "Google Places" : "Web"}</strong><small>{item.sourceQuery}</small></td>
                </tr>
              ))}
            </tbody>
          </table>
          {loading && <div className={styles.empty}>Feed wird geladen …</div>}
          {!loading && !candidates.length && <div className={styles.empty}>{status === "call_ready" ? "Noch keine Call-ready Leads. Suchprofil speichern und den Lead Scout starten." : status === "new" ? "Keine unvollständigen Kandidaten zur Prüfung." : "Dieser Bereich ist leer."}</div>}
        </div>
      </section>

      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
