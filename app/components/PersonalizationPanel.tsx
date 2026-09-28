"use client";

import { useEffect, useState } from "react";
import styles from "./PersonalizationPanel.module.css";

type Personalization = {
  version: number;
  status: "draft" | "approved" | "locked";
  angle: string;
  hook: string;
  subject: string;
  emailBody: string;
  landingEyebrow: string;
  landingHeadline: string;
  landingSubheadline: string;
  videoHook: string;
  cta: string;
  factIds: string[];
  lockedFields: string[];
  rationale: string;
  generatedBy: string;
  generatedAt: string;
};

const fields = [
  ["hook", "Hook"],
  ["subject", "Betreff"],
  ["emailBody", "E-Mail"],
  ["landingHeadline", "Landingpage Headline"],
  ["landingSubheadline", "Landingpage Subline"],
  ["videoHook", "Video-Hook"],
] as const;

export default function PersonalizationPanel({ leadId }: { leadId: string }) {
  const [data, setData] = useState<Personalization | null>(null);
  const [busy, setBusy] = useState("");
  const [selected, setSelected] = useState<string>("hook");

  async function load() {
    const response = await fetch("/api/personalization?leadId=" + encodeURIComponent(leadId), { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    setData(payload.personalization || null);
  }

  useEffect(() => { void load(); }, [leadId]);

  async function act(body: Record<string, unknown>, key: string) {
    if (busy) return;
    setBusy(key);
    try {
      const response = await fetch("/api/personalization", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId, ...body }),
      });
      if (response.ok) {
        const payload = await response.json();
        setData(payload.personalization || null);
      }
    } finally {
      setBusy("");
    }
  }

  if (!data) {
    return (
      <section className={styles.shell}>
        <div className={styles.head}>
          <div><small>PERSONALIZATION ENGINE</small><h3>Noch keine Personalisierung erstellt</h3></div>
          <button disabled={Boolean(busy)} onClick={() => void act({ action: "generate" }, "generate")}>{busy ? "Erstellt …" : "Jetzt erstellen"}</button>
        </div>
      </section>
    );
  }

  const value = String(data[selected as keyof Personalization] ?? "");
  const locked = data.lockedFields.includes(selected);

  return (
    <section className={styles.shell}>
      <div className={styles.head}>
        <div>
          <small>PERSONALIZATION ENGINE · V{data.version}</small>
          <h3>Ein Angle. Alle Kanäle konsistent.</h3>
        </div>
        <div className={styles.topActions}>
          <button disabled={Boolean(busy)} onClick={() => void act({ action: "generate" }, "generate")}>Neu generieren</button>
          <button data-primary="true" disabled={Boolean(busy)} onClick={() => void act({ action: "approve" }, "approve")}>{data.status === "approved" ? "Freigegeben ✓" : "Freigeben"}</button>
        </div>
      </div>

      <div className={styles.angle}>
        <small>ANGLE</small>
        <strong>{data.angle}</strong>
        <p>{data.rationale}</p>
      </div>

      <div className={styles.tabs}>
        {fields.map(([key, label]) => (
          <button key={key} data-active={selected === key} onClick={() => setSelected(key)}>
            {label}{data.lockedFields.includes(key) ? " 🔒" : ""}
          </button>
        ))}
      </div>

      <div className={styles.editor}>
        {selected === "emailBody" || selected === "landingSubheadline"
          ? <textarea value={value} rows={selected === "emailBody" ? 10 : 5} onChange={(event) => setData({ ...data, [selected]: event.target.value })} />
          : <input value={value} onChange={(event) => setData({ ...data, [selected]: event.target.value })} />}
        <div>
          <span>{data.factIds.length} freigegebene Facts verwendet · {data.generatedBy}</span>
          <div className={styles.editorActions}>
            <button disabled={Boolean(busy)} onClick={() => void act({ action: "toggle_lock", field: selected }, "lock")}>{locked ? "Entsperren" : "Gegen KI sperren"}</button>
            <button data-primary="true" disabled={Boolean(busy)} onClick={() => void act({ action: "update", field: selected, value }, "save")}>Speichern</button>
          </div>
        </div>
      </div>
    </section>
  );
}
