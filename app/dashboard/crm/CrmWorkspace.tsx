"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import LeadCrmPanel from "@/app/components/LeadCrmPanel";
import styles from "./CrmWorkspace.module.css";

type CrmLead = {
  id: string;
  company: string;
  contact: string;
  email: string;
  phone: string;
  instagramUrl: string;
  websiteUrl: string;
  city: string;
  region: string;
  pipelineStage: string;
  researchStatus: string;
  validationStatus: string;
  callStatus: string;
  emailStatus: string;
  whatsappStatus: string;
  nextAction: string;
  nextActionAt: string | null;
  contactLocked: boolean;
  videoStatus: string;
  watchPercent: number;
  salesPriority: number;
  ownerId: string | null;
  ownerName: string | null;
  updatedAt: string;
};

type MemberTab = { userId: string; name: string; role: string; count: number };
type CrmPayload = {
  leads: CrmLead[];
  page: { hasMore: boolean; nextCursor: string | null; limit: number };
  scope: string;
  query: string;
  currentUser: { id: string; name: string | null; email: string | null; role: string };
  permissions: { canViewAll: boolean; canManageLeads: boolean; canGenerateVideo: boolean };
  tabs: { total: number; unassigned: number; members: MemberTab[] };
  error?: string;
};

type BulkOperation = "assign_owner" | "enrich" | "validate" | "analyze" | "prepare_media";
type BulkDecision = { leadId: string; company: string; eligible: boolean; reason: string };
type BulkPreview = {
  operation: BulkOperation;
  label: string;
  selected: number;
  eligible: number;
  skipped: number;
  decisions: BulkDecision[];
  execution: { chunkSize: number; heavy: boolean };
  error?: string;
};

const stageLabel: Record<string, string> = {
  new: "Neu",
  qualified: "Qualifiziert",
  contact_ready: "Kontaktbereit",
  contacted: "Kontaktiert",
  replied: "Reagiert",
  call_booked: "Termin",
  won: "Gewonnen",
  lost: "Verloren",
};

const actionLabel: Record<string, string> = {
  review: "Prüfen",
  enrich: "Enrichen",
  validate: "Validieren",
  analyze: "Analysieren",
  screenshot: "Screenshot",
  call: "Anrufen",
  callback: "Rückruf",
  send_info: "Info senden",
  whatsapp: "WhatsApp",
  follow_up: "Follow-up",
  meeting: "Termin",
  none: "Erledigt",
};

function formatDate(value: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function initials(value: string) {
  const parts = value.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : value.slice(0, 2)).toUpperCase();
}

function channelState(value: string) {
  if (["sent", "replied", "active", "ready", "opened"].includes(value)) return "ready";
  if (["stopped", "failed"].includes(value)) return "stopped";
  return "idle";
}

function chunks<T>(items: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < items.length; index += size) result.push(items.slice(index, index + size));
  return result;
}

export default function CrmWorkspace() {
  const [activeScope, setActiveScope] = useState("mine");
  const [query, setQuery] = useState("");
  const [viewMode, setViewMode] = useState<"table" | "kanban">("table");
  const [fontScale, setFontScale] = useState(1.15);
  const [focusView, setFocusView] = useState<"all" | "today" | "hot" | "overdue" | "no_next">("all");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [data, setData] = useState<CrmPayload | null>(null);
  const [leads, setLeads] = useState<CrmLead[]>([]);
  const [page, setPage] = useState<CrmPayload["page"] | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [savingOwnerId, setSavingOwnerId] = useState<string | null>(null);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkPreview, setBulkPreview] = useState<BulkPreview | null>(null);
  const [bulkOwnerChoice, setBulkOwnerChoice] = useState("__choose__");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [bulkProgress, setBulkProgress] = useState({ done: 0, total: 0, succeeded: 0, failed: 0 });
  const requestRef = useRef<AbortController | null>(null);
  const requestSequence = useRef(0);
  const cacheRef = useRef(new Map<string, { data: CrmPayload; leads: CrmLead[]; page: CrmPayload["page"] }>());

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedQuery(query.trim()), 220);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const saved = Number(window.localStorage.getItem("crm-font-scale"));
    if (Number.isFinite(saved) && saved >= 1 && saved <= 1.6) setFontScale(saved);
  }, []);

  useEffect(() => {
    window.localStorage.setItem("crm-font-scale", String(fontScale));
  }, [fontScale]);

  useEffect(() => {
    const saved = window.localStorage.getItem("crm-focus-view");
    if (saved && ["all", "today", "hot", "overdue", "no_next"].includes(saved)) {
      setFocusView(saved as "all" | "today" | "hot" | "overdue" | "no_next");
    }
  }, []);

  useEffect(() => {
    window.localStorage.setItem("crm-focus-view", focusView);
  }, [focusView]);

  const fetchLeads = useCallback(async ({
    scope,
    search,
    cursor,
    append = false,
    silent = false,
  }: {
    scope: string;
    search: string;
    cursor?: string | null;
    append?: boolean;
    silent?: boolean;
  }) => {
    const sequence = ++requestSequence.current;
    if (!append) requestRef.current?.abort();
    const controller = new AbortController();
    if (!append) requestRef.current = controller;

    if (!silent) append ? setLoadingMore(true) : setLoading(true);
    setError("");
    setNotice("");

    const params = new URLSearchParams({ scope });
    if (search.length >= 2) params.set("q", search);
    if (cursor) params.set("cursor", cursor);

    try {
      const response = await fetch(`/api/crm?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const payload = await response.json() as CrmPayload;
      if (!response.ok) throw new Error(payload.error || "CRM konnte nicht geladen werden.");
      if (sequence !== requestSequence.current && !append) return;

      setData(payload);
      setPage(payload.page);
      setLeads((current) => append ? [...current, ...payload.leads] : payload.leads);

      if (!search && !append) {
        cacheRef.current.set(scope, { data: payload, leads: payload.leads, page: payload.page });
      }
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "AbortError") return;
      setError(caught instanceof Error ? caught.message : "CRM konnte nicht geladen werden.");
    } finally {
      if (!silent) append ? setLoadingMore(false) : setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!debouncedQuery) {
      const cached = cacheRef.current.get(activeScope);
      if (cached) {
        setData(cached.data);
        setLeads(cached.leads);
        setPage(cached.page);
        setLoading(false);
        void fetchLeads({ scope: activeScope, search: "", silent: true });
        return;
      }
    }
    void fetchLeads({ scope: activeScope, search: debouncedQuery });
  }, [activeScope, debouncedQuery, fetchLeads]);

  useEffect(() => {
    setSelectedIds(new Set());
    setBulkPreview(null);
    setBulkOwnerChoice("__choose__");
  }, [activeScope, debouncedQuery]);

  useEffect(() => () => requestRef.current?.abort(), []);

  const tabs = useMemo(() => {
    if (!data) return [{ key: "mine", label: "Mein CRM", count: 0 }];
    const mine = data.tabs.members.find((member) => member.userId === data.currentUser.id);
    const items: Array<{ key: string; label: string; count: number }> = [
      { key: "mine", label: "Mein CRM", count: mine?.count ?? 0 },
    ];
    if (data.permissions.canViewAll) {
      for (const member of data.tabs.members) {
        if (member.userId === data.currentUser.id) continue;
        items.push({ key: member.userId, label: member.name, count: member.count });
      }
      items.push({ key: "unassigned", label: "Unzugeordnet", count: data.tabs.unassigned });
      items.push({ key: "all", label: "Alle Leads", count: data.tabs.total });
    }
    return items;
  }, [data]);

  const visibleLeads = useMemo(() => {
    const now = Date.now();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    return leads.filter((lead) => {
      const due = lead.nextActionAt ? Date.parse(lead.nextActionAt) : Number.NaN;
      if (focusView === "today") return Number.isFinite(due) && due >= start.getTime() && due <= end.getTime() && !lead.contactLocked;
      if (focusView === "hot") return lead.salesPriority >= 75 && !["won", "lost"].includes(lead.pipelineStage) && !lead.contactLocked;
      if (focusView === "overdue") return Number.isFinite(due) && due < now && !["won", "lost"].includes(lead.pipelineStage) && !lead.contactLocked;
      if (focusView === "no_next") return (!lead.nextActionAt || lead.nextAction === "none") && !["won", "lost"].includes(lead.pipelineStage) && !lead.contactLocked;
      return true;
    });
  }, [leads, focusView]);

  const performanceStats = useMemo(() => {
    const now = Date.now();
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const end = new Date(); end.setHours(23, 59, 59, 999);
    return {
      hot: leads.filter((lead) => lead.salesPriority >= 75 && !["won", "lost"].includes(lead.pipelineStage) && !lead.contactLocked).length,
      overdue: leads.filter((lead) => lead.nextActionAt && Date.parse(lead.nextActionAt) < now && !["won", "lost"].includes(lead.pipelineStage) && !lead.contactLocked).length,
      today: leads.filter((lead) => lead.nextActionAt && Date.parse(lead.nextActionAt) >= start.getTime() && Date.parse(lead.nextActionAt) <= end.getTime() && !lead.contactLocked).length,
      noNext: leads.filter((lead) => (!lead.nextActionAt || lead.nextAction === "none") && !["won", "lost"].includes(lead.pipelineStage) && !lead.contactLocked).length,
    };
  }, [leads]);

  const selectedList = useMemo(() => [...selectedIds], [selectedIds]);
  const selectableVisibleIds = useMemo(() => visibleLeads.map((lead) => lead.id).slice(0, 30), [visibleLeads]);
  const allVisibleSelected = selectableVisibleIds.length > 0 && selectableVisibleIds.every((id) => selectedIds.has(id));

  async function changeOwner(lead: CrmLead, ownerId: string) {
    if (!data?.permissions.canManageLeads || !data.permissions.canViewAll || savingOwnerId) return;
    setSavingOwnerId(lead.id);
    try {
      const response = await fetch("/api/crm", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: lead.id, ownerId: ownerId || null }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Zuweisung konnte nicht gespeichert werden.");
      cacheRef.current.clear();
      await fetchLeads({ scope: activeScope, search: debouncedQuery, silent: true });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Zuweisung konnte nicht gespeichert werden.");
    } finally {
      setSavingOwnerId(null);
    }
  }

  function handleUpdated(updated: Record<string, unknown>) {
    setLeads((current) => current.map((lead) => lead.id === updated.id ? {
      ...lead,
      pipelineStage: String(updated.pipelineStage ?? lead.pipelineStage),
      contact: String(updated.contact ?? lead.contact),
      email: String(updated.email ?? lead.email),
      phone: String(updated.phone ?? lead.phone),
      ownerId: updated.ownerId === null ? null : String(updated.ownerId ?? lead.ownerId ?? "") || null,
      updatedAt: String(updated.updatedAt ?? lead.updatedAt),
    } : lead));
    cacheRef.current.clear();
  }

  function toggleLeadSelection(leadId: string) {
    if (bulkBusy) return;
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(leadId)) {
        next.delete(leadId);
        return next;
      }
      if (next.size >= 30) {
        setError("Im Power-Modus können maximal 30 Leads gleichzeitig ausgewählt werden.");
        return current;
      }
      next.add(leadId);
      return next;
    });
    setBulkPreview(null);
  }

  function toggleVisibleSelection() {
    if (bulkBusy) return;
    if (allVisibleSelected) {
      setSelectedIds((current) => {
        const next = new Set(current);
        for (const id of selectableVisibleIds) next.delete(id);
        return next;
      });
    } else {
      setSelectedIds(new Set(selectableVisibleIds));
    }
    setBulkPreview(null);
  }

  function bulkOwnerId() {
    if (bulkOwnerChoice === "__unassigned__") return null;
    if (bulkOwnerChoice === "__choose__") return undefined;
    return bulkOwnerChoice;
  }

  async function previewBulk(operation: BulkOperation) {
    if (!selectedList.length || bulkBusy) return;
    const ownerId = operation === "assign_owner" ? bulkOwnerId() : undefined;
    if (operation === "assign_owner" && ownerId === undefined) {
      setError("Bitte zuerst einen Mitarbeiter oder „Unzugeordnet“ auswählen.");
      return;
    }
    setBulkBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/crm/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "preview", operation, leadIds: selectedList, ...(operation === "assign_owner" ? { ownerId } : {}) }),
      });
      const payload = await response.json() as BulkPreview;
      if (!response.ok) throw new Error(payload.error || "Vorprüfung fehlgeschlagen.");
      setBulkPreview(payload);
      setBulkProgress({ done: 0, total: payload.eligible, succeeded: 0, failed: 0 });
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Vorprüfung fehlgeschlagen.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function executeBulk() {
    if (!bulkPreview || bulkBusy) return;
    const eligibleIds = bulkPreview.decisions.filter((item) => item.eligible).map((item) => item.leadId);
    if (!eligibleIds.length) return;

    const ownerId = bulkPreview.operation === "assign_owner" ? bulkOwnerId() : undefined;
    const groups = chunks(eligibleIds, Math.max(1, bulkPreview.execution.chunkSize));
    let succeeded = 0;
    let failed = 0;
    let done = 0;

    setBulkBusy(true);
    setBulkProgress({ done: 0, total: eligibleIds.length, succeeded: 0, failed: 0 });
    setError("");
    setNotice("");

    try {
      if (bulkPreview.operation === "prepare_media") {
        // Browser captures are deliberately serialized. Each request owns one browser
        // session, so we never fan out Chromium instances and overload the runtime.
        for (const leadId of eligibleIds) {
          const response = await fetch(`/api/leads/${leadId}/capture-profile`, { method: "POST" });
          const result = await response.json() as { error?: string };
          if (response.ok) succeeded += 1;
          else failed += 1;
          done += 1;
          setBulkProgress({ done, total: eligibleIds.length, succeeded, failed });

          if (!response.ok && result.error) {
            setError(`Screenshot bei einem Lead fehlgeschlagen: ${result.error}`);
          }
        }
      } else {
        for (const leadIds of groups) {
          const response = await fetch("/api/crm/bulk", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              mode: "execute",
              operation: bulkPreview.operation,
              leadIds,
              ...(bulkPreview.operation === "assign_owner" ? { ownerId } : {}),
            }),
          });
          const result = await response.json() as {
            succeeded?: number;
            failed?: number;
            error?: string;
          };
          if (!response.ok) {
            failed += leadIds.length;
            done += leadIds.length;
            setBulkProgress({ done, total: eligibleIds.length, succeeded, failed });
            throw new Error(result.error || "Bulk-Aktion wurde unterbrochen.");
          }
          succeeded += Number(result.succeeded || 0);
          failed += Number(result.failed || 0);
          done += leadIds.length;
          setBulkProgress({ done, total: eligibleIds.length, succeeded, failed });
        }
      }

      cacheRef.current.clear();
      await fetchLeads({ scope: activeScope, search: debouncedQuery, silent: true });
      setSelectedIds(new Set());
      setBulkPreview(null);
      setBulkOwnerChoice("__choose__");
      if (failed) setError(`Power-Modus beendet: ${succeeded} erfolgreich, ${failed} fehlgeschlagen.`);
      else setNotice(`Power-Modus beendet: ${succeeded} Leads erfolgreich verarbeitet.`);
    } catch (caught) {
      cacheRef.current.clear();
      await fetchLeads({ scope: activeScope, search: debouncedQuery, silent: true }).catch(() => undefined);
      setError(caught instanceof Error ? caught.message : "Bulk-Aktion wurde unterbrochen.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function loadMore() {
    if (!page?.hasMore || !page.nextCursor || loadingMore) return;
    await fetchLeads({ scope: activeScope, search: debouncedQuery, cursor: page.nextCursor, append: true });
  }

  const ownerOptions = data?.tabs.members || [];
  const kanbanStages = [
    "new",
    "qualified",
    "contact_ready",
    "contacted",
    "replied",
    "call_booked",
    "won",
    "lost",
  ] as const;

  async function moveLeadStage(lead: CrmLead, pipelineStage: string) {
    if (!data?.permissions.canManageLeads || lead.pipelineStage === pipelineStage) return;
    const previous = lead.pipelineStage;
    setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, pipelineStage } : item));
    try {
      const response = await fetch("/api/crm", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: lead.id, pipelineStage }),
      });
      const payload = await response.json() as { lead?: Record<string, unknown>; error?: string };
      if (!response.ok || !payload.lead) throw new Error(payload.error || "Status konnte nicht gespeichert werden.");
      handleUpdated(payload.lead);
      setNotice(`${lead.company} → ${stageLabel[pipelineStage] || pipelineStage}`);
    } catch (caught) {
      setLeads((current) => current.map((item) => item.id === lead.id ? { ...item, pipelineStage: previous } : item));
      setError(caught instanceof Error ? caught.message : "Status konnte nicht gespeichert werden.");
    }
  }

  return (
    <div className={styles.root} style={{ "--crm-font-scale": fontScale } as CSSProperties}>
      <section className={styles.toolbar}>
        <div className={styles.tabs} role="tablist" aria-label="CRM Bereiche">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              type="button"
              role="tab"
              aria-selected={activeScope === tab.key}
              className={activeScope === tab.key ? styles.tabActive : styles.tab}
              onClick={() => setActiveScope(tab.key)}
            >
              <span>{tab.label}</span><strong>{tab.count}</strong>
            </button>
          ))}
        </div>
        <div className={styles.viewToggle} aria-label="CRM Ansicht">
          <button type="button" className={viewMode === "table" ? styles.viewActive : ""} onClick={() => setViewMode("table")}>☷ Liste</button>
          <button type="button" className={viewMode === "kanban" ? styles.viewActive : ""} onClick={() => setViewMode("kanban")}>▥ Kanban</button>
        </div>
        <div className={styles.fontControls} aria-label="Schriftgröße einstellen">
          <span>Schrift</span>
          <button type="button" aria-label="Schrift verkleinern" onClick={() => setFontScale((value) => Math.max(1, Number((value - 0.1).toFixed(2))))}>A−</button>
          <strong>{Math.round(fontScale * 100)}%</strong>
          <button type="button" aria-label="Schrift vergrößern" onClick={() => setFontScale((value) => Math.min(1.6, Number((value + 0.1).toFixed(2))))}>A+</button>
        </div>
        <label className={styles.search}>
          <span>⌕</span>
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Firma, Person, E-Mail oder Telefon …" />
          {query && <button type="button" onClick={() => setQuery("")} aria-label="Suche leeren">×</button>}
        </label>
      </section>

      <section className={styles.statusBar}>
        <div>
          <strong>{debouncedQuery ? "Suchergebnisse" : tabs.find((tab) => tab.key === activeScope)?.label || "CRM"}</strong>
          <span>{leads.length}{page?.hasMore ? "+" : ""} sichtbar · maximal {page?.limit || 50} pro Abruf</span>
        </div>
        <div className={styles.performance}><i /> Leichtgewichtige CRM-Ansicht</div>
      </section>

      <section aria-label="CRM Fokus und Performance" style={{display:"grid",gridTemplateColumns:"repeat(4,minmax(0,1fr))",gap:10,marginBottom:12}}>
        {[
          ["today","Heute fällig",performanceStats.today,"Was heute wirklich erledigt werden muss"],
          ["hot","Hot Leads",performanceStats.hot,"Priorität 75+ und noch offen"],
          ["overdue","Überfällig",performanceStats.overdue,"Nächster Schritt liegt in der Vergangenheit"],
          ["no_next","Ohne nächsten Schritt",performanceStats.noNext,"Aktive Leads ohne klare Wiedervorlage"],
        ].map(([key,label,count,note]) => (
          <button
            key={String(key)}
            type="button"
            onClick={() => setFocusView((current) => current === key ? "all" : key as typeof focusView)}
            aria-pressed={focusView === key}
            style={{
              minHeight:92,
              textAlign:"left",
              border: focusView === key ? "2px solid #171419" : "1px solid rgba(17,16,20,.09)",
              borderRadius:16,
              background: focusView === key ? "#171419" : "#fffdfb",
              color: focusView === key ? "#fff" : "#2d282c",
              padding:"14px 16px",
              cursor:"pointer",
              boxShadow:"0 10px 30px rgba(17,16,20,.04)"
            }}
          >
            <span style={{display:"block",fontSize:"calc(11px * var(--crm-font-scale))",fontWeight:800,opacity:.72}}>{String(label)}</span>
            <strong style={{display:"block",fontSize:"calc(24px * var(--crm-font-scale))",lineHeight:1.05,marginTop:5}}>{String(count)}</strong>
            <small style={{display:"block",fontSize:"calc(9px * var(--crm-font-scale))",marginTop:5,opacity:.62,lineHeight:1.3}}>{String(note)}</small>
          </button>
        ))}
      </section>

      {focusView !== "all" && (
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:12,margin:"0 0 12px",padding:"10px 12px",borderRadius:12,background:"#f1ece8"}}>
          <strong style={{fontSize:"calc(11px * var(--crm-font-scale))"}}>{visibleLeads.length} Leads in dieser Fokusansicht</strong>
          <button type="button" onClick={() => setFocusView("all")} style={{minHeight:40,border:0,borderRadius:9,padding:"0 13px",background:"#171419",color:"#fff",fontWeight:800,cursor:"pointer"}}>Alle anzeigen</button>
        </div>
      )}

      {data?.permissions.canManageLeads && selectedIds.size > 0 && (
        <section className={styles.bulkBar}>
          <div className={styles.bulkCount}>
            <strong>{selectedIds.size}</strong>
            <span>Leads ausgewählt</span>
            <button type="button" disabled={bulkBusy} onClick={() => { setSelectedIds(new Set()); setBulkPreview(null); }}>Auswahl löschen</button>
          </div>
          <div className={styles.bulkActions}>
            <button type="button" disabled={bulkBusy} onClick={() => void previewBulk("enrich")}>⌕ Enrichen</button>
            <button type="button" disabled={bulkBusy} onClick={() => void previewBulk("validate")}>✓ Validieren</button>
            <button type="button" disabled={bulkBusy} onClick={() => void previewBulk("analyze")}>◇ Analysieren</button>
            {data.permissions.canGenerateVideo && <button type="button" disabled={bulkBusy} onClick={() => void previewBulk("prepare_media")}>▣ Screenshots</button>}
          </div>
          {data.permissions.canViewAll && (
            <div className={styles.bulkOwner}>
              <select value={bulkOwnerChoice} disabled={bulkBusy} onChange={(event) => { setBulkOwnerChoice(event.target.value); setBulkPreview(null); }}>
                <option value="__choose__">Owner wählen …</option>
                <option value="__unassigned__">Unzugeordnet</option>
                {ownerOptions.map((owner) => <option value={owner.userId} key={owner.userId}>{owner.name}</option>)}
              </select>
              <button type="button" disabled={bulkBusy || bulkOwnerChoice === "__choose__"} onClick={() => void previewBulk("assign_owner")}>Zuweisen</button>
            </div>
          )}
        </section>
      )}

      {bulkPreview && (
        <section className={styles.bulkPreview}>
          <div className={styles.bulkPreviewHead}>
            <div>
              <small>POWER-MODUS · VORPRÜFUNG</small>
              <h3>{bulkPreview.label}</h3>
              <p><strong>{bulkPreview.eligible}</strong> geeignet · <strong>{bulkPreview.skipped}</strong> werden sicher übersprungen</p>
            </div>
            <button type="button" disabled={bulkBusy} onClick={() => setBulkPreview(null)}>×</button>
          </div>

          <div className={styles.bulkDecisionList}>
            {bulkPreview.decisions.map((item) => (
              <div key={item.leadId} data-eligible={item.eligible ? "yes" : "no"}>
                <span>{item.eligible ? "✓" : "—"}</span>
                <div><strong>{item.company}</strong><small>{item.reason}</small></div>
              </div>
            ))}
          </div>

          {bulkBusy && bulkProgress.total > 0 && (
            <div className={styles.bulkProgress}>
              <div><span style={{ width: `${Math.round((bulkProgress.done / bulkProgress.total) * 100)}%` }} /></div>
              <small>{bulkProgress.done}/{bulkProgress.total} verarbeitet · {bulkProgress.succeeded} erfolgreich · {bulkProgress.failed} Fehler</small>
            </div>
          )}

          <div className={styles.bulkPreviewActions}>
            <button type="button" disabled={bulkBusy} onClick={() => setBulkPreview(null)}>Abbrechen</button>
            <button type="button" className={styles.bulkExecute} disabled={bulkBusy || bulkPreview.eligible === 0} onClick={() => void executeBulk()}>
              {bulkBusy ? "Wird verarbeitet …" : `${bulkPreview.eligible} Leads ausführen`}
            </button>
          </div>
        </section>
      )}

      {notice && <div className={styles.notice}>{notice}</div>}
      {error && <div className={styles.error}>{error}</div>}

      {viewMode === "kanban" ? (
        <section className={styles.kanbanBoard}>
          <div className={styles.kanbanScroller}>
            {kanbanStages.map((stage) => {
              const items = visibleLeads.filter((lead) => lead.pipelineStage === stage);
              return (
                <section
                  className={styles.kanbanColumn}
                  data-stage={stage}
                  key={stage}
                  onDragOver={(event) => { if (data?.permissions.canManageLeads) event.preventDefault(); }}
                  onDrop={(event) => {
                    const leadId = event.dataTransfer.getData("text/lead-id");
                    const lead = visibleLeads.find((item) => item.id === leadId);
                    if (lead) void moveLeadStage(lead, stage);
                  }}
                >
                  <header className={styles.kanbanHeader}>
                    <div><i /><strong>{stageLabel[stage]}</strong></div>
                    <span>{items.length}</span>
                  </header>
                  <div className={styles.kanbanCards}>
                    {items.map((lead) => (
                      <article
                        key={lead.id}
                        className={styles.kanbanCard}
                        draggable={Boolean(data?.permissions.canManageLeads)}
                        onDragStart={(event) => event.dataTransfer.setData("text/lead-id", lead.id)}
                        onClick={() => setSelectedLeadId(lead.id)}
                      >
                        <div className={styles.kanbanTop}>
                          <span className={styles.companyMark}>{initials(lead.company)}</span>
                          <div><strong>{lead.company}</strong><small>{lead.contact || "Ansprechpartner offen"}</small></div>
                          <b>{lead.salesPriority}</b>
                        </div>
                        <p>{lead.contactLocked ? "Kontakt gesperrt" : actionLabel[lead.nextAction] || lead.nextAction}</p>
                        <div className={styles.kanbanMeta}>
                          <span>{lead.ownerName || "Unzugeordnet"}</span>
                          <span>{formatDate(lead.nextActionAt)}</span>
                        </div>
                        <div className={styles.kanbanChannels}>
                          <span data-state={channelState(lead.callStatus)}>☎</span>
                          <span data-state={channelState(lead.emailStatus)}>✉</span>
                          <span data-state={channelState(lead.whatsappStatus)}>◉</span>
                          <span data-state={lead.videoStatus === "ready" ? "ready" : lead.videoStatus === "failed" ? "stopped" : "idle"}>▶</span>
                        </div>
                      </article>
                    ))}
                    {!items.length && <div className={styles.kanbanEmpty}>Keine Leads</div>}
                  </div>
                </section>
              );
            })}
          </div>
          {page?.hasMore && (
            <div className={styles.loadMore}>
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore || bulkBusy}>{loadingMore ? "Weitere Leads werden geladen …" : "Weitere 50 Leads laden"}</button>
            </div>
          )}
        </section>
      ) : (
        <section className={styles.tableCard}>
          <div className={styles.tableWrap}>
            <table>
              <thead>
                <tr>
                  {data?.permissions.canManageLeads && (
                    <th className={styles.selectColumn}>
                      <input
                        type="checkbox"
                        aria-label="Bis zu 30 sichtbare Leads auswählen"
                        checked={allVisibleSelected}
                        onChange={toggleVisibleSelection}
                        disabled={!leads.length || bulkBusy}
                      />
                    </th>
                  )}
                  <th>Unternehmen</th>
                  <th>Kontakt</th>
                  <th>Status</th>
                  <th>Nächster Schritt</th>
                  <th>Kanäle</th>
                  <th>Owner</th>
                  <th>Score</th>
                  <th>Aktualisiert</th>
                </tr>
              </thead>
              <tbody>
                {loading && leads.length === 0 ? (
                  Array.from({ length: 8 }).map((_, index) => <SkeletonRow key={index} selectable={Boolean(data?.permissions.canManageLeads)} />)
                ) : visibleLeads.length ? visibleLeads.map((lead) => (
                  <tr key={lead.id} className={lead.contactLocked ? styles.lockedRow : undefined}>
                    {data?.permissions.canManageLeads && (
                      <td className={styles.selectColumn}>
                        <input
                          type="checkbox"
                          checked={selectedIds.has(lead.id)}
                          onChange={() => toggleLeadSelection(lead.id)}
                          disabled={bulkBusy}
                          aria-label={`${lead.company} auswählen`}
                        />
                      </td>
                    )}
                    <td>
                      <button className={styles.companyButton} onClick={() => setSelectedLeadId(lead.id)}>
                        <span className={styles.companyMark}>{initials(lead.company)}</span>
                        <span><strong>{lead.company}</strong><small>{[lead.city, lead.region].filter(Boolean).join(", ") || "Standort offen"}</small></span>
                      </button>
                    </td>
                    <td>
                      <div className={styles.contact}><strong>{lead.contact || "Ansprechpartner offen"}</strong><small>{lead.phone || lead.email || "Kontaktdaten offen"}</small></div>
                    </td>
                    <td><span className={styles.stage} data-stage={lead.pipelineStage}>{stageLabel[lead.pipelineStage] || lead.pipelineStage}</span></td>
                    <td>
                      <div className={styles.nextAction}>
                        <strong>{lead.contactLocked ? "Gesperrt" : actionLabel[lead.nextAction] || lead.nextAction}</strong>
                        <small>{lead.contactLocked ? "Kein weiterer Kontakt" : formatDate(lead.nextActionAt)}</small>
                      </div>
                    </td>
                    <td>
                      <div className={styles.channels} aria-label="Kontaktkanäle">
                        <span data-state={channelState(lead.callStatus)} title={"Call: " + lead.callStatus}>☎</span>
                        <span data-state={channelState(lead.emailStatus)} title={"E-Mail: " + lead.emailStatus}>✉</span>
                        <span data-state={channelState(lead.whatsappStatus)} title={"WhatsApp: " + lead.whatsappStatus}>◉</span>
                        <span data-state={lead.videoStatus === "ready" ? "ready" : lead.videoStatus === "failed" ? "stopped" : "idle"} title={"Video: " + lead.videoStatus}>▶</span>
                      </div>
                    </td>
                    <td>
                      {data?.permissions.canViewAll && data.permissions.canManageLeads ? (
                        <select
                          className={styles.ownerSelect}
                          value={lead.ownerId || ""}
                          disabled={savingOwnerId === lead.id || bulkBusy}
                          onChange={(event) => void changeOwner(lead, event.target.value)}
                          aria-label={`Owner für ${lead.company}`}
                        >
                          <option value="">Unzugeordnet</option>
                          {ownerOptions.map((owner) => <option key={owner.userId} value={owner.userId}>{owner.name}</option>)}
                        </select>
                      ) : <span className={styles.ownerName}>{lead.ownerName || "Unzugeordnet"}</span>}
                    </td>
                    <td><span className={styles.score}>{lead.salesPriority}</span></td>
                    <td><span className={styles.updated}>{formatDate(lead.updatedAt)}</span></td>
                  </tr>
                )) : (
                  <tr><td colSpan={data?.permissions.canManageLeads ? 9 : 8}><div className={styles.empty}>{debouncedQuery ? "Keine passenden Leads gefunden." : "In diesem CRM-Bereich liegen noch keine Leads."}</div></td></tr>
                )}
              </tbody>
            </table>
          </div>

          {page?.hasMore && (
            <div className={styles.loadMore}>
              <button type="button" onClick={() => void loadMore()} disabled={loadingMore || bulkBusy}>{loadingMore ? "Weitere Leads werden geladen …" : "Weitere 50 Leads laden"}</button>
            </div>
          )}
        </section>


      )}

      {selectedLeadId && (
        <LeadCrmPanel
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
          onUpdated={handleUpdated}
        />
      )}
    </div>
  );
}

function SkeletonRow({ selectable }: { selectable: boolean }) {
  return (
    <tr className={styles.skeletonRow}>
      {selectable && <td className={styles.selectColumn}><span /></td>}
      {Array.from({ length: 8 }).map((_, index) => <td key={index}><span /></td>)}
    </tr>
  );
}
