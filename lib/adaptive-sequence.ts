import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@/db";
import {
  acquisitionLeadControls,
  acquisitionWorkspaceControls,
  leads,
  outboundWorkflowRuns,
  outboundWorkflowSignals,
  outboundWorkflowSteps,
} from "@/db/schema";

type SequenceStatus = "pending" | "running" | "waiting" | "paused" | "completed" | "failed" | "cancelled";

const DAY = 24 * 60 * 60 * 1000;

const blueprint = [
  { key: "email_1", type: "email", label: "Erstkontakt", offsetDays: 0 },
  { key: "wait_1", type: "wait", label: "Reaktion abwarten", offsetDays: 2 },
  { key: "followup_1", type: "email", label: "Follow-up 1", offsetDays: 2 },
  { key: "wait_2", type: "wait", label: "Zweite Reaktion abwarten", offsetDays: 5 },
  { key: "followup_2", type: "email", label: "Follow-up 2", offsetDays: 5 },
] as const;

function wakeAt(days: number) {
  return days <= 0 ? null : new Date(Date.now() + days * DAY);
}

async function effectiveMode(workspaceId: string, leadId: string) {
  const db = getDb();
  const [workspaceControl, leadControl] = await Promise.all([
    db.select().from(acquisitionWorkspaceControls).where(eq(acquisitionWorkspaceControls.workspaceId, workspaceId)).limit(1).then(r => r[0]),
    db.select().from(acquisitionLeadControls).where(eq(acquisitionLeadControls.leadId, leadId)).limit(1).then(r => r[0]),
  ]);
  return leadControl?.modeOverride || workspaceControl?.mode || "copilot";
}

export async function getSequence(workspaceId: string, leadId: string) {
  const db = getDb();
  const run = await db.select().from(outboundWorkflowRuns)
    .where(and(
      eq(outboundWorkflowRuns.workspace, workspaceId),
      eq(outboundWorkflowRuns.leadId, leadId),
      eq(outboundWorkflowRuns.workflowKey, "adaptive_acquisition_v1"),
    ))
    .orderBy(asc(outboundWorkflowRuns.createdAt))
    .then(rows => rows.at(-1) || null);

  if (!run) return { run: null, steps: [], signals: [], mode: await effectiveMode(workspaceId, leadId) };

  const [steps, signals] = await Promise.all([
    db.select().from(outboundWorkflowSteps).where(eq(outboundWorkflowSteps.runId, run.id)).orderBy(asc(outboundWorkflowSteps.sequenceIndex)),
    db.select().from(outboundWorkflowSignals).where(eq(outboundWorkflowSignals.runId, run.id)).orderBy(asc(outboundWorkflowSignals.receivedAt)),
  ]);
  return { run, steps, signals, mode: await effectiveMode(workspaceId, leadId) };
}

export async function startSequence(workspaceId: string, leadId: string) {
  const db = getDb();
  const [lead] = await db.select().from(leads)
    .where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId))).limit(1);
  if (!lead) throw new Error("Lead nicht gefunden.");

  const existing = await getSequence(workspaceId, leadId);
  if (existing.run && ["pending","running","waiting","paused"].includes(existing.run.status)) return existing;

  const mode = await effectiveMode(workspaceId, leadId);
  const idempotencyKey = `adaptive:${leadId}:${Date.now()}`;
  const [run] = await db.insert(outboundWorkflowRuns).values({
    workspace: workspaceId,
    workflowKey: "adaptive_acquisition_v1",
    workflowVersion: 1,
    kind: "adaptive_sequence",
    status: "running",
    subjectType: "lead",
    subjectId: leadId,
    companyId: lead.normalizedCompany || lead.company,
    leadId,
    legacyCampaignId: lead.campaignId || null,
    idempotencyKey,
    input: { mode, company: lead.company },
    state: {
      mode,
      currentStep: "email_1",
      recommendation: "Erstkontakt vorbereiten",
      hot: false,
      humanRequired: mode !== "autopilot",
    },
    startedAt: new Date(),
    nextWakeAt: null,
  }).returning();

  for (let index = 0; index < blueprint.length; index += 1) {
    const item = blueprint[index];
    await db.insert(outboundWorkflowSteps).values({
      workspace: workspaceId,
      runId: run.id,
      stepKey: item.key,
      stepType: item.type,
      sequenceIndex: index,
      status: index === 0 ? "ready" : item.type === "wait" ? "waiting" : "pending",
      idempotencyKey: `${idempotencyKey}:${item.key}`,
      input: { label: item.label, offsetDays: item.offsetDays, channel: item.type === "email" ? "email" : undefined },
      wakeAt: item.type === "wait" ? wakeAt(item.offsetDays) : null,
    });
  }

  return getSequence(workspaceId, leadId);
}

async function addSignal(args: {
  workspaceId: string;
  runId: string;
  leadId: string;
  type: "reply_received" | "meeting_booked" | "unsubscribe" | "manual_pause" | "manual_resume" | "manual_cancel";
  payload?: Record<string, unknown>;
}) {
  const db = getDb();
  const key = `${args.type}:${args.runId}:${Date.now()}`;
  await db.insert(outboundWorkflowSignals).values({
    workspace: args.workspaceId,
    runId: args.runId,
    signalType: args.type,
    subjectType: "lead",
    subjectId: args.leadId,
    idempotencyKey: key,
    payload: args.payload || {},
  });
}

export async function refreshSequence(workspaceId: string, leadId: string) {
  const db = getDb();
  let current = await getSequence(workspaceId, leadId);
  if (!current.run) current = await startSequence(workspaceId, leadId);
  if (!current.run) throw new Error("Sequence konnte nicht gestartet werden.");

  const [lead] = await db.select().from(leads)
    .where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId))).limit(1);
  if (!lead) throw new Error("Lead nicht gefunden.");

  const run = current.run;
  const openSteps = current.steps.filter(step => !["completed","cancelled","failed"].includes(step.status));

  if (lead.contactLocked || lead.pipelineStage === "lost" || lead.tags.some(tag => ["opt-out","do-not-contact","gesperrt"].includes(tag.toLowerCase()))) {
    await Promise.all([
      db.update(outboundWorkflowRuns).set({
        status: "cancelled",
        terminalReason: lead.contactLockReason || "Kontakt gesperrt",
        cancelledAt: new Date(),
        nextWakeAt: null,
        state: { ...run.state, recommendation: "Kein weiterer Kontakt", humanRequired: false },
        updatedAt: new Date(),
      }).where(eq(outboundWorkflowRuns.id, run.id)),
      ...openSteps.map(step => db.update(outboundWorkflowSteps).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(outboundWorkflowSteps.id, step.id))),
    ]);
    await addSignal({ workspaceId, runId: run.id, leadId, type: "unsubscribe", payload: { reason: lead.contactLockReason } }).catch(() => undefined);
    return getSequence(workspaceId, leadId);
  }

  if (["call_booked","won"].includes(lead.pipelineStage)) {
    await Promise.all([
      db.update(outboundWorkflowRuns).set({
        status: "completed",
        terminalReason: lead.pipelineStage === "won" ? "Deal gewonnen" : "Termin gebucht",
        completedAt: new Date(),
        nextWakeAt: null,
        state: { ...run.state, recommendation: "Sequence abgeschlossen", humanRequired: false },
        updatedAt: new Date(),
      }).where(eq(outboundWorkflowRuns.id, run.id)),
      ...openSteps.map(step => db.update(outboundWorkflowSteps).set({ status: "cancelled", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(outboundWorkflowSteps.id, step.id))),
    ]);
    await addSignal({ workspaceId, runId: run.id, leadId, type: "meeting_booked", payload: { pipelineStage: lead.pipelineStage } }).catch(() => undefined);
    return getSequence(workspaceId, leadId);
  }

  if (lead.emailStatus === "replied" || lead.pipelineStage === "replied") {
    await Promise.all([
      db.update(outboundWorkflowRuns).set({
        status: "waiting",
        nextWakeAt: null,
        state: { ...run.state, recommendation: "Antwort persönlich übernehmen", humanRequired: true, replyDetected: true },
        updatedAt: new Date(),
      }).where(eq(outboundWorkflowRuns.id, run.id)),
      ...openSteps.filter(step => step.stepType === "email").map(step =>
        db.update(outboundWorkflowSteps).set({ status: "blocked", output: { reason: "reply_received" }, updatedAt: new Date() }).where(eq(outboundWorkflowSteps.id, step.id))
      ),
    ]);
    await addSignal({ workspaceId, runId: run.id, leadId, type: "reply_received", payload: { emailStatus: lead.emailStatus } }).catch(() => undefined);
    return getSequence(workspaceId, leadId);
  }

  const now = Date.now();
  for (const step of current.steps) {
    if (step.stepType === "wait" && step.status === "waiting" && step.wakeAt && step.wakeAt.getTime() <= now) {
      await db.update(outboundWorkflowSteps).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(outboundWorkflowSteps.id, step.id));
      const next = current.steps.find(candidate => candidate.sequenceIndex === step.sequenceIndex + 1);
      if (next && next.status === "pending") {
        await db.update(outboundWorkflowSteps).set({ status: "ready", updatedAt: new Date() }).where(eq(outboundWorkflowSteps.id, next.id));
      }
    }
  }

  const hot = lead.watchPercent >= 60;
  const nextSteps = await db.select().from(outboundWorkflowSteps).where(eq(outboundWorkflowSteps.runId, run.id)).orderBy(asc(outboundWorkflowSteps.sequenceIndex));
  const ready = nextSteps.find(step => step.status === "ready");
  const nextWait = nextSteps.find(step => step.status === "waiting" && step.wakeAt);
  const recommendation = hot
    ? "Hot Lead: jetzt anrufen oder persönlich reagieren"
    : ready?.stepType === "email"
      ? (ready.stepKey === "email_1" ? "Erstkontakt vorbereiten" : "Follow-up prüfen")
      : "Auf Reaktion warten";

  await db.update(outboundWorkflowRuns).set({
    status: ready ? "running" : nextWait ? "waiting" : "completed",
    nextWakeAt: nextWait?.wakeAt || null,
    completedAt: !ready && !nextWait ? new Date() : null,
    state: {
      ...run.state,
      currentStep: ready?.stepKey || nextWait?.stepKey || null,
      recommendation,
      hot,
      humanRequired: hot || current.mode !== "autopilot",
      watchPercent: lead.watchPercent,
    },
    updatedAt: new Date(),
  }).where(eq(outboundWorkflowRuns.id, run.id));

  return getSequence(workspaceId, leadId);
}

export async function sequenceAction(workspaceId: string, leadId: string, action: "pause" | "resume" | "cancel" | "complete_step", stepId?: string) {
  const db = getDb();
  const current = await getSequence(workspaceId, leadId);
  if (!current.run) throw new Error("Keine aktive Sequence.");
  const run = current.run;

  if (action === "pause") {
    await db.update(outboundWorkflowRuns).set({ status: "paused", state: { ...run.state, recommendation: "Manuell pausiert" }, updatedAt: new Date() }).where(eq(outboundWorkflowRuns.id, run.id));
    await addSignal({ workspaceId, runId: run.id, leadId, type: "manual_pause" });
  } else if (action === "resume") {
    await db.update(outboundWorkflowRuns).set({ status: "running", updatedAt: new Date() }).where(eq(outboundWorkflowRuns.id, run.id));
    await addSignal({ workspaceId, runId: run.id, leadId, type: "manual_resume" });
  } else if (action === "cancel") {
    await db.update(outboundWorkflowRuns).set({ status: "cancelled", terminalReason: "Manuell beendet", cancelledAt: new Date(), updatedAt: new Date() }).where(eq(outboundWorkflowRuns.id, run.id));
    await addSignal({ workspaceId, runId: run.id, leadId, type: "manual_cancel" });
  } else if (action === "complete_step" && stepId) {
    const step = current.steps.find(item => item.id === stepId);
    if (!step) throw new Error("Step nicht gefunden.");
    await db.update(outboundWorkflowSteps).set({ status: "completed", completedAt: new Date(), updatedAt: new Date() }).where(eq(outboundWorkflowSteps.id, step.id));
    const next = current.steps.find(item => item.sequenceIndex === step.sequenceIndex + 1);
    if (next && next.status === "pending") {
      await db.update(outboundWorkflowSteps).set({ status: "ready", updatedAt: new Date() }).where(eq(outboundWorkflowSteps.id, next.id));
    }
  }

  return refreshSequence(workspaceId, leadId);
}
