"use client";

import { useEffect, useState } from "react";
import styles from "./LeadIntelligencePanel.module.css";

type Score = {
  fitScore: number;
  painScore: number;
  timingScore: number;
  reachabilityScore: number;
  valueScore: number;
  confidenceScore: number;
  totalScore: number;
  recommendedAngle: string;
  rationale: string;
};
type Signal = { id: string; signalKey: string; signalType: string; strength: number; confidence: number; title: string; detail: string; sourceUrl: string };

export default function LeadIntelligencePanel({ leadId }: { leadId: string }) {
  const [score, setScore] = useState<Score | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [busy, setBusy] = useState(false);

  async function load() {
    const response = await fetch("/api/acquisition-intelligence?leadId=" + encodeURIComponent(leadId), { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    setScore(payload.score || null);
    setSignals(payload.signals || []);
  }

  useEffect(() => { void load(); }, [leadId]);

  async function refresh() {
    if (busy) return;
    setBusy(true);
    try {
      const response = await fetch("/api/acquisition-intelligence", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      if (response.ok) {
        const payload = await response.json();
        setScore(payload.score || null);
        setSignals(payload.signals || []);
      }
    } finally {
      setBusy(false);
    }
  }

  const dimensions = score ? [
    ["Fit", score.fitScore],
    ["Pain", score.painScore],
    ["Timing", score.timingScore],
    ["Erreichbar", score.reachabilityScore],
    ["Wert", score.valueScore],
    ["Confidence", score.confidenceScore],
  ] as const : [];

  return (
    <section className={styles.shell}>
      <div className={styles.head}>
        <div><small>SIGNAL RADAR · ICP BRAIN</small><h3>{score ? "Lead Score " + score.totalScore + "/100" : "Noch nicht analysiert"}</h3></div>
        <button disabled={busy} onClick={() => void refresh()}>{busy ? "Analysiert …" : score ? "Neu analysieren" : "Jetzt analysieren"}</button>
      </div>

      {score && (
        <>
          <div className={styles.metrics}>
            {dimensions.map(([label, value]) => <div key={label}><span>{label}</span><strong>{value}</strong><i><b style={{ width: value + "%" }} /></i></div>)}
          </div>
          <div className={styles.angle}><small>EMPFOHLENER ANGLE</small><strong>{score.recommendedAngle}</strong><p>{score.rationale}</p></div>
        </>
      )}

      <div className={styles.signals}>
        {signals.length ? signals.slice(0, 6).map((signal) => (
          <article key={signal.id}>
            <div><strong>{signal.title}</strong><small>{signal.signalType} · Stärke {signal.strength} · {signal.confidence}% sicher</small></div>
            <p>{signal.detail}</p>
            {signal.sourceUrl && <a href={signal.sourceUrl} target="_blank" rel="noreferrer">Quelle ↗</a>}
          </article>
        )) : <p className={styles.empty}>Noch keine belastbaren Signale gespeichert.</p>}
      </div>
    </section>
  );
}
