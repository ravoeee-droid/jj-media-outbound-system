"use client";

import { useEffect, useState } from "react";
import styles from "./FactsLedgerPanel.module.css";

type Fact = {
  id: string;
  claim: string;
  valueText: string | null;
  sourceUrl: string | null;
  sourceTitle: string | null;
  confidence: string;
  reviewStatus: "proposed" | "auto_verified" | "approved" | "rejected";
  outreachAllowed: boolean;
  locked: boolean;
  observedAt: string;
};

export default function FactsLedgerPanel({ leadId }: { leadId: string }) {
  const [facts, setFacts] = useState<Fact[]>([]);
  const [counts, setCounts] = useState({ allowed: 0, blocked: 0, total: 0 });
  const [busy, setBusy] = useState("");

  async function load() {
    const response = await fetch("/api/facts-ledger?leadId=" + encodeURIComponent(leadId), { cache: "no-store" });
    if (!response.ok) return;
    const payload = await response.json();
    setFacts(payload.facts || []);
    setCounts({
      allowed: payload.context?.allowedClaims?.length || 0,
      blocked: payload.context?.blockedCount || 0,
      total: payload.context?.totalCount || 0,
    });
  }

  useEffect(() => { void load(); }, [leadId]);

  async function act(factId: string, action: "approve" | "reject" | "toggle_lock") {
    if (busy) return;
    setBusy(factId + action);
    try {
      const response = await fetch("/api/facts-ledger", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ leadId, factId, action }),
      });
      if (response.ok) await load();
    } finally {
      setBusy("");
    }
  }

  return (
    <section className={styles.shell}>
      <div className={styles.head}>
        <div><small>FACTS LEDGER</small><h3>Nur belegte Aussagen dürfen raus</h3></div>
        <div className={styles.counts}><span>{counts.allowed} erlaubt</span><span>{counts.blocked} blockiert</span></div>
      </div>

      <div className={styles.list}>
        {facts.length ? facts.slice(0, 10).map((fact) => (
          <article key={fact.id} data-status={fact.reviewStatus}>
            <div className={styles.factTop}>
              <div>
                <strong>{fact.claim}</strong>
                {fact.valueText && <p>{fact.valueText}</p>}
              </div>
              <span>{Math.round(Number(fact.confidence || 0) * 100)}%</span>
            </div>
            <div className={styles.meta}>
              <span>{fact.reviewStatus === "auto_verified" ? "Auto-verifiziert" : fact.reviewStatus === "approved" ? "Freigegeben" : fact.reviewStatus === "rejected" ? "Verworfen" : "Prüfung offen"}</span>
              <span>{fact.outreachAllowed ? "Outreach erlaubt" : "Outreach gesperrt"}</span>
              {fact.locked && <span>Gesperrt</span>}
              {fact.sourceUrl && <a href={fact.sourceUrl} target="_blank" rel="noreferrer">Quelle ↗</a>}
            </div>
            <div className={styles.actions}>
              <button disabled={Boolean(busy)} onClick={() => void act(fact.id, "approve")}>Freigeben</button>
              <button disabled={Boolean(busy)} onClick={() => void act(fact.id, "reject")}>Verwerfen</button>
              <button disabled={Boolean(busy)} onClick={() => void act(fact.id, "toggle_lock")}>{fact.locked ? "Entsperren" : "Sperren"}</button>
            </div>
          </article>
        )) : <p className={styles.empty}>Noch keine Research-Fakten für diesen Lead vorhanden.</p>}
      </div>
    </section>
  );
}
