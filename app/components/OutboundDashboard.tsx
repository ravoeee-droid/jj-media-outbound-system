"use client";

import Link from "next/link";

import { ChangeEvent, FormEvent, useEffect, useMemo, useState } from "react";
import { upload } from "@vercel/blob/client";
import Papa from "papaparse";
import Brand from "./Brand";
import LeadCrmPanel from "./LeadCrmPanel";
import LandingStudio from "./LandingStudio";
import SystemReadiness from "./SystemReadiness";

type LeadStatus = "Nicht erstellt" | "Bereit" | "Wird erstellt" | "Fehlgeschlagen" | "Angesehen" | "Termin";

type Lead = {
  id: string;
  company: string;
  contact: string;
  email: string;
  url: string;
  status: LeadStatus;
  watch: string;
  updated: string;
  slug: string;
  pipelineStage: string;
  videoStatus: string;
  salesPriority: number;
  websiteScore: number;
  jobCount: number;
  dealValue: number;
  probability: number;
};

const initialLeads: Lead[] = [];

function statusClass(status: LeadStatus) {
  return `status status--${status.toLowerCase().replace(" ", "-").replace("ä", "a")}`;
}

function slugify(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

function mapApiLead(lead: Record<string, unknown>): Lead {
  const pipelineStage = String(lead.pipelineStage || "new");
  const videoStatus = String(lead.videoStatus || "not_started");
  const watchPercent = Number(lead.watchPercent || 0);
  const status: LeadStatus = pipelineStage === "call_booked" || pipelineStage === "won"
    ? "Termin"
    : watchPercent > 0 || pipelineStage === "replied"
      ? "Angesehen"
      : videoStatus === "processing"
        ? "Wird erstellt"
        : videoStatus === "ready"
          ? "Bereit"
          : videoStatus === "failed"
            ? "Fehlgeschlagen"
            : "Nicht erstellt";
  return {
    id: String(lead.id || crypto.randomUUID()),
    company: String(lead.company || ""),
    contact: String(lead.contact || "Noch nicht ermittelt"),
    email: String(lead.email || ""),
    url: (() => {
      const value = String(lead.websiteUrl || "");
      try { return `@${new URL(value).pathname.split("/").filter(Boolean)[0] || "instagram"}`; } catch { return value; }
    })(),
    status,
    watch: watchPercent > 0 ? `${watchPercent} %` : "—",
    updated: videoStatus === "processing"
      ? "Rendering läuft"
      : videoStatus === "failed"
        ? "Erstellung fehlgeschlagen"
        : videoStatus === "ready"
          ? "Video bereit"
          : "Noch nicht gestartet",
    slug: String(lead.slug || ""),
    pipelineStage,
    videoStatus,
    salesPriority: Number(lead.salesPriority || 0),
    websiteScore: Number(lead.websiteScore || 0),
    jobCount: Number(lead.jobCount || 0),
    dealValue: Number(lead.dealValue || 0),
    probability: Number(lead.probability || 0),
  };
}

function renderLeadTemplate(template: string, lead: Lead) {
  const firstName = lead.contact?.trim().split(/\s+/)[0] || "Guten Tag";
  const videoLink = `${window.location.origin}/v/${lead.slug}`;
  return template
    .replaceAll("{{unternehmen}}", lead.company)
    .replaceAll("{{vorname}}", firstName)
    .replaceAll("{{video_link}}", videoLink);
}

export default function OutboundDashboard({ userName = "JJ-Media" }: { userName?: string }) {
  const [leads, setLeads] = useState(initialLeads);
  const [query, setQuery] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [toast, setToast] = useState("");
  const [activeSection, setActiveSection] = useState("Übersicht");
  const [showIntegrations, setShowIntegrations] = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showCampaign, setShowCampaign] = useState(false);
  const [showTasks, setShowTasks] = useState(false);
  const [emailDraft, setEmailDraft] = useState<{ lead: Lead; subject: string; body: string; html: string; previewImageUrl: string; friendlyVideoUrl: string } | null>(null);
  const [tasks, setTasks] = useState<Array<{ id: string; title: string; dueAt?: string; priority: string; status: string }>>([]);
  const [calendarUrl, setCalendarUrl] = useState("");
  const [emailSubject, setEmailSubject] = useState("Kurzes Video für {{unternehmen}}");
  const [emailBody, setEmailBody] = useState("Hallo {{vorname}},\n\nich habe mir das Instagram-Profil von {{unternehmen}} angesehen und dazu eine kurze persönliche Social-Media-Analyse vorbereitet:\n\n{{video_link}}\n\nWenn die drei Hebel relevant sind, kannst du direkt daneben einen kurzen Termin wählen.\n\nViele Grüße\nJJ-Media");
  const [followupOne, setFollowupOne] = useState("Hallo {{vorname}}, kurze Nachfrage: Konntest du schon einen Blick auf das Video werfen?\n\n{{video_link}}\n\nViele Grüße\nJJ-Media");
  const [followupTwo, setFollowupTwo] = useState("Hallo {{vorname}}, wenn das Thema aktuell keine Priorität hat, reicht ein kurzes „später“.\n\nFalls doch: {{video_link}}\n\nViele Grüße\nJJ-Media");
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadError, setUploadError] = useState("");
  const [importing, setImporting] = useState(false);
  const [selectedLeadId, setSelectedLeadId] = useState<string | null>(null);
  const [selectedLeadIds, setSelectedLeadIds] = useState<string[]>([]);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number } | null>(null);
  const [uploadingProfileId, setUploadingProfileId] = useState<string | null>(null);
  const [manualComposerOpened, setManualComposerOpened] = useState(false);
  const [sendingEmail, setSendingEmail] = useState(false);
  const [autoFollowups, setAutoFollowups] = useState(false);
  const [integrations, setIntegrations] = useState({
    screenshotOne: false,
    calendar: false,
    masterVideo: false,
    gmail: false,
    database: false,
    blob: false,
  });

  useEffect(() => {
    let active = true;
    fetch("/api/leads")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("API unavailable")))
      .then((payload: { leads?: Record<string, unknown>[] }) => {
        if (active && payload.leads?.length) setLeads(payload.leads.map(mapApiLead));
      })
      .catch(() => undefined);
    fetch("/api/settings")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Settings unavailable")))
      .then((payload: { settings?: Record<string, string>; integrations?: typeof integrations }) => {
        if (!active) return;
        if (payload.integrations) setIntegrations(payload.integrations);
        if (payload.settings?.calendar_embed_url) setCalendarUrl(payload.settings.calendar_embed_url);
        if (payload.settings?.email_subject) setEmailSubject(payload.settings.email_subject);
        if (payload.settings?.email_body) setEmailBody(payload.settings.email_body);
        if (payload.settings?.followup_1_body) setFollowupOne(payload.settings.followup_1_body);
        if (payload.settings?.followup_2_body) setFollowupTwo(payload.settings.followup_2_body);
        setAutoFollowups(payload.settings?.auto_followups === "true");
      })
      .catch(() => undefined);
    fetch("/api/tasks")
      .then((response) => response.ok ? response.json() : Promise.reject(new Error("Tasks unavailable")))
      .then((payload: { tasks?: typeof tasks }) => {
        if (active && payload.tasks) setTasks(payload.tasks);
      })
      .catch(() => undefined);
    return () => { active = false; };
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const gmail = params.get("gmail");
    if (!gmail) return;
    setActiveSection("Integrationen");
    if (gmail === "connected") showToast("Gmail wurde erfolgreich verbunden.");
    else if (gmail === "denied") showToast("Google-Verbindung wurde abgebrochen.");
    else showToast(params.get("detail") || "Gmail konnte nicht verbunden werden.");
    window.history.replaceState(null, "", "/dashboard#integrationen");
  }, []);

  const metrics = useMemo(() => {
    const ready = leads.filter((lead) => lead.videoStatus === "ready").length;
    const viewed = leads.filter((lead) => lead.status === "Angesehen" || lead.status === "Termin").length;
    const booked = leads.filter((lead) => lead.status === "Termin").length;
    return [
      { label: "Leads gesamt", value: String(leads.length), note: `${tasks.filter((task) => task.status === "open").length} Follow-ups offen` },
      { label: "Videos bereit", value: String(ready), note: leads.length ? `${Math.round((ready / leads.length) * 100)} % der Leads` : "0 %" },
      { label: "Video angesehen", value: String(viewed), note: ready ? `${Math.round((viewed / ready) * 100)} % View-Rate` : "0 % View-Rate" },
      { label: "Termine gebucht", value: String(booked), note: viewed ? `${Math.round((booked / viewed) * 100)} % der Zuschauer` : "0 % der Zuschauer" },
    ];
  }, [leads, tasks]);

  const filteredLeads = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return leads;
    return leads.filter((lead) =>
      [lead.company, lead.contact, lead.url, lead.status].join(" ").toLowerCase().includes(needle),
    );
  }, [leads, query]);

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2600);
  }

  async function addLead(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    const company = String(data.get("company") || "").trim();
    const contact = String(data.get("contact") || "").trim();
    const url = String(data.get("url") || "").trim();
    if (!company || !url) return;
    const optimisticLead: Lead = {
      id: `temp-${Date.now()}`,
      company,
      contact: contact || "Noch nicht ermittelt",
      email: String(data.get("email") || "").trim(),
      url: url.replace(/^https?:\/\//, "").replace(/\/$/, ""),
      status: "Nicht erstellt",
      watch: "—",
      updated: "gerade eben",
      slug: slugify(company),
      pipelineStage: "new",
      videoStatus: "not_started",
      salesPriority: 0,
      websiteScore: 0,
      jobCount: 0,
      dealValue: 0,
      probability: 0,
    };
    setLeads((current) => [optimisticLead, ...current]);
    setShowCreate(false);
    event.currentTarget.reset();
    try {
      const response = await fetch("/api/leads", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ company, contact, email: optimisticLead.email, instagramUrl: url }),
      });
      if (!response.ok) throw new Error("Lead konnte nicht gespeichert werden.");
      const payload = await response.json() as { lead: Record<string, unknown> };
      const stored = mapApiLead(payload.lead);
      setLeads((current) => [stored, ...current.filter((lead) => lead.id !== optimisticLead.id)]);
      showToast(`${company} ist als Lead gespeichert. Das Video startet erst nach deinem Klick.`);
    } catch {
      showToast(`${company} wurde lokal vorgemerkt. Die dauerhafte Speicherung ist gerade nicht erreichbar.`);
    }
  }

  function navClick(label: string) {
    setActiveSection(label);
    window.history.replaceState(null, "", `#${label.toLowerCase().replace("ü", "ue").replace("-", "")}`);
  }

  async function saveTemplates() {
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email_subject: emailSubject,
        email_body: emailBody,
        followup_1_body: followupOne,
        followup_2_body: followupTwo,
      }),
    });
    showToast(response.ok ? "Vorlagen wurden gespeichert." : "Vorlagen konnten nicht gespeichert werden.");
  }

  async function prepareEmail(lead: Lead) {
    if (!lead.email) {
      showToast("Für diesen Lead fehlt noch eine E-Mail-Adresse.");
      return;
    }
    try {
      const response = await fetch("/api/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, action: "prepare", step: 1 }),
      });
      const payload = await response.json() as { subject?: string; body?: string; html?: string; previewImageUrl?: string; friendlyVideoUrl?: string; error?: string };
      if (!response.ok) throw new Error(payload.error || "E-Mail konnte nicht vorbereitet werden.");
      setEmailDraft({
        lead,
        subject: payload.subject || renderLeadTemplate(emailSubject, lead),
        body: payload.body || renderLeadTemplate(emailBody, lead),
        html: payload.html || "",
        previewImageUrl: payload.previewImageUrl || `${window.location.origin}/api/preview/${lead.slug}`,
        friendlyVideoUrl: payload.friendlyVideoUrl || `${window.location.origin}/video/${lead.slug}`,
      });
      setManualComposerOpened(false);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "E-Mail konnte nicht vorbereitet werden.");
    }
  }

  async function generateOneLead(lead: Lead, quiet = false) {
    if (!lead.url) {
      if (!quiet) showToast("Für diesen Lead fehlt noch das Instagram-Profil.");
      return false;
    }
    setLeads((current) => current.map((item) => item.id === lead.id
      ? { ...item, status: "Wird erstellt", videoStatus: "processing", updated: "wird vorbereitet" }
      : item));
    if (!quiet) showToast(`${lead.company}: Instagram-Profil + Talking Head werden als echtes MP4 gerendert …`);
    let lastError = "Video konnte nicht erstellt werden.";
    for (let attempt = 1; attempt <= 1; attempt += 1) {
      try {
        const response = await fetch("/api/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ leadId: lead.id }),
        });
        const payload = await response.json() as { error?: string };
        if (!response.ok) throw new Error(payload.error || lastError);
        setLeads((current) => current.map((item) => item.id === lead.id
          ? { ...item, status: "Bereit", videoStatus: "ready", updated: "gerade fertig" }
          : item));
        if (!quiet) showToast(`${lead.company}: Video und Landingpage sind bereit.`);
        return true;
      } catch (error) {
        lastError = error instanceof Error ? error.message : lastError;
        if (attempt < 1) await new Promise((resolve) => window.setTimeout(resolve, 900));
      }
    }
    setLeads((current) => current.map((item) => item.id === lead.id
      ? { ...item, status: "Fehlgeschlagen", videoStatus: "failed", updated: "Erstellung fehlgeschlagen" }
      : item));
    if (!quiet) showToast(lastError);
    return false;
  }

  async function generateLeadVideo(lead: Lead) {
    await generateOneLead(lead);
  }

  async function uploadProfileScreenshot(lead: Lead, event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || uploadingProfileId) return;
    setUploadingProfileId(lead.id);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch(`/api/leads/${lead.id}/profile-preview`, { method: "POST", body: form });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Profil-Screenshot konnte nicht gespeichert werden.");
      setLeads((current) => current.map((item) => item.id === lead.id
        ? { ...item, videoStatus: "not_started", status: "Nicht erstellt", updated: "Instagram-Screenshot gespeichert" }
        : item));
      showToast(`${lead.company}: Profil-Screenshot gespeichert. Jetzt kann das Video erstellt werden.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Profil-Screenshot konnte nicht gespeichert werden.");
    } finally {
      setUploadingProfileId(null);
      event.target.value = "";
    }
  }

  async function generateSelectedLeads() {
    if (batchProgress) return;
    const targets = leads.filter((lead) => selectedLeadIds.includes(lead.id));
    if (!targets.length) {
      showToast("Wähle zuerst mindestens einen Lead aus.");
      return;
    }
    setBatchProgress({ current: 0, total: targets.length });
    let cursor = 0;
    let completed = 0;
    let succeeded = 0;
    const worker = async () => {
      while (cursor < targets.length) {
        const index = cursor;
        cursor += 1;
        if (await generateOneLead(targets[index], true)) succeeded += 1;
        completed += 1;
        setBatchProgress({ current: completed, total: targets.length });
      }
    };
    await Promise.all(Array.from({ length: Math.min(1, targets.length) }, () => worker()));
    setBatchProgress(null);
    setSelectedLeadIds([]);
    showToast(`${succeeded} von ${targets.length} persönlichen MP4-Videos wurden erfolgreich gerendert.`);
  }

  async function copyRichEmail() {
    if (!emailDraft) return false;
    let html = emailDraft.html;
    try {
      const refreshed = await fetch("/api/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          leadId: emailDraft.lead.id,
          action: "prepare",
          step: 1,
          subject: emailDraft.subject,
          body: emailDraft.body,
        }),
      });
      const payload = await refreshed.json() as { html?: string };
      if (refreshed.ok && payload.html) {
        html = payload.html;
        setEmailDraft((current) => current ? { ...current, html } : current);
      }
    } catch {
      // Keep the last valid rich version; plain text remains available as fallback.
    }
    try {
      if (typeof ClipboardItem !== "undefined" && html) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([html], { type: "text/html" }),
            "text/plain": new Blob([emailDraft.body], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(emailDraft.body);
      }
      return true;
    } catch {
      await navigator.clipboard.writeText(emailDraft.body);
      return false;
    }
  }

  async function openManualGmail() {
    if (!emailDraft) return;
    const copiedRich = await copyRichEmail();
    const gmailUrl = `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(emailDraft.lead.email)}&su=${encodeURIComponent(emailDraft.subject)}`;
    window.open(gmailUrl, "_blank", "noopener,noreferrer");
    setManualComposerOpened(true);
    showToast(copiedRich
      ? "Gmail ist offen. Füge die Rich-Mail mit Strg+V ein und sende sie."
      : "Gmail ist offen. Füge den kopierten Text ein und sende ihn.");
  }

  async function confirmManualSent() {
    if (!emailDraft || sendingEmail) return;
    const draft = emailDraft;
    setSendingEmail(true);
    try {
      const response = await fetch("/api/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: draft.lead.id, action: "mark_sent", step: 1, subject: draft.subject, body: draft.body }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Der Versandstatus konnte nicht gespeichert werden.");
      setLeads((current) => current.map((lead) => lead.id === draft.lead.id
        ? { ...lead, pipelineStage: "contacted", updated: "soeben kontaktiert" }
        : lead));
      setEmailDraft(null);
      setManualComposerOpened(false);
      const taskPayload = await fetch("/api/tasks").then((taskResponse) => taskResponse.json()) as { tasks?: typeof tasks };
      if (taskPayload.tasks) setTasks(taskPayload.tasks);
      showToast("Versand bestätigt. Die Follow-ups wurden genau einmal eingeplant.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Der Versandstatus konnte nicht gespeichert werden.");
    } finally {
      setSendingEmail(false);
    }
  }

  async function sendDirect() {
    if (!emailDraft || sendingEmail) return;
    const draft = emailDraft;
    setSendingEmail(true);
    try {
      const response = await fetch("/api/outreach", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId: draft.lead.id, action: "send", step: 1, subject: draft.subject, body: draft.body }),
      });
      const payload = await response.json() as { error?: string; alreadySent?: boolean };
      if (!response.ok) throw new Error(payload.error || "Versand fehlgeschlagen.");
      setLeads((current) => current.map((lead) => lead.id === draft.lead.id
        ? { ...lead, pipelineStage: "contacted", updated: payload.alreadySent ? "bereits versendet" : "soeben versendet" }
        : lead));
      setEmailDraft(null);
      const taskPayload = await fetch("/api/tasks").then((taskResponse) => taskResponse.json()) as { tasks?: typeof tasks };
      if (taskPayload.tasks) setTasks(taskPayload.tasks);
      showToast(payload.alreadySent ? "Diese Mail war bereits versendet; es wurde nichts doppelt gesendet." : "Rich-Mail mit GIF wurde über Gmail versendet.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Versand fehlgeschlagen.");
    } finally {
      setSendingEmail(false);
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setImporting(true);
    try {
      const text = await file.text();
      let raw: unknown;
      if (file.name.toLowerCase().endsWith(".json")) {
        raw = JSON.parse(text);
      } else {
        const parsed = Papa.parse<Record<string, unknown>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (header) => header.trim(),
        });
        if (parsed.errors.length && parsed.data.length === 0) throw new Error(parsed.errors[0].message);
        raw = parsed.data;
      }
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ raw, source: file.name }),
      });
      const payload = await response.json() as { created?: number; updated?: number; skipped?: number; error?: string };
      if (!response.ok) throw new Error(payload.error || "Import fehlgeschlagen.");
      const refreshed = await fetch("/api/leads").then((result) => result.json()) as { leads?: Record<string, unknown>[] };
      if (refreshed.leads) setLeads(refreshed.leads.map(mapApiLead));
      showToast(`${payload.created ?? 0} neue Leads, ${payload.updated ?? 0} aktualisiert.`);
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Datei konnte nicht importiert werden.");
    } finally {
      setImporting(false);
      event.target.value = "";
    }
  }

  async function completeTask(id: string) {
    await fetch("/api/tasks", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id, status: "done" }),
    });
    setTasks((current) => current.map((task) => task.id === id ? { ...task, status: "done" } : task));
    showToast("Follow-up erledigt.");
  }

  async function uploadMasterVideo(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    setUploadError("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 10 * 60 * 1000);
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error("Das Video darf maximal 80 MB groß sein.");
      const lowerName = file.name.toLowerCase();
      if (!lowerName.endsWith(".mp4") && !lowerName.endsWith(".webm")) {
        throw new Error("Bitte exportiere das Mastervideo als MP4 (H.264/AAC) oder WebM. MOV wird von Browsern nicht zuverlässig abgespielt.");
      }
      const normalizedType = lowerName.endsWith(".webm") ? "video/webm" : "video/mp4";
      const probe = document.createElement("video");
      if (!probe.canPlayType(normalizedType)) throw new Error("Dieses Videoformat kann dein Browser nicht abspielen.");
      const safeFilename = file.name.replace(/[^a-zA-Z0-9._-]+/g, "-");
      const blob = await upload(`master-videos/${Date.now()}-${safeFilename}`, file, {
        access: "private",
        handleUploadUrl: "/api/assets/upload",
        contentType: normalizedType,
        multipart: true,
        abortSignal: controller.signal,
        onUploadProgress: ({ percentage }) => setUploadProgress(Math.max(1, Math.round(percentage))),
        clientPayload: JSON.stringify({
          kind: "master_video",
          filename: file.name,
          contentType: normalizedType,
          size: file.size,
        }),
      });
      const registerResponse = await fetch("/api/assets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "master_video",
          blobUrl: blob.url,
          pathname: blob.pathname,
          filename: file.name,
          contentType: normalizedType,
          size: file.size,
        }),
      });
      if (!registerResponse.ok) {
        const payload = await registerResponse.json().catch(() => ({ error: "Video konnte nicht registriert werden." })) as { error?: string };
        throw new Error(payload.error || "Video konnte nicht registriert werden.");
      }
      setIntegrations((current) => ({ ...current, masterVideo: true }));
      setUploadProgress(100);
      showToast("Dein Mastervideo ist gespeichert und wird auf neuen Lead-Seiten verwendet.");
    } catch (error) {
      const message = error instanceof Error && error.name === "AbortError"
        ? "Der Upload wurde nach 10 Minuten abgebrochen. Bitte prüfe deine Verbindung und versuche es erneut."
        : error instanceof Error
          ? error.message
          : "Das Mastervideo konnte gerade nicht hochgeladen werden.";
      setUploadError(message);
      showToast(message);
    } finally {
      window.clearTimeout(timeout);
      setUploading(false);
      setUploadProgress(0);
      event.target.value = "";
    }
  }

  async function saveCalendar(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const response = await fetch("/api/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ calendar_embed_url: calendarUrl }),
      });
      if (!response.ok) throw new Error("Speichern fehlgeschlagen");
      setIntegrations((current) => ({ ...current, calendar: Boolean(calendarUrl.trim()) }));
      showToast("Der Kalender ist verbunden.");
    } catch {
      showToast("Der Kalender konnte gerade nicht gespeichert werden.");
    }
  }

  async function toggleAutoFollowups() {
    const next = !autoFollowups;
    if (next && !integrations.gmail) {
      showToast("Verbinde zuerst Gmail, bevor automatische Follow-ups aktiviert werden.");
      return;
    }
    if (next) {
      const health = await fetch("/api/health").then((response) => response.json()).catch(() => null) as { checks?: { cron?: { ok?: boolean } } } | null;
      if (!health?.checks?.cron?.ok) {
        showToast("Automatik bleibt aus: In Vercel fehlt noch CRON_SECRET.");
        return;
      }
    }
    const response = await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auto_followups: String(next) }),
    });
    if (!response.ok) {
      showToast("Follow-up-Modus konnte nicht gespeichert werden.");
      return;
    }
    setAutoFollowups(next);
    showToast(next ? "Automatische Follow-ups sind aktiv." : "Automatische Follow-ups sind ausgeschaltet.");
  }

  async function disconnectGmail() {
    await fetch("/api/settings", {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ auto_followups: "false" }),
    });
    const response = await fetch("/api/gmail/disconnect", { method: "DELETE" });
    if (!response.ok) {
      showToast("Gmail konnte nicht getrennt werden.");
      return;
    }
    setAutoFollowups(false);
    setIntegrations((current) => ({ ...current, gmail: false }));
    showToast("Gmail wurde getrennt; automatische Follow-ups sind aus.");
  }

  async function logout() {
    await fetch("/api/cockpit/logout", { method: "POST" });
    window.location.assign("/login");
  }

  async function copyTemplate(value: string) {
    await navigator.clipboard.writeText(value);
    showToast("Nachricht wurde kopiert.");
  }

  return (
    <main className="dashboard-shell">
      <aside className="sidebar">
        <Brand />
        <nav className="sidebar__nav" aria-label="Hauptnavigation">
          {["Übersicht", "Leads", "Studio", "Kampagnen", "Follow-ups", "Vorlagen", "Integrationen"].map((label, index) => (
            <button key={label} className={`nav-item ${activeSection === label ? "nav-item--active" : ""}`} onClick={() => navClick(label)}>
              <span className="nav-item__icon" aria-hidden="true">{["⌂", "◎", "▶", "↗", "✓", "▤", "◇"][index]}</span>
              {label}
              {label === "Follow-ups" && tasks.filter((task) => task.status === "open").length > 0 && <span className="nav-badge">{tasks.filter((task) => task.status === "open").length}</span>}
              {label === "Integrationen" && <span className="nav-item__dot" aria-label="Einrichtung offen" />}
            </button>
          ))}
        </nav>
        <div className="sidebar__spacer" />
        <SystemReadiness compact />
        <button className="profile-card" onClick={() => void logout()} title="Sicher abmelden">
          <span className="avatar avatar--small">JJ</span>
          <span><strong>JJ-Media</strong><small>Abmelden</small></span>
          <span className="profile-card__more">↗</span>
        </button>
      </aside>

      <section className="dashboard-main">
        <header className="topbar">
          <div><p className="eyebrow">JJ-Media Social Audit Engine</p><h1>{activeSection === "Übersicht" ? `Guten Tag, ${userName.split(" ")[0]}.` : activeSection}</h1></div>
          <div className="topbar__actions">
            <label className="search">
              <span aria-hidden="true">⌕</span>
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Leads durchsuchen" aria-label="Leads durchsuchen" />
              <kbd>⌘ K</kbd>
            </label>
            <label className={`button button--ghost import-button ${importing ? "is-loading" : ""}`}>{importing ? "Import läuft …" : "Importieren"}<input type="file" accept=".csv,.json,text/csv,application/json" onChange={importFile} disabled={importing} /></label>
            <button className="button button--primary" onClick={() => setShowCreate(true)}><span aria-hidden="true">＋</span> Neuer Lead</button>
          </div>
        </header>

        <div className="dashboard-content">
          {activeSection === "Übersicht" && (
            <>
          <section className="metric-grid" aria-label="Kennzahlen">
            {metrics.map((metric, index) => (
              <article className="metric-card" key={metric.label}>
                <div className="metric-card__label"><span>{metric.label}</span><span className={`metric-icon metric-icon--${index + 1}`} aria-hidden="true">{["◎", "▶", "◉", "✓"][index]}</span></div>
                <strong>{metric.value}</strong><small>{metric.note}</small>
              </article>
            ))}
          </section>

          <section className="pipeline-card">
            <div className="section-heading">
              <div><p className="eyebrow eyebrow--dark">Aktive Kampagne</p><h2>Social Media · Neukundengewinnung</h2></div>
              <div className="section-heading__actions">
                <span className="campaign-status"><span /> {integrations.gmail && autoFollowups ? "Automatisch aktiv" : "Manueller Modus"}</span>
                <button className="text-button" onClick={() => setActiveSection("Kampagnen")}>Kampagne öffnen →</button>
              </div>
            </div>
            <div className="pipeline">
              {[[String(leads.length), "Leads importiert"], [metrics[1].value, "Videos bereit"], [String(leads.filter((lead) => lead.status === "Bereit" || lead.status === "Angesehen" || lead.status === "Termin").length), "Kontakt bereit"], [metrics[2].value, "Angesehen"], [metrics[3].value, "Termin"]].map(([value, label], index) => (
                <div className="pipeline__step" key={label}>
                  <span className={`pipeline__node ${index < 4 ? "pipeline__node--done" : ""}`}>{index < 4 ? "✓" : value}</span>
                  <strong>{value}</strong><small>{label}</small>
                  {index < 4 && <span className={`pipeline__line pipeline__line--${index}`} />}
                </div>
              ))}
            </div>
          </section>

          <section className="leads-card">
            <div className="section-heading section-heading--table">
              <div><p className="eyebrow eyebrow--dark">Live-Aktivität</p><h2>Letzte Leads</h2></div>
              <button className="button button--soft" onClick={() => setActiveSection("Leads")}>Alle Leads ansehen</button>
            </div>
            <div className="table-wrap">
              <table>
                <thead><tr><th>Unternehmen</th><th>Status</th><th>Watchtime</th><th>Aktualisiert</th><th><span className="sr-only">Aktion</span></th></tr></thead>
                <tbody>
                  {filteredLeads.map((lead) => (
                    <tr key={lead.id}>
                      <td><div className="lead-company"><span className="company-mark">{lead.company.split(" ").slice(0, 2).map((word) => word[0]).join("")}</span><span><strong>{lead.company}</strong><small>{lead.contact} · {lead.url}</small></span></div></td>
                      <td><span className={statusClass(lead.status)}><i />{lead.status}</span></td>
                      <td><strong className="watchtime">{lead.watch}</strong></td>
                      <td><span className="muted">{lead.updated}</span></td>
                      <td><div className="row-actions"><button className="icon-button" onClick={() => generateLeadVideo(lead)} aria-label={`Video für ${lead.company} erstellen`}>▶</button><button className="icon-button" onClick={() => prepareEmail(lead)} aria-label={`E-Mail an ${lead.company} vorbereiten`}>✉</button><a className="icon-button" href={`/v/${lead.slug}`} aria-label={`Landingpage für ${lead.company} öffnen`}>↗</a></div></td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {filteredLeads.length === 0 && <div className="empty-state">Kein Lead passt zu deiner Suche.</div>}
            </div>
          </section>
            </>
          )}

          {activeSection === "Leads" && (
            <section className="workspace-page">
              <div className="workspace-heading">
                <div><p className="eyebrow eyebrow--dark">Datenbank</p><h2>Alle Leads</h2><p>Vom Instagram-Profil bis zum Termin – mit echtem Status und allen Aktionen.</p></div>
                <div className="workspace-actions">
                  {selectedLeadIds.length > 0 && <button className="button button--soft" onClick={() => void generateSelectedLeads()} disabled={Boolean(batchProgress)}>{batchProgress ? `${batchProgress.current} / ${batchProgress.total} werden erstellt …` : `${selectedLeadIds.length} Videos vorbereiten`}</button>}
                  <label className={`button button--ghost import-button ${importing ? "is-loading" : ""}`}>{importing ? "Import läuft …" : "CSV / JSON importieren"}<input type="file" accept=".csv,.json,text/csv,application/json" onChange={importFile} disabled={importing} /></label>
                  <button className="button button--primary" onClick={() => setShowCreate(true)}>＋ Lead hinzufügen</button>
                </div>
              </div>
              <div className="workspace-toolbar">
                <label className="search search--wide"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Firma, Kontakt, Instagram oder Status" /></label>
                <span>{filteredLeads.length} Leads · {selectedLeadIds.length} ausgewählt</span>
              </div>
              <div className="leads-card leads-card--page">
                <div className="table-wrap">
                  <table>
                    <thead><tr><th><input type="checkbox" aria-label="Alle sichtbaren Leads auswählen" checked={filteredLeads.length > 0 && filteredLeads.every((lead) => selectedLeadIds.includes(lead.id))} onChange={(event) => setSelectedLeadIds(event.target.checked ? Array.from(new Set([...selectedLeadIds, ...filteredLeads.map((lead) => lead.id)])) : selectedLeadIds.filter((id) => !filteredLeads.some((lead) => lead.id === id)))} /> Unternehmen</th><th>E-Mail</th><th>Status</th><th>Watchtime</th><th>Aktionen</th></tr></thead>
                    <tbody>
                      {filteredLeads.map((lead) => (
                        <tr key={lead.id}>
                          <td><div className="lead-company"><input type="checkbox" aria-label={`${lead.company} auswählen`} checked={selectedLeadIds.includes(lead.id)} onChange={(event) => setSelectedLeadIds((current) => event.target.checked ? [...current, lead.id] : current.filter((id) => id !== lead.id))} /><span className="company-mark">{lead.company.split(" ").slice(0, 2).map((word) => word[0]).join("")}</span><span><strong>{lead.company}</strong><small>{lead.contact} · {lead.url}</small></span></div></td>
                          <td><span className="muted">{lead.email || "Fehlt noch"}</span></td>
                          <td><span className={statusClass(lead.status)}><i />{lead.status}</span></td>
                          <td><strong className="watchtime">{lead.watch}</strong></td>
                          <td><div className="table-action-group"><button onClick={() => setSelectedLeadId(lead.id)}>CRM</button><Link href={`/dashboard/whatsapp?lead=${lead.id}`}>WhatsApp</Link><button onClick={() => generateLeadVideo(lead)} disabled={lead.videoStatus === "processing"}>{lead.videoStatus === "processing" ? "Erstellt …" : lead.videoStatus === "ready" ? "Video neu" : "Video erstellen"}</button><label className="table-upload-action">{uploadingProfileId === lead.id ? "Upload …" : "IG-Screenshot"}<input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => void uploadProfileScreenshot(lead, event)} disabled={Boolean(uploadingProfileId)} /></label><button onClick={() => prepareEmail(lead)}>Gmail</button><a href={`/v/${lead.slug}`} target="_blank" rel="noreferrer">LP öffnen</a></div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </section>
          )}

          {activeSection === "Studio" && (
            <LandingStudio
              leads={leads.map((lead) => ({ id: lead.id, company: lead.company, slug: lead.slug }))}
              notify={showToast}
            />
          )}

          {activeSection === "Kampagnen" && (
            <section className="workspace-page">
              <div className="workspace-heading"><div><p className="eyebrow eyebrow--dark">Aktive Sequenz</p><h2>Social Media · Neukundengewinnung</h2><p>Ein klarer Drei-Kontakt-Prozess statt wahlloser Massenmails.</p></div><span className="campaign-status"><span /> {integrations.gmail && autoFollowups ? "Automatisch aktiv" : "Manueller Modus"}</span></div>
              <div className="campaign-layout">
                <div className="sequence sequence--page">
                  <article><span>Tag 0</span><div><strong>Persönliche Social-Media-Analyse</strong><small>Individuelle Seite mit Instagram-Profil, JJ-Media Video und Kalender.</small></div><b>Aktiv</b></article>
                  <article><span>Tag 2</span><div><strong>Relevanz-Follow-up</strong><small>Kurze Nachfrage, ob das Video bereits angesehen wurde.</small></div><b>{autoFollowups ? "Automatisch" : "Nach Versand geplant"}</b></article>
                  <article><span>Tag 5</span><div><strong>Permission Close</strong><small>Einfacher Ausstieg oder klarer nächster Schritt.</small></div><b>{autoFollowups ? "Automatisch" : "Nach Versand geplant"}</b></article>
                </div>
                <aside className="daily-target">
                  <p className="eyebrow eyebrow--orange">Aktueller Bestand</p><h3>Live-Daten aus deinem Cockpit</h3>
                  {[[String(leads.length), "Leads"], [String(leads.filter((lead) => lead.videoStatus === "ready").length), "fertige Videos"], [String(leads.filter((lead) => lead.pipelineStage !== "new").length), "kontaktierte Leads"], [String(tasks.filter((task) => task.status === "open").length), "offene Follow-ups"]].map(([value, label]) => <div key={label}><strong>{value}</strong><span>{label}</span></div>)}
                  <button className="button button--primary button--wide" onClick={() => setActiveSection("Leads")}>Mit Leads starten →</button>
                </aside>
              </div>
            </section>
          )}

          {activeSection === "Follow-ups" && (
            <section className="workspace-page">
              <div className="workspace-heading"><div><p className="eyebrow eyebrow--dark">Heute relevant</p><h2>Follow-up-Zentrale</h2><p>Alle fälligen Nachfassaktionen in einer klaren Arbeitsliste.</p></div><span className="task-counter">{tasks.filter((task) => task.status === "open").length} offen</span></div>
              <div className="task-list task-list--page">
                {tasks.filter((task) => task.status === "open").map((task) => (
                  <article className="task-item" key={task.id}>
                    <span className={`priority-dot priority-dot--${task.priority}`} />
                    <div><strong>{task.title}</strong><small>{task.dueAt ? new Date(task.dueAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "Ohne Termin"}</small></div>
                    <button className="button button--soft" onClick={() => completeTask(task.id)}>Als erledigt markieren</button>
                  </article>
                ))}
                {tasks.filter((task) => task.status === "open").length === 0 && <div className="empty-workspace"><span>✓</span><h3>Alles erledigt</h3><p>Sobald du eine Erstnachricht öffnest, plant das System die nächsten Schritte hier ein.</p></div>}
              </div>
            </section>
          )}

          {activeSection === "Vorlagen" && (
            <section className="workspace-page">
              <div className="workspace-heading"><div><p className="eyebrow eyebrow--dark">Nachrichten</p><h2>Vorlagen & Personalisierung</h2><p>Diese Texte werden für jeden Lead automatisch mit Name, Unternehmen und Videolink ergänzt.</p></div><button className="button button--primary" onClick={saveTemplates}>Änderungen speichern</button></div>
              <div className="template-editor-grid">
                <label className="editor-card"><span>Betreffzeile</span><input value={emailSubject} onChange={(event) => setEmailSubject(event.target.value)} /><small>{"{{unternehmen}}"} und {"{{vorname}}"} werden automatisch ersetzt.</small></label>
                <label className="editor-card editor-card--wide"><span>Erstkontakt · Tag 0</span><textarea rows={10} value={emailBody} onChange={(event) => setEmailBody(event.target.value)} /></label>
                <label className="editor-card"><span>Follow-up 1 · Tag 2</span><textarea rows={9} value={followupOne} onChange={(event) => setFollowupOne(event.target.value)} /></label>
                <label className="editor-card"><span>Follow-up 2 · Tag 5</span><textarea rows={9} value={followupTwo} onChange={(event) => setFollowupTwo(event.target.value)} /></label>
              </div>
            </section>
          )}

          {activeSection === "Integrationen" && (
            <section className="workspace-page">
              <div className="workspace-heading"><div><p className="eyebrow eyebrow--dark">Produktionsstrecke</p><h2>Integrationen</h2><p>Hier richtest du alle Bausteine einmal ein und siehst sofort, was einsatzbereit ist.</p></div></div>
              <SystemReadiness />
              <div className="integration-grid">
                <article className="integration-item integration-item--page">
                  <div className="integration-item__head"><span className="integration-logo">FREE</span><div><strong>Instagram-Profilaufnahme</strong><small>Automatischer Profil-Screenshot mit sanfter Bewegung</small></div><span className="integration-state integration-state--ready">Bereit</span></div>
                  <p>Das öffentliche Instagram-Profil wird automatisch aufgenommen und im persönlichen Video animiert. Bei einer Login-Sperre kann ein echter Screenshot hochgeladen werden.</p>
                </article>
                <article className="integration-item integration-item--page">
                  <div className="integration-item__head"><span className="integration-logo integration-logo--video">▶</span><div><strong>JJ-Media Mastervideo</strong><small>Einmal hochladen, überall verwenden</small></div><span className={`integration-state ${integrations.masterVideo ? "integration-state--ready" : ""}`}>{integrations.masterVideo ? "Bereit" : "Offen"}</span></div>
                  <p>MP4 (H.264/AAC) oder WebM bis 80 MB. Große Dateien werden automatisch in Teilen übertragen.</p>
                  <label className={`upload-button ${uploading ? "upload-button--loading" : ""}`}><input type="file" accept="video/mp4,video/webm" onChange={uploadMasterVideo} disabled={uploading} />{uploading ? `Video wird hochgeladen … ${uploadProgress} %` : integrations.masterVideo ? "Mastervideo ersetzen" : "Mastervideo hochladen"}</label>
                  {uploadError && <p className="upload-error">{uploadError}</p>}
                </article>
                <article className="integration-item integration-item--page">
                  <div className="integration-item__head"><span className="integration-logo integration-logo--calendar">31</span><div><strong>Kalender</strong><small>Calendly, Cal.com oder TidyCal</small></div><span className={`integration-state ${integrations.calendar ? "integration-state--ready" : ""}`}>{integrations.calendar ? "Verbunden" : "Offen"}</span></div>
                  <p>Der Kalender wird direkt neben dem Video eingebettet.</p>
                  <form className="calendar-form" onSubmit={saveCalendar}><input type="url" value={calendarUrl} onChange={(event) => setCalendarUrl(event.target.value)} placeholder="https://cal.com/jj-media/15min" /><button className="button button--primary" type="submit">Speichern</button></form>
                </article>
                <article className="integration-item integration-item--page">
                  <div className="integration-item__head"><span className="integration-logo integration-logo--gmail">M</span><div><strong>Gmail</strong><small>OAuth-Verbindung für echten API-Versand</small></div><span className={`integration-state ${integrations.gmail ? "integration-state--ready" : ""}`}>{integrations.gmail ? "Verbunden" : "Nicht verbunden"}</span></div>
                  <p>{integrations.gmail ? "Rich-Mails werden erst nach deiner bewussten Bestätigung versendet. Folgekontakte können optional automatisiert werden." : "Verbinde genau das Google-Konto, von dem deine Outbound-Mails versendet werden sollen."}</p>
                  <div className="email-preview__actions">
                    {integrations.gmail
                      ? <button className="button button--ghost" onClick={() => void disconnectGmail()}>Gmail trennen</button>
                      : <a className="button button--primary" href="/api/gmail/connect">Gmail sicher verbinden</a>}
                    <button className={`button ${autoFollowups ? "button--primary" : "button--soft"}`} onClick={() => void toggleAutoFollowups()} disabled={!integrations.gmail}>
                      {autoFollowups ? "✓ Auto-Follow-ups aktiv" : "Auto-Follow-ups einschalten"}
                    </button>
                  </div>
                </article>
              </div>
            </section>
          )}
        </div>
      </section>

      {showCreate && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCreate(false)}>
          <section className="create-panel" role="dialog" aria-modal="true" aria-labelledby="new-lead-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCreate(false)} aria-label="Schließen">×</button>
            <p className="eyebrow eyebrow--orange">Neue Personalisierung</p>
            <h2 id="new-lead-title">Lead zur Pipeline hinzufügen</h2>
            <p className="panel-intro">Speichere den Lead zuerst. Das Video wird ausschließlich nach deinem separaten Klick erstellt.</p>
            <form onSubmit={addLead}>
              <label>Unternehmen<input name="company" placeholder="z. B. Musterbrand GmbH" required autoFocus /></label>
              <label>Ansprechpartner<input name="contact" placeholder="z. B. Frau Weber" /></label>
              <label>E-Mail<input name="email" type="email" placeholder="weber@mustermann.de" /></label>
              <label>Instagram-Profil<input name="url" type="text" placeholder="@mustermann oder https://instagram.com/mustermann" required /></label>
              <div className="panel-info"><span className="live-dot" />Kein automatischer Start: Du entscheidest anschließend, für welche Leads gerendert wird.</div>
              <button className="button button--primary button--wide" type="submit">Lead speichern →</button>
            </form>
          </section>
        </div>
      )}

      {selectedLeadId && (
        <LeadCrmPanel
          leadId={selectedLeadId}
          onClose={() => setSelectedLeadId(null)}
          onUpdated={(updated) => {
            setLeads((current) => current.map((lead) => lead.id === updated.id ? mapApiLead(updated) : lead));
          }}
        />
      )}

      {showIntegrations && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowIntegrations(false)}>
          <section className="create-panel integration-panel" role="dialog" aria-modal="true" aria-labelledby="integration-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowIntegrations(false)} aria-label="Schließen">×</button>
            <p className="eyebrow eyebrow--orange">Einmal einrichten</p>
            <h2 id="integration-title">Deine Produktionsstrecke</h2>
            <p className="panel-intro">Drei Bausteine reichen aus, damit aus einem Instagram-Profil automatisch eine fertige persönliche Social-Audit-Seite wird.</p>

            <div className="integration-list">
              <article className="integration-item">
                <div className="integration-item__head">
                  <span className="integration-logo">FREE</span>
                  <div><strong>Instagram-Profil</strong><small>Automatische Aufnahme + Screenshot-Fallback</small></div>
                  <span className="integration-state integration-state--ready">Bereit</span>
                </div>
                <p>Zeigt das echte Instagram-Profil als animierte Aufnahme. Falls Instagram den Browser blockiert, lässt sich pro Lead ein Screenshot hinterlegen.</p>
              </article>

              <article className="integration-item">
                <div className="integration-item__head">
                  <span className="integration-logo integration-logo--video">▶</span>
                  <div><strong>JJ-Media Mastervideo</strong><small>Ein Video für alle Leads</small></div>
                  <span className={`integration-state ${integrations.masterVideo ? "integration-state--ready" : ""}`}>{integrations.masterVideo ? "Bereit" : "Offen"}</span>
                </div>
                <p>Das JJ-Media Mastervideo läuft synchron als runder Sprecher-Overlay über dem jeweiligen Instagram-Profil.</p>
                <label className={`upload-button ${uploading ? "upload-button--loading" : ""}`}>
                  <input type="file" accept="video/mp4,video/webm" onChange={uploadMasterVideo} disabled={uploading} />
                  {uploading ? `Video wird hochgeladen … ${uploadProgress} %` : integrations.masterVideo ? "Mastervideo ersetzen" : "Mastervideo hochladen"}
                </label>
              </article>

              <article className="integration-item">
                <div className="integration-item__head">
                  <span className="integration-logo integration-logo--calendar">31</span>
                  <div><strong>Termin-Kalender</strong><small>Calendly, Cal.com oder TidyCal</small></div>
                  <span className={`integration-state ${integrations.calendar ? "integration-state--ready" : ""}`}>{integrations.calendar ? "Verbunden" : "Offen"}</span>
                </div>
                <p>Die Buchung bleibt direkt neben dem Video sichtbar. Hinterlege dafür deine öffentliche Kalender-URL.</p>
                <form className="calendar-form" onSubmit={saveCalendar}>
                  <input type="url" value={calendarUrl} onChange={(event) => setCalendarUrl(event.target.value)} placeholder="https://cal.com/jj-media/15min" />
                  <button className="button button--primary" type="submit">Speichern</button>
                </form>
              </article>
            </div>

            <div className="flow-summary">
              <span>Instagram einfügen</span><i>→</i><span>Profilaufnahme</span><i>→</i><span>Persönliche LP</span><i>→</i><span>Termin</span>
            </div>
          </section>
        </div>
      )}

      {showTemplates && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowTemplates(false)}>
          <section className="create-panel integration-panel" role="dialog" aria-modal="true" aria-labelledby="template-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowTemplates(false)} aria-label="Schließen">×</button>
            <p className="eyebrow eyebrow--orange">Outbound-Nachrichten</p>
            <h2 id="template-title">Kurz, ehrlich und neugierig machend</h2>
            <p className="panel-intro">Die Personalisierung steckt im Firmennamen, dem echten Instagram-Profil und der individuellen URL. Die Nachricht behauptet bewusst nicht, dass jedes Video von Hand aufgenommen wurde.</p>

            <article className="message-template">
              <div className="message-template__head">
                <span>E-Mail · Erstkontakt</span>
                <button onClick={() => copyTemplate("Betreff: Social-Media-Analyse für {{unternehmen}}\\n\\nHallo {{vorname}},\\n\\nich bin gerade auf das Instagram-Profil von {{unternehmen}} gestoßen. Weil bereits eine gute Basis da ist, habe ich drei konkrete Social-Media-Hebel kurz im Video zusammengefasst.\\n\\nHier ist die Analyse: {{video_link}}\\n\\nWenn du darin Potenzial siehst, kannst du direkt daneben einen unverbindlichen 15-Minuten-Termin wählen.\\n\\nViele Grüße\\nJJ-Media")}>Kopieren</button>
              </div>
              <div className="subject-line"><small>Betreff</small><strong>Social-Media-Analyse für {"{{unternehmen}}"}</strong></div>
              <div className="message-copy">
                Hallo {"{{vorname}}"},
                <br /><br />
                ich bin gerade auf das Instagram-Profil von {"{{unternehmen}}"} gestoßen. Weil bereits eine gute Basis da ist, habe ich kurz gezeigt, welche drei Social-Media-Hebel aktuell am meisten Potenzial haben.
                <br /><br />
                Hier ist das Video: <span>{"{{video_link}}"}</span>
                <br /><br />
                Wenn du darin Potenzial siehst, kannst du direkt neben dem Video einen unverbindlichen 15-Minuten-Termin wählen.
                <br /><br />
                Viele Grüße<br />JJ-Media
              </div>
            </article>

            <article className="message-template message-template--compact">
              <div className="message-template__head">
                <span>LinkedIn / Instagram · Kurz</span>
                <button onClick={() => copyTemplate("Hi {{vorname}}, ich bin gerade auf das Instagram-Profil von {{unternehmen}} gestoßen und habe dir drei konkrete Social-Media-Hebel gezeigt: {{video_link}} – wenn es relevant ist, kannst du direkt daneben einen kurzen Termin wählen. LG JJ-Media")}>Kopieren</button>
              </div>
              <div className="message-copy">Hi {"{{vorname}}"}, ich bin gerade auf das Instagram-Profil von {"{{unternehmen}}"} gestoßen und habe dir drei konkrete Social-Media-Hebel gezeigt: <span>{"{{video_link}}"}</span> – wenn es relevant ist, kannst du direkt daneben einen kurzen Termin wählen. LG JJ-Media</div>
            </article>

            <div className="template-note"><strong>Wichtiger Hebel:</strong> Nicht in der Nachricht alles verkaufen. Ihr einziger Job ist, den Klick auf die persönliche Videoseite auszulösen.</div>
          </section>
        </div>
      )}

      {emailDraft && (
        <div className="modal-backdrop modal-backdrop--center" role="presentation" onMouseDown={() => setEmailDraft(null)}>
          <section className="email-preview" role="dialog" aria-modal="true" aria-labelledby="email-preview-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setEmailDraft(null)} aria-label="Schließen">×</button>
            <p className="eyebrow eyebrow--orange">Gmail-Entwurf</p>
            <h2 id="email-preview-title">Persönliche Nachricht an {emailDraft.lead.company}</h2>
            <div className="email-field"><small>An</small><strong>{emailDraft.lead.email}</strong></div>
            <div className="email-field"><small>Betreff</small><strong>{emailDraft.subject}</strong></div>
            <textarea value={emailDraft.body} onChange={(event) => setEmailDraft({ ...emailDraft, body: event.target.value })} rows={10} aria-label="E-Mail-Text" />
            <a className="email-video-preview" href={emailDraft.friendlyVideoUrl} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={emailDraft.previewImageUrl} alt={`Video-Vorschau für ${emailDraft.lead.company}`} />
              <span>Persönliches Video ansehen →</span>
            </a>
            <div className="email-preview__actions">
              <button className="button button--ghost" onClick={() => void copyRichEmail().then(() => showToast("Rich-Mail inklusive GIF kopiert."))}>Rich-Mail kopieren</button>
              {integrations.gmail && <button className="button button--primary" onClick={() => void sendDirect()} disabled={sendingEmail}>{sendingEmail ? "Wird gesendet …" : "Jetzt über Gmail senden →"}</button>}
              {!integrations.gmail && !manualComposerOpened && <button className="button button--primary" onClick={() => void openManualGmail()}>Kopieren & Gmail öffnen →</button>}
              {!integrations.gmail && manualComposerOpened && <button className="button button--primary" onClick={() => void confirmManualSent()} disabled={sendingEmail}>{sendingEmail ? "Wird gespeichert …" : "Ich habe die Mail gesendet ✓"}</button>}
            </div>
            <p className="security-note">{integrations.gmail ? "Der API-Versand erfolgt genau einmal. Erst danach werden CRM-Status und Follow-ups gesetzt." : manualComposerOpened ? "Bestätige den Versand erst, nachdem du in Gmail wirklich auf Senden geklickt hast." : "Gmail öffnet sich leer. Drücke dort Strg+V; GIF-Vorschau, Play-Button und Link werden gemeinsam eingefügt."}</p>
          </section>
        </div>
      )}

      {showTasks && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowTasks(false)}>
          <section className="create-panel integration-panel" role="dialog" aria-modal="true" aria-labelledby="tasks-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowTasks(false)} aria-label="Schließen">×</button>
            <p className="eyebrow eyebrow--orange">Heute relevant</p>
            <h2 id="tasks-title">Follow-up-Zentrale</h2>
            <p className="panel-intro">Keine interessierten Leads mehr vergessen. Arbeite die Liste von oben nach unten ab.</p>
            <div className="task-list">
              {tasks.filter((task) => task.status === "open").map((task) => (
                <article className="task-item" key={task.id}>
                  <span className={`priority-dot priority-dot--${task.priority}`} />
                  <div><strong>{task.title}</strong><small>{task.dueAt ? new Date(task.dueAt).toLocaleString("de-DE", { dateStyle: "medium", timeStyle: "short" }) : "Ohne Termin"}</small></div>
                  <button className="button button--soft" onClick={() => completeTask(task.id)}>Erledigt</button>
                </article>
              ))}
              {tasks.filter((task) => task.status === "open").length === 0 && <div className="empty-state">Aktuell sind keine Follow-ups offen.</div>}
            </div>
          </section>
        </div>
      )}

      {showCampaign && (
        <div className="modal-backdrop" role="presentation" onMouseDown={() => setShowCampaign(false)}>
          <section className="create-panel integration-panel" role="dialog" aria-modal="true" aria-labelledby="campaign-title" onMouseDown={(event) => event.stopPropagation()}>
            <button className="modal-close" onClick={() => setShowCampaign(false)} aria-label="Schließen">×</button>
            <p className="eyebrow eyebrow--orange">Aktive Kampagne</p>
            <h2 id="campaign-title">Social Media · Neukundengewinnung</h2>
            <p className="panel-intro">Ein fokussierter Drei-Kontakt-Prozess: persönliches Video, wertorientiertes Follow-up und sauberer Abschluss.</p>
            <div className="sequence">
              <article><span>Tag 0</span><div><strong>Persönliche Social-Media-Analyse</strong><small>Kurze Nachricht mit individueller Social-Audit-Seite</small></div><b>Aktiv</b></article>
              <article><span>Tag 2</span><div><strong>Relevanz-Follow-up</strong><small>Kurze Nachfrage ohne erneuten Pitch</small></div><b>{autoFollowups && integrations.gmail ? "Automatisch" : "Nach Versand geplant"}</b></article>
              <article><span>Tag 5</span><div><strong>Permission Close</strong><small>„Später“ oder „nicht relevant“ als einfache Antwort</small></div><b>{autoFollowups && integrations.gmail ? "Automatisch" : "Nach Versand geplant"}</b></article>
            </div>
            <div className="campaign-goal"><small>Live-Status</small><strong>{leads.length} Leads · {leads.filter((lead) => lead.videoStatus === "ready").length} fertige Videos · {tasks.filter((task) => task.status === "open").length} offene Follow-ups</strong></div>
          </section>
        </div>
      )}
      {toast && <div className="toast" role="status">{toast}</div>}
    </main>
  );
}
