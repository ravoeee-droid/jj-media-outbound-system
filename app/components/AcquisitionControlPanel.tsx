"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./AcquisitionControlPanel.module.css";

type Mode = "manual" | "copilot" | "autopilot";
type StepState = "done" | "ready" | "open" | "blocked" | "skipped";
type Payload = {
  effectiveMode: Mode;
  recommendedStep: string;
  control: { modeOverride: Mode | null; lockedSteps: string[]; skippedSteps: string[]; currentStep: string };
  steps: Array<{ key: string; status: StepState; locked: boolean }>;
};

const labels: Record<string, string> = {
  research: "Recherche",
  enrichment: "Kontakt",
  validation: "Validieren",
  scoring: "Scoring",
  angle: "Angle",
  screenshot: "Screenshot",
  video: "Video",
  landing: "Landingpage",
  email: "E-Mail",
  sequence: "Sequenz",
  reply: "Antwort",
  booking: "Termin",
  attribution: "Umsatz",
};

const modeCopy: Record<Mode, string> = {
  manual: "Du löst jeden Schritt selbst aus.",
  copilot: "KI bereitet vor, Mitarbeiter entscheidet.",
  autopilot: "Freigegebene sichere Schritte laufen automatisch.",
};

export default function AcquisitionControlPanel({ leadId }: { leadId: string }) {
  const [data, setData] = useState<Payload | null>(null);
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState("");

  async function load() {
    const response = await fetch("/api/acquisition-control?leadId=" + encodeURIComponent(leadId), { cache: "no-store" });
    const payload = await response.json();
    if (response.ok) {
      setData(payload);
      setSelected((current) => current || payload.recommendedStep || "");
    }
  }

  useEffect(() => { void load(); }, [leadId]);

  async function mutate(body: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    try {
      const response = await fetch("/api/acquisition-control", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (response.ok) await load();
    } finally {
      setBusy("");
    }
  }

  const selectedStep = useMemo(() => data?.steps.find((step) => step.key === selected), [data, selected]);
  if (!data) return <section className={styles.shell}><div className={styles.loading}>Akquise-Steuerung wird geladen …</div></section>;

  return (
    <section className={styles.shell}>
      <div className={styles.head}>
        <div>
          <small>ACQUISITION CONTROL</small>
          <h3>Einfach arbeiten. Volle Kontrolle behalten.</h3>
        </div>
        <div className={styles.modes}>
          {(["manual", "copilot", "autopilot"] as Mode[]).map((mode) => (
            <button
              key={mode}
              data-active={data.effectiveMode === mode}
              disabled={Boolean(busy)}
              onClick={() => void mutate({ action: "set_lead_mode", leadId, mode }, "mode-" + mode)}
            >
              {mode === "manual" ? "Manual" : mode === "copilot" ? "Copilot" : "Autopilot"}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.guide}>
        <span>EMPFOHLENER NÄCHSTER SCHRITT</span>
        <strong>{labels[data.recommendedStep] || data.recommendedStep}</strong>
        <p>{modeCopy[data.effectiveMode]}</p>
      </div>

      <div className={styles.steps}>
        {data.steps.map((step, index) => (
          <button
            key={step.key}
            className={selected === step.key ? styles.selected : ""}
            data-status={step.status}
            data-locked={step.locked}
            onClick={() => setSelected(step.key)}
          >
            <i>{step.status === "done" ? "✓" : step.locked ? "🔒" : index + 1}</i>
            <span>{labels[step.key] || step.key}</span>
            <small>{step.status === "done" ? "Fertig" : step.status === "ready" ? "Bereit" : step.status === "blocked" ? "Fehlt etwas" : step.status === "skipped" ? "Übersprungen" : "Offen"}</small>
          </button>
        ))}
      </div>

      {selectedStep && (
        <div className={styles.detail}>
          <div>
            <small>AUSGEWÄHLTER STEP</small>
            <strong>{labels[selectedStep.key] || selectedStep.key}</strong>
            <span>{selectedStep.locked ? "KI darf diesen Step nicht verändern." : "Dieser Step ist frei bearbeitbar."}</span>
          </div>
          <div className={styles.detailActions}>
            <button disabled={Boolean(busy)} onClick={() => void mutate({ action: "set_current_step", leadId, step: selectedStep.key }, "current")}>Als Nächstes</button>
            <button disabled={Boolean(busy)} onClick={() => void mutate({ action: "toggle_lock", leadId, step: selectedStep.key }, "lock")}>{selectedStep.locked ? "Entsperren" : "Sperren"}</button>
            <button disabled={Boolean(busy)} onClick={() => void mutate({ action: "toggle_skip", leadId, step: selectedStep.key }, "skip")}>{selectedStep.status === "skipped" ? "Wieder aktivieren" : "Überspringen"}</button>
          </div>
        </div>
      )}
    </section>
  );
}
