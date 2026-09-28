import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { acquisitionLeadScores, acquisitionLeadSignals, leads } from "@/db/schema";

type SignalInput = {
  key: string;
  type: "pain" | "timing" | "fit" | "reachability" | "value" | "engagement";
  strength: number;
  confidence: number;
  title: string;
  detail: string;
  sourceKind: string;
  sourceUrl?: string;
  evidence?: Record<string, unknown>;
};

function clamp(value: number) {
  return Math.max(0, Math.min(100, Math.round(value)));
}

function evidenceUrl(lead: typeof leads.$inferSelect) {
  const rows = Array.isArray(lead.evidence) ? lead.evidence : [];
  for (const row of rows) {
    if (row && typeof row === "object" && "source" in row && typeof (row as { source?: unknown }).source === "string") {
      return (row as { source: string }).source;
    }
  }
  return lead.websiteUrl || lead.instagramUrl || "";
}

export function deriveLeadSignals(lead: typeof leads.$inferSelect): SignalInput[] {
  const signals: SignalInput[] = [];
  const sourceUrl = evidenceUrl(lead);

  if (lead.jobCount > 0) {
    signals.push({
      key: "active_hiring",
      type: "pain",
      strength: clamp(55 + Math.min(lead.jobCount * 8, 40)),
      confidence: lead.jobTitles.length ? 95 : 80,
      title: \`\${lead.jobCount} offene Stelle\${lead.jobCount === 1 ? "" : "n"}\`,
      detail: lead.jobTitles.length ? lead.jobTitles.slice(0, 4).join(", ") : "Aktiver Personalbedarf im CRM erkannt.",
      sourceKind: "job_signal",
      sourceUrl,
      evidence: { jobCount: lead.jobCount, jobTitles: lead.jobTitles.slice(0, 8) },
    });
  }

  if (lead.websiteScore > 0 && lead.websiteScore < 60) {
    signals.push({
      key: "weak_web_presence",
      type: "pain",
      strength: clamp(100 - lead.websiteScore),
      confidence: 85,
      title: "Schwacher Web-Auftritt",
      detail: \`Website-Score \${lead.websiteScore}/100 – klarer Optimierungshebel.\`,
      sourceKind: "website_analysis",
      sourceUrl: lead.websiteUrl,
      evidence: { websiteScore: lead.websiteScore },
    });
  }

  if (lead.instagramUrl) {
    signals.push({
      key: "social_presence",
      type: "fit",
      strength: 65,
      confidence: 95,
      title: "Social-Media-Präsenz vorhanden",
      detail: "Ein bestehendes Profil macht Optimierung und personalisierte Ansprache direkt möglich.",
      sourceKind: "crm",
      sourceUrl: lead.instagramUrl,
      evidence: { instagramUrl: lead.instagramUrl },
    });
  }

  if (lead.email || lead.phone) {
    signals.push({
      key: "direct_contact",
      type: "reachability",
      strength: lead.email && lead.phone ? 95 : 75,
      confidence: 95,
      title: "Direkter Kontaktweg vorhanden",
      detail: [lead.email ? "E-Mail" : "", lead.phone ? "Telefon" : ""].filter(Boolean).join(" + "),
      sourceKind: "crm",
      evidence: { hasEmail: Boolean(lead.email), hasPhone: Boolean(lead.phone) },
    });
  }

  if (lead.ceo || lead.contact) {
    signals.push({
      key: "decision_maker",
      type: "reachability",
      strength: 85,
      confidence: lead.ceo ? 90 : 75,
      title: "Ansprechpartner bekannt",
      detail: lead.ceo || lead.contact,
      sourceKind: "website_enrichment",
      sourceUrl,
      evidence: { ceo: lead.ceo, contact: lead.contact },
    });
  }

  if (lead.watchPercent >= 60) {
    signals.push({
      key: "high_video_engagement",
      type: "timing",
      strength: clamp(70 + Math.floor((lead.watchPercent - 60) / 2)),
      confidence: 99,
      title: "Starkes Video-Engagement",
      detail: \`\${lead.watchPercent}% des persönlichen Videos angesehen.\`,
      sourceKind: "behavior",
      evidence: { watchPercent: lead.watchPercent },
    });
  } else if (lead.watchPercent > 0) {
    signals.push({
      key: "video_engagement",
      type: "engagement",
      strength: clamp(35 + lead.watchPercent / 2),
      confidence: 99,
      title: "Video angesehen",
      detail: \`\${lead.watchPercent}% angesehen.\`,
      sourceKind: "behavior",
      evidence: { watchPercent: lead.watchPercent },
    });
  }

  if (["replied", "call_booked", "won"].includes(lead.pipelineStage)) {
    signals.push({
      key: "reply_or_booking",
      type: "timing",
      strength: lead.pipelineStage === "won" ? 100 : lead.pipelineStage === "call_booked" ? 98 : 90,
      confidence: 100,
      title: lead.pipelineStage === "replied" ? "Lead hat geantwortet" : lead.pipelineStage === "call_booked" ? "Termin gebucht" : "Deal gewonnen",
      detail: "Starkes First-Party-Kaufsignal aus dem CRM.",
      sourceKind: "crm",
      evidence: { pipelineStage: lead.pipelineStage },
    });
  }

  if (lead.dealValue > 0) {
    signals.push({
      key: "known_deal_value",
      type: "value",
      strength: clamp(50 + Math.log10(Math.max(lead.dealValue, 1000) / 1000) * 25),
      confidence: 90,
      title: "Dealwert hinterlegt",
      detail: \`\${lead.dealValue.toLocaleString("de-DE")} € potenzieller Auftragswert.\`,
      sourceKind: "crm",
      evidence: { dealValue: lead.dealValue },
    });
  }

  if (lead.confidence >= 70) {
    signals.push({
      key: "research_confidence",
      type: "fit",
      strength: clamp(lead.confidence),
      confidence: clamp(lead.confidence),
      title: "Research ist belastbar",
      detail: \`\${lead.confidence}% Research-Confidence.\`,
      sourceKind: "research",
      sourceUrl,
      evidence: { confidence: lead.confidence },
    });
  }

  return signals;
}

function averageSignals(signals: SignalInput[], type: SignalInput["type"], fallback: number) {
  const rows = signals.filter((signal) => signal.type === type);
  if (!rows.length) return fallback;
  const weighted = rows.reduce((sum, row) => sum + row.strength * (row.confidence / 100), 0);
  const weights = rows.reduce((sum, row) => sum + row.confidence / 100, 0);
  return clamp(weighted / Math.max(weights, 0.01));
}

export function scoreLead(lead: typeof leads.$inferSelect, signals: SignalInput[]) {
  const fit = clamp(averageSignals(signals, "fit", lead.score || 45) * 0.7 + (lead.instagramUrl ? 15 : 0) + (lead.websiteUrl ? 10 : 0));
  const pain = clamp(averageSignals(signals, "pain", lead.jobCount > 0 ? 70 : 40) * 0.8 + (lead.jobCount >= 2 ? 15 : 0));
  const timing = clamp(averageSignals(signals, "timing", 35) * 0.8 + (lead.nextActionAt ? 8 : 0) + (lead.watchPercent > 0 ? 10 : 0));
  const reachability = clamp(averageSignals(signals, "reachability", 25) * 0.85 + (lead.email ? 8 : 0) + (lead.phone ? 7 : 0));
  const value = clamp(averageSignals(signals, "value", lead.dealValue > 0 ? 65 : 45) * 0.8 + (lead.jobCount >= 3 ? 10 : 0) + (lead.salesPriority >= 70 ? 8 : 0));
  const confidence = clamp(lead.confidence > 0 ? lead.confidence : signals.length >= 4 ? 80 : signals.length >= 2 ? 65 : 45);

  const total = clamp(fit * 0.22 + pain * 0.26 + timing * 0.2 + reachability * 0.14 + value * 0.12 + confidence * 0.06);

  let recommendedAngle = "Relevanten Wachstumshebel mit konkretem nächsten Schritt ansprechen.";
  if (lead.jobCount >= 2) recommendedAngle = \`\${lead.jobCount} offene Stellen als Kosten- und Kapazitätsproblem ansprechen und schnelleren Recruiting-Kanal positionieren.\`;
  else if (lead.websiteScore > 0 && lead.websiteScore < 60) recommendedAngle = "Schwachen digitalen Auftritt konkret zeigen und den direkten Conversion-/Vertrauenshebel anbieten.";
  else if (lead.instagramUrl) recommendedAngle = "Bestehende Social-Präsenz würdigen und konkret zeigen, wie daraus planbar mehr Anfragen oder Bewerbungen entstehen.";

  const strongest = [...signals].sort((a, b) => b.strength * b.confidence - a.strength * a.confidence).slice(0, 3);
  const rationale = strongest.length ? strongest.map((signal) => signal.title).join(" · ") : "Noch zu wenig belastbare Signale – Research vertiefen.";

  return {
    fitScore: fit,
    painScore: pain,
    timingScore: timing,
    reachabilityScore: reachability,
    valueScore: value,
    confidenceScore: confidence,
    totalScore: total,
    recommendedAngle,
    rationale,
    breakdown: {
      strongestSignals: strongest.map((signal) => signal.key),
      signalCount: signals.length,
      weights: { fit: 0.22, pain: 0.26, timing: 0.2, reachability: 0.14, value: 0.12, confidence: 0.06 },
    },
  };
}

export async function refreshLeadIntelligence(args: { workspaceId: string; leadId: string }) {
  const db = getDb();
  const [lead] = await db.select().from(leads)
    .where(and(eq(leads.workspaceId, args.workspaceId), eq(leads.id, args.leadId))).limit(1);
  if (!lead) throw new Error("Lead nicht gefunden.");

  const derived = deriveLeadSignals(lead);
  for (const signal of derived) {
    await db.insert(acquisitionLeadSignals).values({
      workspaceId: args.workspaceId,
      leadId: lead.id,
      signalKey: signal.key,
      signalType: signal.type,
      strength: signal.strength,
      confidence: signal.confidence,
      title: signal.title,
      detail: signal.detail,
      sourceUrl: signal.sourceUrl || "",
      sourceKind: signal.sourceKind,
      evidence: signal.evidence || {},
      observedAt: new Date(),
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [acquisitionLeadSignals.leadId, acquisitionLeadSignals.signalKey],
      set: {
        signalType: signal.type,
        strength: signal.strength,
        confidence: signal.confidence,
        title: signal.title,
        detail: signal.detail,
        sourceUrl: signal.sourceUrl || "",
        sourceKind: signal.sourceKind,
        evidence: signal.evidence || {},
        observedAt: new Date(),
        updatedAt: new Date(),
      },
    });
  }

  const score = scoreLead(lead, derived);
  const [storedScore] = await db.insert(acquisitionLeadScores).values({
    leadId: lead.id,
    workspaceId: args.workspaceId,
    ...score,
    scoredAt: new Date(),
  }).onConflictDoUpdate({
    target: acquisitionLeadScores.leadId,
    set: { ...score, scoredAt: new Date(), updatedAt: new Date() },
  }).returning();

  const updatedPriority = Math.max(lead.salesPriority, storedScore.totalScore);
  await db.update(leads).set({
    salesPriority: updatedPriority,
    score: storedScore.totalScore,
    pitch: lead.pitch || storedScore.recommendedAngle,
    analysisStatus: "ready",
    nextAction: lead.nextAction === "review" || lead.nextAction === "analyze" ? "outreach" : lead.nextAction,
    updatedAt: new Date(),
  }).where(eq(leads.id, lead.id));

  const signals = await db.select().from(acquisitionLeadSignals)
    .where(and(eq(acquisitionLeadSignals.workspaceId, args.workspaceId), eq(acquisitionLeadSignals.leadId, lead.id)));

  return { leadId: lead.id, score: storedScore, signals: signals.sort((a, b) => b.strength - a.strength) };
}

export async function getLeadIntelligence(args: { workspaceId: string; leadId: string }) {
  const db = getDb();
  const [score, signals] = await Promise.all([
    db.select().from(acquisitionLeadScores).where(and(eq(acquisitionLeadScores.workspaceId, args.workspaceId), eq(acquisitionLeadScores.leadId, args.leadId))).limit(1).then((rows) => rows[0] || null),
    db.select().from(acquisitionLeadSignals).where(and(eq(acquisitionLeadSignals.workspaceId, args.workspaceId), eq(acquisitionLeadSignals.leadId, args.leadId))),
  ]);
  return { score, signals: signals.sort((a, b) => b.strength - a.strength) };
}
