import { createHash } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  activities,
  leads,
  outboundConversationEscalations,
  outboundConversationMessages,
  outboundConversationThreads,
  outboundReplyClassifications,
  tasks,
} from "@/db/schema";
import { refreshSequence } from "@/lib/adaptive-sequence";

export type ReplyClass =
  | "positive"
  | "meeting_intent"
  | "needs_information"
  | "objection_price"
  | "objection_existing_solution"
  | "objection_timing"
  | "not_responsible"
  | "referral"
  | "not_interested"
  | "already_filled"
  | "out_of_office"
  | "unsubscribe"
  | "legal_complaint"
  | "unknown";

type Classification = {
  replyClass: ReplyClass;
  confidence: number;
  rationale: string;
  recommendedAction:
    | "call_now"
    | "book_meeting"
    | "send_information"
    | "human_reply"
    | "ask_referral"
    | "retry_later"
    | "close_loop"
    | "no_action"
    | "suppress"
    | "legal_review"
    | "human_review";
  priority: "low" | "normal" | "high" | "urgent";
  requiresHuman: boolean;
  draftReply: string;
  followUpAt?: Date | null;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[„“”]/g, '"')
    .trim();
}

function addDays(days: number) {
  const d = new Date();
  d.setDate(d.getDate() + days);
  d.setHours(9, 0, 0, 0);
  return d;
}

function detectFollowUpDate(text: string) {
  const t = normalize(text);
  if (/morgen\b/.test(t)) return addDays(1);
  if (/übermorgen\b/.test(t)) return addDays(2);
  if (/nächste[rsn]? woche|kommende[rsn]? woche/.test(t)) return addDays(7);
  if (/in zwei wochen|in 2 wochen/.test(t)) return addDays(14);
  if (/nächste[rsn]? monat|kommende[rsn]? monat/.test(t)) return addDays(30);

  const months: Array<[RegExp, number]> = [
    [/januar/,0],[/februar/,1],[/märz|maerz/,2],[/april/,3],[/mai/,4],[/juni/,5],
    [/juli/,6],[/august/,7],[/september/,8],[/oktober/,9],[/november/,10],[/dezember/,11],
  ];
  for (const [pattern, month] of months) {
    if (!pattern.test(t)) continue;
    const now = new Date();
    const year = month < now.getMonth() ? now.getFullYear() + 1 : now.getFullYear();
    return new Date(year, month, 5, 9, 0, 0, 0);
  }
  return null;
}

function draftFor(replyClass: ReplyClass, company: string, contact: string, followUpAt?: Date | null) {
  const greeting = contact ? `Hallo ${contact.split(/\s+/)[0]},` : "Guten Tag,";
  const later = followUpAt
    ? new Intl.DateTimeFormat("de-DE",{day:"2-digit",month:"2-digit",year:"numeric"}).format(followUpAt)
    : "zu einem passenden Zeitpunkt";

  const map: Partial<Record<ReplyClass,string>> = {
    positive: `${greeting}\n\nvielen Dank für die Rückmeldung. Gerne zeige ich Ihnen den Ansatz kurz und konkret. Wann passen Ihnen 15 Minuten am besten?\n\nViele Grüße\nJessica | JJ-Media`,
    meeting_intent: `${greeting}\n\nsehr gerne. Ich schicke Ihnen direkt passende Terminoptionen, dann können Sie einfach den besten Zeitpunkt auswählen.\n\nViele Grüße\nJessica | JJ-Media`,
    needs_information: `${greeting}\n\nsehr gerne. Ich schicke Ihnen die wichtigsten Punkte kompakt rüber, damit Sie schnell einschätzen können, ob das für ${company} interessant ist.\n\nViele Grüße\nJessica | JJ-Media`,
    objection_price: `${greeting}\n\nverstehe ich. Entscheidend ist für mich weniger der reine Preis als ob sich das System für ${company} wirtschaftlich rechnet. Wenn Sie möchten, können wir das kurz anhand Ihrer Situation durchrechnen.\n\nViele Grüße\nJessica | JJ-Media`,
    objection_existing_solution: `${greeting}\n\nverstehe ich. Dann würde ich gar nicht versuchen, etwas Bestehendes pauschal zu ersetzen. Interessant wäre nur, ob es aktuell noch einen konkreten Engpass gibt, den das bestehende Setup nicht löst.\n\nViele Grüße\nJessica | JJ-Media`,
    objection_timing: `${greeting}\n\nkein Problem. Ich melde mich gerne ${later} noch einmal kurz, dann müssen Sie sich jetzt nicht darum kümmern.\n\nViele Grüße\nJessica | JJ-Media`,
    not_responsible: `${greeting}\n\ndanke für den Hinweis. Wer ist bei Ihnen dafür die richtige Ansprechperson? Dann melde ich mich direkt dort und halte Sie raus.\n\nViele Grüße\nJessica | JJ-Media`,
    referral: `${greeting}\n\nvielen Dank für die Weiterleitung bzw. den Kontakt. Ich melde mich direkt bei der genannten Person.\n\nViele Grüße\nJessica | JJ-Media`,
    out_of_office: "",
    unsubscribe: "",
    legal_complaint: "",
    not_interested: "",
    already_filled: `${greeting}\n\ndanke für die kurze Rückmeldung und Glückwunsch zur Besetzung. Dann hake ich das Thema für jetzt ab.\n\nViele Grüße\nJessica | JJ-Media`,
  };
  return map[replyClass] || "";
}

export function classifyReply(text: string, company = "", contact = ""): Classification {
  const t = normalize(text);
  const followUpAt = detectFollowUpDate(t);

  const hit = (
    replyClass: ReplyClass,
    confidence: number,
    rationale: string,
    recommendedAction: Classification["recommendedAction"],
    priority: Classification["priority"],
    requiresHuman: boolean,
  ): Classification => ({
    replyClass,
    confidence,
    rationale,
    recommendedAction,
    priority,
    requiresHuman,
    followUpAt,
    draftReply: draftFor(replyClass, company, contact, followUpAt),
  });

  if (/abmelden|austragen|keine (weiteren )?mails|nicht mehr kontaktieren|löschen sie meine daten|loeschen sie meine daten|unsubscribe|werbung untersagt/.test(t)) {
    return hit("unsubscribe", .99, "Expliziter Wunsch nach keinem weiteren Kontakt.", "suppress", "urgent", false);
  }
  if (/anwalt|abmahnung|datenschutzbeschwerde|beschwerde.*datenschutz|rechtswidrig|rechtliche schritte/.test(t)) {
    return hit("legal_complaint", .98, "Rechtlicher oder datenschutzbezogener Beschwerdehinweis.", "legal_review", "urgent", true);
  }
  if (/automatische antwort|abwesenheitsnotiz|out of office|bin bis .* nicht im büro|nicht im buero|urlaub|wieder erreichbar ab/.test(t)) {
    return hit("out_of_office", .97, "Automatische Abwesenheits- bzw. Urlaubsantwort.", "retry_later", "low", false);
  }
  if (/stelle.*besetzt|position.*besetzt|haben .* eingestellt|vakanz.*geschlossen|bedarf.*gedeckt/.test(t)) {
    return hit("already_filled", .94, "Der konkrete Personalbedarf scheint bereits gedeckt.", "close_loop", "normal", true);
  }
  if (/nicht zuständig|nicht zustaendig|falsche ansprechperson|bin dafür nicht|bin dafuer nicht|nicht mein bereich/.test(t)) {
    return hit("not_responsible", .96, "Empfänger ist nicht die zuständige Person.", "ask_referral", "normal", true);
  }
  if (/wenden sie sich an|kontaktieren sie|zuständig ist|zustaendig ist|ansprechpartner.*ist|ich leite.*weiter/.test(t)) {
    return hit("referral", .91, "Antwort enthält eine Weiterleitung oder einen anderen Ansprechpartner.", "human_reply", "high", true);
  }
  if (/zu teuer|preis.*zu hoch|budget|kein budget|kosten.*hoch|zu viel geld/.test(t)) {
    return hit("objection_price", .93, "Preis- oder Budgeteinwand erkannt.", "human_reply", "high", true);
  }
  if (/haben bereits|arbeiten bereits mit|agentur vorhanden|dienstleister vorhanden|machen wir intern|intern gelöst|intern geloest/.test(t)) {
    return hit("objection_existing_solution", .91, "Bestehende interne oder externe Lösung wird genannt.", "human_reply", "normal", true);
  }
  if (/später|spaeter|aktuell nicht|derzeit nicht|momentan nicht|melden sie sich|kommenden monat|nächste woche|naechste woche|januar|februar|märz|maerz|april|mai|juni|juli|august|september|oktober|november|dezember/.test(t)) {
    return hit("objection_timing", .9, "Timing-Einwand oder konkreter späterer Kontaktwunsch erkannt.", "retry_later", "normal", true);
  }
  if (/termin|kalender|wann.*zeit|zeit.*passen|telefonieren|sprechen|call|meeting|15 minuten|15 min/.test(t) && !/kein termin|keine zeit/.test(t)) {
    return hit("meeting_intent", .94, "Konkrete Gesprächs- oder Terminabsicht erkannt.", "book_meeting", "urgent", true);
  }
  if (/mehr infos|mehr information|informationen schicken|infos schicken|unterlagen|schicken sie mir|senden sie mir|details/.test(t)) {
    return hit("needs_information", .92, "Empfänger bittet um weitere Informationen.", "send_information", "high", true);
  }
  if (/kein interesse|nicht interessiert|nicht relevant|kein bedarf|bitte nicht|danke, nein|nein danke/.test(t)) {
    return hit("not_interested", .96, "Klare negative Rückmeldung ohne expliziten Opt-out.", "close_loop", "normal", true);
  }
  if (/interessant|klingt gut|gerne|ja,? gerne|können wir|koennen wir|würde ich mir ansehen|wuerde ich mir ansehen|spannend/.test(t)) {
    return hit("positive", .84, "Positive Gesprächsbereitschaft erkannt.", "call_now", "high", true);
  }
  return hit("unknown", .45, "Keine ausreichend klare Intent-Klasse erkannt.", "human_review", "normal", true);
}

export async function storeAndClassifyInbound(args: {
  workspaceId: string;
  leadId: string;
  providerMessageId: string;
  mailboxId?: string;
  subject: string;
  body: string;
  receivedAt?: Date | null;
}) {
  const db = getDb();
  const [lead] = await db.select().from(leads)
    .where(and(eq(leads.workspaceId,args.workspaceId),eq(leads.id,args.leadId))).limit(1);
  if (!lead) throw new Error("Lead nicht gefunden.");

  let [thread] = await db.select().from(outboundConversationThreads)
    .where(and(
      eq(outboundConversationThreads.workspace,args.workspaceId),
      eq(outboundConversationThreads.leadId,args.leadId),
      eq(outboundConversationThreads.channel,"email"),
    ))
    .orderBy(desc(outboundConversationThreads.updatedAt))
    .limit(1);

  if (!thread) {
    [thread] = await db.insert(outboundConversationThreads).values({
      workspace: args.workspaceId,
      leadId: args.leadId,
      companyId: lead.normalizedCompany || lead.company,
      channel: "email",
      mailboxId: args.mailboxId || null,
      status: "open",
    }).returning();
  }

  const bodyHash = createHash("sha256").update(args.body).digest("hex");
  let [message] = args.providerMessageId
    ? await db.select().from(outboundConversationMessages)
      .where(and(
        eq(outboundConversationMessages.workspace,args.workspaceId),
        eq(outboundConversationMessages.providerMessageId,args.providerMessageId),
      )).limit(1)
    : [];

  if (!message) {
    [message] = await db.insert(outboundConversationMessages).values({
      workspace: args.workspaceId,
      threadId: thread.id,
      direction: "inbound",
      providerMessageId: args.providerMessageId || null,
      mailboxId: args.mailboxId || null,
      subject: args.subject,
      bodyText: args.body,
      bodyHash,
      processingStatus: "processing",
      receivedAt: args.receivedAt || new Date(),
      metadata: { leadId: args.leadId },
    }).returning();
  }

  const classification = classifyReply(args.body, lead.company, lead.contact);
  await db.update(outboundReplyClassifications)
    .set({ isCurrent:false })
    .where(and(eq(outboundReplyClassifications.threadId,thread.id),eq(outboundReplyClassifications.isCurrent,true)));

  const [stored] = await db.insert(outboundReplyClassifications).values({
    workspace: args.workspaceId,
    threadId: thread.id,
    messageId: message.id,
    replyClass: classification.replyClass,
    confidence: String(classification.confidence),
    classifier: "rules_v1",
    model: null,
    rationale: classification.rationale,
    recommendedAction: classification.recommendedAction,
    priority: classification.priority,
    requiresHuman: classification.requiresHuman,
    draftReply: classification.draftReply || null,
    policyVersion: "reply_policy_v1",
    promptVersion: "rules_v1",
    raw: { followUpAt: classification.followUpAt?.toISOString() || null },
  }).returning();

  await db.update(outboundConversationMessages).set({
    processingStatus:"classified",
    attempt: message.attempt + 1,
  }).where(eq(outboundConversationMessages.id,message.id));

  const threadStatus = classification.replyClass === "unsubscribe"
    ? "suppressed"
    : classification.requiresHuman
      ? "needs_human"
      : classification.replyClass === "out_of_office"
        ? "waiting"
        : "open";

  await db.update(outboundConversationThreads).set({
    status: threadStatus,
    lastReplyClass: classification.replyClass,
    requiresHuman: classification.requiresHuman,
    priority: classification.priority,
    nextAction: classification.recommendedAction,
    nextActionAt: classification.followUpAt || null,
    lastMessageAt: args.receivedAt || new Date(),
    lastInboundAt: args.receivedAt || new Date(),
    updatedAt: new Date(),
  }).where(eq(outboundConversationThreads.id,thread.id));

  const leadPatch: Partial<typeof leads.$inferInsert> = {
    emailStatus: "replied",
    pipelineStage: ["unsubscribe","not_interested"].includes(classification.replyClass) ? lead.pipelineStage : "replied",
    nextAction: classification.recommendedAction,
    nextActionAt: classification.followUpAt || null,
    objection: ["objection_price","objection_existing_solution","objection_timing"].includes(classification.replyClass) ? classification.replyClass : lead.objection,
    lastActivityAt:new Date(),
    updatedAt:new Date(),
  };
  if (classification.replyClass === "unsubscribe") {
    leadPatch.contactLocked = true;
    leadPatch.contactLockReason = "Opt-out per E-Mail";
    leadPatch.emailStatus = "stopped";
    leadPatch.nextAction = "none";
  }
  if (classification.replyClass === "not_interested") {
    leadPatch.nextAction = "human_review";
  }
  if (classification.replyClass === "meeting_intent" || classification.replyClass === "positive") {
    leadPatch.salesPriority = Math.max(lead.salesPriority,90);
    leadPatch.probability = Math.max(lead.probability,50);
  }
  await db.update(leads).set(leadPatch).where(eq(leads.id,lead.id));

  if (classification.requiresHuman) {
    const title = `Antwort prüfen: ${lead.company}`;
    const [existingTask] = await db.select().from(tasks).where(and(
      eq(tasks.workspaceId,args.workspaceId),
      eq(tasks.leadId,lead.id),
      eq(tasks.type,"reply_review"),
      eq(tasks.status,"open"),
    )).limit(1);
    if (!existingTask) {
      await db.insert(tasks).values({
        workspaceId:args.workspaceId,
        leadId:lead.id,
        assigneeId:lead.ownerId,
        title,
        dueAt:new Date(),
        status:"open",
        priority:classification.priority === "urgent" ? "high" : classification.priority,
        type:"reply_review",
      });
    }
    await db.insert(outboundConversationEscalations).values({
      workspace:args.workspaceId,
      threadId:thread.id,
      messageId:message.id,
      classificationId:stored.id,
      reason:classification.rationale,
      priority:classification.priority,
      recommendedAction:classification.recommendedAction,
      draftReply:classification.draftReply || null,
      dueAt:new Date(),
    });
  }

  await db.insert(activities).values({
    workspaceId:args.workspaceId,
    leadId:lead.id,
    type:"reply_classified",
    title:`Antwort erkannt: ${classification.replyClass}`,
    detail:classification.rationale,
    metadata:{
      confidence:classification.confidence,
      recommendedAction:classification.recommendedAction,
      classificationId:stored.id,
    },
  });

  await refreshSequence(args.workspaceId,args.leadId).catch(()=>undefined);
  return { thread, message, classification:stored };
}

export async function getLatestReplyIntelligence(workspaceId:string,leadId:string) {
  const db=getDb();
  const [thread]=await db.select().from(outboundConversationThreads)
    .where(and(eq(outboundConversationThreads.workspace,workspaceId),eq(outboundConversationThreads.leadId,leadId),eq(outboundConversationThreads.channel,"email")))
    .orderBy(desc(outboundConversationThreads.updatedAt)).limit(1);
  if(!thread)return {thread:null,message:null,classification:null};
  const [classification]=await db.select().from(outboundReplyClassifications)
    .where(and(eq(outboundReplyClassifications.threadId,thread.id),eq(outboundReplyClassifications.isCurrent,true)))
    .orderBy(desc(outboundReplyClassifications.createdAt)).limit(1);
  const [message]=classification
    ? await db.select().from(outboundConversationMessages).where(eq(outboundConversationMessages.id,classification.messageId)).limit(1)
    : [];
  return {thread,message:message||null,classification:classification||null};
}

export async function reviewClassification(args:{
  workspaceId:string;
  leadId:string;
  classificationId:string;
  action:"accept"|"reject";
  reviewer:string;
}) {
  const db=getDb();
  const [classification]=await db.select().from(outboundReplyClassifications)
    .where(and(eq(outboundReplyClassifications.workspace,args.workspaceId),eq(outboundReplyClassifications.id,args.classificationId))).limit(1);
  if(!classification)throw new Error("Klassifizierung nicht gefunden.");
  await db.update(outboundReplyClassifications).set({
    reviewStatus:args.action==="accept"?"accepted":"rejected",
    reviewedBy:args.reviewer,
    reviewedAt:new Date(),
  }).where(eq(outboundReplyClassifications.id,classification.id));
  if(args.action==="accept"){
    await db.update(outboundConversationEscalations).set({
      status:"resolved",resolvedBy:args.reviewer,resolvedAt:new Date(),resolution:"classification_accepted",updatedAt:new Date(),
    }).where(eq(outboundConversationEscalations.classificationId,classification.id));
  }
  return getLatestReplyIntelligence(args.workspaceId,args.leadId);
}
