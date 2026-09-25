"use client";

import { ChangeEvent, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Papa from "papaparse";
import styles from "./IntakeWorkspace.module.css";

type IntakeDecision = {
  intakeId: string;
  kind: "create" | "update" | "duplicate";
  eligible: boolean;
  company: string;
  existingLeadId: string | null;
  reason: string;
  matchBy: "instagram" | "domain" | "company" | "none";
  readiness: "strong" | "usable" | "research";
  directContact: boolean;
  fields: {
    contact: string;
    email: string;
    phone: string;
    instagramUrl: string;
    websiteUrl: string;
    city: string;
    region: string;
    salesPriority: number;
  };
};

type PreviewPayload = {
  source: string;
  sourceCount: number;
  normalizedCount: number;
  mergedInsideImport: number;
  discarded: number;
  decisions: IntakeDecision[];
  permissions: { canViewAll: boolean };
  currentUser: { id: string; name: string | null; email: string | null };
  members: Array<{ userId: string; name: string; role: string }>;
  error?: string;
};

type CommitResult = {
  created: number;
  updated: number;
  processed: number;
  leadIds: string[];
  error?: string;
};

type PipelineState = {
  running: boolean;
  stage: "idle" | "enrich" | "validate" | "analyze" | "done";
  done: number;
  total: number;
  failed: number;
};

const kindLabel = { create: "Neu", update: "Ergänzen", duplicate: "Vorhanden" } as const;
const readinessLabel = { strong: "Kontaktbereit", usable: "Brauchbar", research: "Recherche nötig" } as const;

function parseTextInput(value: string): unknown {
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) return JSON.parse(trimmed);

  const lines = trimmed.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  const first = lines[0]?.toLowerCase() || "";
  const looksLikeHeader = /(company|companyname|firma|unternehmen|name|title|website|telefon|phone|email|instagram)/i.test(first);
  const hasDelimiter = /[,;\t]/.test(lines[0] || "");

  if (!looksLikeHeader && !hasDelimiter) return lines.map((company) => ({ company }));

  const parsed = Papa.parse<Record<string, unknown>>(trimmed, {
    header: true,
    skipEmptyLines: true,
    transformHeader: (header) => header.trim(),
  });
  if (parsed.errors.length && parsed.data.length === 0) throw new Error(parsed.errors[0].message);
  return parsed.data;
}

function rankedEligible(items: IntakeDecision[]) {
  const readinessScore = { strong: 3, usable: 2, research: 1 } as const;
  return items
    .filter((item) => item.eligible)
    .toSorted((a, b) =>
      readinessScore[b.readiness] - readinessScore[a.readiness]
      || Number(b.directContact) - Number(a.directContact)
      || b.fields.salesPriority - a.fields.salesPriority
      || a.company.localeCompare(b.company, "de")
    );
}

function chunk<T>(items: T[], size: number) {
  const groups: T[][] = [];
  for (let index = 0; index < items.length; index += size) groups.push(items.slice(index, index + size));
  return groups;
}

export default function IntakeWorkspace() {
  const [paste, setPaste] = useState("");
  const [raw, setRaw] = useState<unknown>(null);
  const [source, setSource] = useState("Lead Intake");
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [ownerChoice, setOwnerChoice] = useState("__me__");
  const [loading, setLoading] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null);
  const [researchCandidateIds, setResearchCandidateIds] = useState<string[]>([]);
  const [pipeline, setPipeline] = useState<PipelineState>({ running: false, stage: "idle", done: 0, total: 0, failed: 0 });

  const eligible = useMemo(() => preview?.decisions.filter((item) => item.eligible) || [], [preview]);
  useEffect(() => {
    const stored = sessionStorage.getItem("jj:research-intake");
    if (!stored) return;
    sessionStorage.removeItem("jj:research-intake");
    try {
      const payload = JSON.parse(stored) as { raw?: unknown; source?: string; candidateIds?: string[] };
      setResearchCandidateIds(Array.isArray(payload.candidateIds) ? payload.candidateIds : []);
      if (payload.raw) void requestPreview(payload.raw, payload.source || "Recherche-Feed");
    } catch {
      setError("Die Übergabe aus dem Recherche-Feed konnte nicht gelesen werden.");
    }
  }, []);

  const stats = useMemo(() => {
    const decisions = preview?.decisions || [];
    return {
      create: decisions.filter((item) => item.kind === "create").length,
      update: decisions.filter((item) => item.kind === "update").length,
      duplicate: decisions.filter((item) => item.kind === "duplicate").length,
      strong: decisions.filter((item) => item.readiness === "strong").length,
    };
  }, [preview]);

  async function requestPreview(nextRaw: unknown, nextSource: string) {
    setLoading(true);
    setError("");
    setMessage("");
    setCommitResult(null);
    setResearchCandidateIds([]);
    setPipeline({ running: false, stage: "idle", done: 0, total: 0, failed: 0 });
    try {
      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "preview", raw: nextRaw, source: nextSource }),
      });
      const payload = await response.json() as PreviewPayload;
      if (!response.ok) throw new Error(payload.error || "Vorschau konnte nicht erstellt werden.");
      setRaw(nextRaw);
      setSource(nextSource);
      setPreview(payload);
      setOwnerChoice("__me__");
      setSelected(new Set(rankedEligible(payload.decisions).slice(0, 30).map((item) => item.intakeId)));
      if (!payload.decisions.length) setError("In diesen Daten wurde kein importierbares Unternehmen erkannt.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Vorschau konnte nicht erstellt werden.");
    } finally {
      setLoading(false);
    }
  }

  async function previewPaste() {
    try {
      await requestPreview(parseTextInput(paste), "Eingefügte Lead-Liste");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Die eingefügten Daten konnten nicht gelesen werden.");
    }
  }

  async function fileChanged(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      let nextRaw: unknown;
      if (file.name.toLowerCase().endsWith(".json")) nextRaw = JSON.parse(text);
      else {
        const parsed = Papa.parse<Record<string, unknown>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim(),
        });
        if (parsed.errors.length && parsed.data.length === 0) throw new Error(parsed.errors[0].message);
        nextRaw = parsed.data;
      }
      await requestPreview(nextRaw, file.name);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Datei konnte nicht gelesen werden.");
    }
  }

  function toggle(intakeId: string) {
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(intakeId)) {
        next.delete(intakeId);
        return next;
      }
      if (next.size >= 30) {
        setError("Pro Intake-Runde können maximal 30 Leads übernommen werden.");
        return current;
      }
      next.add(intakeId);
      return next;
    });
  }

  function selectBest30() {
    setSelected(new Set(rankedEligible(eligible).slice(0, 30).map((item) => item.intakeId)));
  }

  async function commit() {
    if (!preview || !raw || !selected.size || committing) return;
    setCommitting(true);
    setError("");
    setMessage("");
    try {
      const ownerId = ownerChoice === "__unassigned__"
        ? null
        : ownerChoice === "__me__"
          ? preview.currentUser.id
          : ownerChoice;

      const response = await fetch("/api/intake", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          mode: "commit",
          raw,
          source,
          selectedIntakeIds: [...selected],
          ownerId,
        }),
      });
      const result = await response.json() as CommitResult;
      if (!response.ok) throw new Error(result.error || "Leads konnten nicht übernommen werden.");
      setCommitResult(result);
      if (researchCandidateIds.length) {
        await fetch("/api/research-feed", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ action: "mark_imported", ids: researchCandidateIds }),
        }).catch(() => undefined);
        setResearchCandidateIds([]);
      }
      setMessage(String(result.created) + " neue Leads angelegt, " + String(result.updated) + " bestehende Leads ergänzt.");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Leads konnten nicht übernommen werden.");
    } finally {
      setCommitting(false);
    }
  }

  async function runBulkStage(operation: "enrich" | "validate" | "analyze", leadIds: string[]) {
    const previewResponse = await fetch("/api/crm/bulk", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ mode: "preview", operation, leadIds }),
    });
    const previewPayload = await previewResponse.json() as {
      decisions?: Array<{ leadId: string; eligible: boolean }>;
      execution?: { chunkSize: number };
      error?: string;
    };
    if (!previewResponse.ok) throw new Error(previewPayload.error || operation + " konnte nicht vorbereitet werden.");

    const eligibleIds = (previewPayload.decisions || []).filter((item) => item.eligible).map((item) => item.leadId);
    const groups = chunk(eligibleIds, Math.max(1, previewPayload.execution?.chunkSize || 5));

    for (const leadGroup of groups) {
      const response = await fetch("/api/crm/bulk", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ mode: "execute", operation, leadIds: leadGroup }),
      });
      const result = await response.json() as { failed?: number; error?: string };
      if (!response.ok) throw new Error(result.error || operation + " wurde unterbrochen.");
      setPipeline((current) => ({
        ...current,
        done: current.done + leadGroup.length,
        failed: current.failed + Number(result.failed || 0),
      }));
    }
  }

  async function prepareImportedLeads() {
    if (!commitResult?.leadIds.length || pipeline.running) return;
    const leadIds = commitResult.leadIds.slice(0, 30);
    setPipeline({ running: true, stage: "enrich", done: 0, total: leadIds.length * 3, failed: 0 });
    setError("");
    setMessage("");

    try {
      await runBulkStage("enrich", leadIds);
      setPipeline((current) => ({ ...current, stage: "validate" }));
      await runBulkStage("validate", leadIds);
      setPipeline((current) => ({ ...current, stage: "analyze" }));
      await runBulkStage("analyze", leadIds);
      setPipeline((current) => ({ ...current, running: false, stage: "done", done: current.total }));
      setMessage("Aufbereitung abgeschlossen. Die Leads sind jetzt recherchiert, validiert und priorisiert.");
    } catch (caught) {
      setPipeline((current) => ({ ...current, running: false }));
      setError(caught instanceof Error ? caught.message : "Aufbereitung wurde unterbrochen.");
    }
  }

  function reset() {
    setPaste("");
    setRaw(null);
    setPreview(null);
    setSelected(new Set());
    setOwnerChoice("__me__");
    setCommitResult(null);
    setPipeline({ running: false, stage: "idle", done: 0, total: 0, failed: 0 });
    setMessage("");
    setError("");
  }

  const stageLabel = pipeline.stage === "enrich"
    ? "Recherche & Enrichment"
    : pipeline.stage === "validate"
      ? "Validierung"
      : pipeline.stage === "analyze"
        ? "Priorisierung"
        : pipeline.stage === "done"
          ? "Fertig"
          : "";

  return (
    <div className={styles.root}>
      <section className={styles.steps} aria-label="Lead Intake Schritte">
        {[
          ["1", "Daten rein", Boolean(raw)],
          ["2", "Prüfen", Boolean(preview)],
          ["3", "Zuweisen", Boolean(commitResult)],
          ["4", "Aufbereiten", pipeline.stage === "done"],
        ].map(([number, label, done]) => (
          <div key={String(number)} data-done={done ? "yes" : "no"}>
            <span>{done ? "✓" : number}</span><strong>{label}</strong>
          </div>
        ))}
      </section>

      {!preview && (
        <section className={styles.inputCard}>
          <div className={styles.inputIntro}>
            <small>NEUE LEAD-RUNDE</small>
            <h2>Die nächsten Leads reinladen.</h2>
            <p>CSV/JSON hochladen oder Daten direkt einfügen. Vor dem Speichern werden Firmen normalisiert, Dubletten erkannt und Kontaktqualität geprüft.</p>
          </div>
          <div className={styles.inputGrid}>
            <label className={styles.dropzone}>
              <span>↑</span>
              <strong>CSV oder JSON auswählen</strong>
              <small>Datei wird zuerst nur geprüft — noch nichts landet im CRM.</small>
              <input type="file" accept=".csv,.json,text/csv,application/json" onChange={fileChanged} disabled={loading} />
            </label>
            <div className={styles.pasteBox}>
              <div><strong>Oder Liste einfügen</strong><small>CSV, JSON oder einfach eine Firma pro Zeile.</small></div>
              <textarea value={paste} onChange={(event) => setPaste(event.target.value)} placeholder={"Firma,Website,Telefon,E-Mail,Instagram\nBeispiel GmbH,https://beispiel.de,+49...,info@beispiel.de,https://instagram.com/beispiel"} rows={9} />
              <button type="button" disabled={loading || !paste.trim()} onClick={() => void previewPaste()}>{loading ? "Prüft …" : "Liste prüfen"}</button>
            </div>
          </div>
        </section>
      )}

      {preview && (
        <>
          <section className={styles.summary}>
            <div><small>QUELLE</small><strong>{preview.sourceCount}</strong><span>Datensätze gelesen</span></div>
            <div><small>NEU</small><strong>{stats.create}</strong><span>neue Firmen</span></div>
            <div><small>ERGÄNZEN</small><strong>{stats.update}</strong><span>bestehende Leads</span></div>
            <div><small>DUBLETTEN</small><strong>{stats.duplicate}</strong><span>werden übersprungen</span></div>
            <div><small>KONTAKTBEREIT</small><strong>{stats.strong}</strong><span>mit Kontakt + Profil</span></div>
          </section>

          <section className={styles.controlBar}>
            <div>
              <strong>{selected.size} von maximal 30 ausgewählt</strong>
              <span>{preview.mergedInsideImport > 0 ? String(preview.mergedInsideImport) + " doppelte Zeilen innerhalb der Datei wurden bereits zusammengeführt." : "Keine internen Dubletten erkannt."}</span>
            </div>
            <div className={styles.controlActions}>
              <button type="button" onClick={selectBest30}>Beste 30 auswählen</button>
              <button type="button" onClick={reset}>Neue Datei</button>
            </div>
          </section>

          <section className={styles.tableCard}>
            <div className={styles.tableWrap}>
              <table>
                <thead><tr><th /><th>Unternehmen</th><th>Prüfung</th><th>Kontakt</th><th>Online</th><th>Priorität</th></tr></thead>
                <tbody>
                  {preview.decisions.map((item) => (
                    <tr key={item.intakeId} data-kind={item.kind}>
                      <td><input type="checkbox" checked={selected.has(item.intakeId)} disabled={!item.eligible || committing} onChange={() => toggle(item.intakeId)} /></td>
                      <td><strong>{item.company}</strong><small>{[item.fields.city, item.fields.region].filter(Boolean).join(", ") || "Standort offen"}</small></td>
                      <td><span className={styles.kind} data-kind={item.kind}>{kindLabel[item.kind]}</span><small>{item.reason}</small></td>
                      <td><strong>{item.fields.contact || "Ansprechpartner offen"}</strong><small>{item.fields.phone || item.fields.email || "Direkter Kontakt fehlt"}</small></td>
                      <td><strong>{item.fields.instagramUrl ? "Instagram" : item.fields.websiteUrl ? "Website" : "Noch offen"}</strong><small>{item.matchBy !== "none" ? "Match: " + item.matchBy : readinessLabel[item.readiness]}</small></td>
                      <td><span className={styles.priority}>{item.fields.salesPriority}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          {!commitResult && (
            <section className={styles.assignment}>
              <div>
                <small>SCHRITT 3</small>
                <h3>Wem gehören die neuen Leads?</h3>
                <p>Bestehende Leads behalten ihren aktuellen Owner. Nur neu angelegte Leads werden hier zugeordnet.</p>
              </div>
              <div className={styles.assignmentControls}>
                {preview.permissions.canViewAll ? (
                  <select value={ownerChoice} onChange={(event) => setOwnerChoice(event.target.value)} disabled={committing}>
                    <option value="__me__">Mir zuweisen · {preview.currentUser.name || preview.currentUser.email}</option>
                    {preview.members.filter((member) => member.userId !== preview.currentUser.id).map((member) => <option key={member.userId} value={member.userId}>{member.name}</option>)}
                    <option value="__unassigned__">Unzugeordnet lassen</option>
                  </select>
                ) : <span>Neue Leads werden automatisch dir zugeordnet.</span>}
                <button type="button" className={styles.primary} disabled={!selected.size || committing} onClick={() => void commit()}>
                  {committing ? "Übernimmt …" : String(selected.size) + " Leads ins CRM übernehmen"}
                </button>
              </div>
            </section>
          )}

          {commitResult && (
            <section className={styles.successCard}>
              <div className={styles.successIcon}>✓</div>
              <div className={styles.successCopy}>
                <small>ÜBERNAHME ERFOLGREICH</small>
                <h3>{commitResult.processed} Leads sind im CRM.</h3>
                <p>{commitResult.created} neu angelegt · {commitResult.updated} mit aktuellen Daten ergänzt.</p>
              </div>
              <div className={styles.successActions}>
                <button type="button" className={styles.primary} disabled={pipeline.running || !commitResult.leadIds.length || pipeline.stage === "done"} onClick={() => void prepareImportedLeads()}>
                  {pipeline.running ? "Aufbereitung läuft …" : pipeline.stage === "done" ? "Aufbereitung abgeschlossen" : "Jetzt automatisch aufbereiten"}
                </button>
                <Link href="/dashboard/crm">Im CRM öffnen ↗</Link>
              </div>
              {pipeline.stage !== "idle" && (
                <div className={styles.pipeline}>
                  <div className={styles.pipelineHead}><strong>{stageLabel}</strong><span>{pipeline.done}/{pipeline.total}</span></div>
                  <div><span style={{ width: String(pipeline.total ? Math.min(100, Math.round((pipeline.done / pipeline.total) * 100)) : 0) + "%" }} /></div>
                  <small>{pipeline.failed ? String(pipeline.failed) + " Einzelschritte mit Fehler — die restlichen Leads laufen weiter." : "Fehlerfreie Verarbeitung bisher."}</small>
                </div>
              )}
            </section>
          )}
        </>
      )}

      {message && <div className={styles.message}>{message}</div>}
      {error && <div className={styles.error}>{error}</div>}
    </div>
  );
}
