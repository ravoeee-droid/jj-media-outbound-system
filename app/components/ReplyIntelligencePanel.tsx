"use client";

import { useEffect, useState } from "react";
import styles from "./ReplyIntelligencePanel.module.css";

type Thread={status:string;lastReplyClass:string|null;requiresHuman:boolean;priority:string;nextAction:string|null;nextActionAt:string|null};
type Message={subject:string;bodyText:string;receivedAt:string|null};
type Classification={id:string;replyClass:string;confidence:string;rationale:string;recommendedAction:string;priority:string;requiresHuman:boolean;draftReply:string|null;reviewStatus:string;createdAt:string};

const classLabels:Record<string,string>={
  positive:"Interesse",
  meeting_intent:"Terminabsicht",
  needs_information:"Will Infos",
  objection_price:"Preis-Einwand",
  objection_existing_solution:"Bestehende Lösung",
  objection_timing:"Später",
  not_responsible:"Nicht zuständig",
  referral:"Weiterleitung",
  not_interested:"Kein Interesse",
  already_filled:"Bedarf gedeckt",
  out_of_office:"Abwesend",
  unsubscribe:"Opt-out",
  legal_complaint:"Rechtlich prüfen",
  unknown:"Unklar",
};
const actionLabels:Record<string,string>={
  call_now:"Jetzt anrufen",
  book_meeting:"Termin anbieten",
  send_information:"Infos senden",
  human_reply:"Persönlich antworten",
  ask_referral:"Richtigen Kontakt erfragen",
  retry_later:"Später nachfassen",
  close_loop:"Abschließen",
  no_action:"Keine Aktion",
  suppress:"Kontakt sperren",
  legal_review:"Rechtlich prüfen",
  human_review:"Mensch prüfen",
};

export default function ReplyIntelligencePanel({leadId}:{leadId:string}){
  const [thread,setThread]=useState<Thread|null>(null);
  const [message,setMessage]=useState<Message|null>(null);
  const [classification,setClassification]=useState<Classification|null>(null);
  const [busy,setBusy]=useState("");

  async function load(){
    const r=await fetch("/api/reply-intelligence?leadId="+encodeURIComponent(leadId),{cache:"no-store"});
    if(!r.ok)return;
    const j=await r.json();
    setThread(j.thread||null); setMessage(j.message||null); setClassification(j.classification||null);
  }
  useEffect(()=>{void load()},[leadId]);

  async function review(action:"accept"|"reject"){
    if(!classification||busy)return;
    setBusy(action);
    try{
      const r=await fetch("/api/reply-intelligence",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({leadId,classificationId:classification.id,action})});
      if(r.ok){const j=await r.json();setThread(j.thread||null);setMessage(j.message||null);setClassification(j.classification||null)}
    }finally{setBusy("")}
  }

  if(!classification)return <section className={styles.shell}><div className={styles.head}><div><small>REPLY INTELLIGENCE · M6</small><h3>Noch keine Antwort analysiert</h3></div><span>Wird automatisch aktiv, sobald eine echte E-Mail-Antwort eingeht.</span></div></section>;

  const confidence=Math.round(Number(classification.confidence||0)*100);
  return <section className={styles.shell}>
    <div className={styles.head}>
      <div><small>REPLY INTELLIGENCE · M6</small><h3>{classLabels[classification.replyClass]||classification.replyClass}</h3></div>
      <div className={styles.badges}><span>{confidence}% sicher</span><span data-priority={classification.priority}>{classification.priority}</span></div>
    </div>

    <div className={styles.grid}>
      <div className={styles.answer}>
        <small>ANTWORT DES LEADS</small>
        {message?.subject&&<strong>{message.subject}</strong>}
        <p>{message?.bodyText||"Antworttext nicht verfügbar."}</p>
      </div>
      <div className={styles.brain}>
        <small>WAS DAS SYSTEM VERSTANDEN HAT</small>
        <strong>{classification.rationale}</strong>
        <div><span>Nächste Aktion</span><b>{actionLabels[classification.recommendedAction]||classification.recommendedAction}</b></div>
        {thread?.nextActionAt&&<div><span>Wiedervorlage</span><b>{new Intl.DateTimeFormat("de-DE",{dateStyle:"medium"}).format(new Date(thread.nextActionAt))}</b></div>}
      </div>
    </div>

    {classification.draftReply&&<div className={styles.draft}><small>ANTWORTVORSCHLAG</small><pre>{classification.draftReply}</pre><button onClick={()=>navigator.clipboard.writeText(classification.draftReply||"")}>Antwort kopieren</button></div>}

    <div className={styles.review}>
      <span>Status: {classification.reviewStatus==="accepted"?"bestätigt":classification.reviewStatus==="rejected"?"abgelehnt":"noch nicht geprüft"}</span>
      <div><button disabled={Boolean(busy)} onClick={()=>void review("reject")}>Falsch</button><button className={styles.primary} disabled={Boolean(busy)} onClick={()=>void review("accept")}>Passt ✓</button></div>
    </div>
  </section>;
}
