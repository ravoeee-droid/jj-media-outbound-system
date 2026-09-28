"use client";

import { useEffect, useMemo, useState } from "react";
import styles from "./AdaptiveSequencePanel.module.css";

type Step = {
  id: string;
  stepKey: string;
  stepType: string;
  sequenceIndex: number;
  status: string;
  input: Record<string, unknown>;
  output: Record<string, unknown>;
  wakeAt: string | null;
};
type Run = {
  id: string;
  status: string;
  state: Record<string, unknown>;
  nextWakeAt: string | null;
  terminalReason: string | null;
};
type Payload = { run: Run | null; steps: Step[]; signals: unknown[]; mode: "manual" | "copilot" | "autopilot" };

const stepLabels: Record<string,string> = {
  email_1: "Erstkontakt",
  wait_1: "Warten",
  followup_1: "Follow-up 1",
  wait_2: "Warten",
  followup_2: "Follow-up 2",
};

function prettyStatus(value: string) {
  return ({pending:"Offen",ready:"Bereit",running:"Läuft",waiting:"Wartet",completed:"Fertig",blocked:"Blockiert",cancelled:"Gestoppt",paused:"Pausiert"} as Record<string,string>)[value] || value;
}

function displayDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",hour:"2-digit",minute:"2-digit"}).format(date);
}

export default function AdaptiveSequencePanel({ leadId }: { leadId: string }) {
  const [data,setData]=useState<Payload|null>(null);
  const [busy,setBusy]=useState("");

  async function load() {
    const r=await fetch("/api/adaptive-sequence?leadId="+encodeURIComponent(leadId),{cache:"no-store"});
    if(!r.ok)return;
    setData(await r.json());
  }
  useEffect(()=>{void load()},[leadId]);

  async function act(action:string, stepId?:string) {
    if(busy)return;
    setBusy(action+(stepId||""));
    try{
      const r=await fetch("/api/adaptive-sequence",{
        method:"POST",
        headers:{"content-type":"application/json"},
        body:JSON.stringify({leadId,action,stepId}),
      });
      if(r.ok)setData(await r.json());
    }finally{setBusy("")}
  }

  const recommendation=useMemo(()=>String(data?.run?.state?.recommendation||"Sequence noch nicht gestartet."),[data]);
  const hot=Boolean(data?.run?.state?.hot);

  if(!data)return <section className={styles.shell}><p className={styles.loading}>Sequence wird geladen …</p></section>;

  return <section className={styles.shell}>
    <div className={styles.head}>
      <div>
        <small>ADAPTIVE JOURNEY · M5</small>
        <h3>{data.run ? "Akquise reagiert auf echtes Lead-Verhalten" : "Noch keine Journey aktiv"}</h3>
      </div>
      <div className={styles.topActions}>
        {!data.run && <button className={styles.primary} onClick={()=>void act("start")}>Journey starten</button>}
        {data.run && <button onClick={()=>void act("refresh")}>Neu bewerten</button>}
        {data.run && data.run.status!=="paused" && !["completed","cancelled"].includes(data.run.status) && <button onClick={()=>void act("pause")}>Pause</button>}
        {data.run?.status==="paused" && <button className={styles.primary} onClick={()=>void act("resume")}>Fortsetzen</button>}
        {data.run && !["completed","cancelled"].includes(data.run.status) && <button onClick={()=>void act("cancel")}>Beenden</button>}
      </div>
    </div>

    {data.run && <>
      <div className={styles.recommendation} data-hot={hot}>
        <div><small>{hot?"HOT SIGNAL":"NÄCHSTE EMPFEHLUNG"}</small><strong>{recommendation}</strong></div>
        <span>{data.mode.toUpperCase()} · {prettyStatus(data.run.status)}{data.run.nextWakeAt?" · "+displayDate(data.run.nextWakeAt):""}</span>
      </div>

      <div className={styles.flow}>
        {data.steps.map((step,index)=><article key={step.id} data-status={step.status}>
          <div className={styles.index}>{step.status==="completed"?"✓":index+1}</div>
          <div className={styles.copy}>
            <strong>{stepLabels[step.stepKey]||step.stepKey}</strong>
            <small>{prettyStatus(step.status)}{step.wakeAt&&step.status==="waiting"?" bis "+displayDate(step.wakeAt):""}</small>
          </div>
          {step.status==="ready" && <button disabled={Boolean(busy)} onClick={()=>void act("complete_step",step.id)}>Als erledigt markieren</button>}
        </article>)}
      </div>

      {data.run.terminalReason && <div className={styles.terminal}>{data.run.terminalReason}</div>}
      <p className={styles.safety}>Die Journey priorisiert und stoppt automatisch. Versand bleibt an die bestehenden Versand- und Freigaberegeln gekoppelt.</p>
    </>}
  </section>;
}
