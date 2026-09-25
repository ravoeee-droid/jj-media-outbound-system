import { and, count, desc, eq, inArray } from "drizzle-orm";
import { getDb } from "@/db";
import { activities, leads, researchCandidates, settings, users, workspaceMembers, workspaces } from "@/db/schema";
import { getDailyQueue } from "@/lib/daily-queue";
import { commitLeadIntake, prepareLeadIntake } from "@/lib/lead-intake";
import {
  markResearchCandidatesImported,
  researchCandidatesForIntake,
} from "@/lib/research-feed";
import { hasPermission } from "@/lib/team";
import { withLease } from "@/lib/whatsapp/config";

export type LeadSupplyConfig = {
  enabled: boolean;
  queueTarget: number;
  assigneeIds: string[];
};

export const defaultLeadSupplyConfig: LeadSupplyConfig = {
  enabled: false,
  queueTarget: 30,
  assigneeIds: [],
};

type Caller = {
  userId: string;
  name: string;
  email: string;
  role: string;
  permissions: string[];
  queueCount: number;
};

export type LeadSupplySummary = {
  finishedAt: string;
  enabled: boolean;
  targetPerCaller: number;
  candidatePoolBefore: number;
  imported: number;
  created: number;
  skippedExisting: number;
  remainingPool: number;
  callers: Array<{
    userId: string;
    name: string;
    before: number;
    added: number;
    after: number;
    target: number;
  }>;
};

const CONFIG_KEY = "lead_supply_config";
const LAST_RUN_KEY = "lead_supply_last_run";
const ASSIGNABLE_ROLES = new Set(["owner", "admin", "sales", "setter"]);

export function normalizeLeadSupplyConfig(input: Partial<LeadSupplyConfig>): LeadSupplyConfig {
  return {
    enabled: Boolean(input.enabled),
    queueTarget: Math.max(10, Math.min(60, Math.round(Number(input.queueTarget) || 30))),
    assigneeIds: [...new Set((Array.isArray(input.assigneeIds) ? input.assigneeIds : []).filter((value) => typeof value === "string" && /^[0-9a-f-]{36}$/i.test(value)))].slice(0, 20),
  };
}

export async function getLeadSupplyConfig(workspaceId: string) {
  const [row] = await getDb()
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, CONFIG_KEY)))
    .limit(1);
  if (!row?.value) return defaultLeadSupplyConfig;
  try {
    return normalizeLeadSupplyConfig(JSON.parse(row.value) as Partial<LeadSupplyConfig>);
  } catch {
    return defaultLeadSupplyConfig;
  }
}

export async function saveLeadSupplyConfig(workspaceId: string, input: LeadSupplyConfig) {
  const config = normalizeLeadSupplyConfig(input);
  await getDb()
    .insert(settings)
    .values({ workspaceId, key: CONFIG_KEY, value: JSON.stringify(config) })
    .onConflictDoUpdate({
      target: [settings.workspaceId, settings.key],
      set: { value: JSON.stringify(config), updatedAt: new Date() },
    });
  return config;
}

export async function getLeadSupplyLastRun(workspaceId: string): Promise<LeadSupplySummary | null> {
  const [row] = await getDb()
    .select({ value: settings.value })
    .from(settings)
    .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, LAST_RUN_KEY)))
    .limit(1);
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value) as LeadSupplySummary;
  } catch {
    return null;
  }
}

async function saveLeadSupplyLastRun(workspaceId: string, summary: LeadSupplySummary) {
  await getDb()
    .insert(settings)
    .values({ workspaceId, key: LAST_RUN_KEY, value: JSON.stringify(summary) })
    .onConflictDoUpdate({
      target: [settings.workspaceId, settings.key],
      set: { value: JSON.stringify(summary), updatedAt: new Date() },
    });
}

export async function listAssignableCallers(workspaceId: string): Promise<Caller[]> {
  const rows = await getDb()
    .select({
      userId: users.id,
      name: users.name,
      email: users.email,
      role: workspaceMembers.role,
      permissions: workspaceMembers.permissions,
    })
    .from(workspaceMembers)
    .innerJoin(users, eq(users.id, workspaceMembers.userId))
    .where(and(eq(workspaceMembers.workspaceId, workspaceId), eq(users.status, "active")));

  const eligible = rows.filter((row) =>
    ASSIGNABLE_ROLES.has(row.role)
    && hasPermission(row.role, row.permissions, "manage_leads")
    && hasPermission(row.role, row.permissions, "view_own_leads")
  );

  const withQueues = await Promise.all(eligible.map(async (row) => {
    const queue = await getDailyQueue(workspaceId, row.userId, 1);
    return {
      userId: row.userId,
      name: row.name || row.email || "Mitarbeiter",
      email: row.email || "",
      role: row.role,
      permissions: row.permissions,
      queueCount: queue.stats.total,
    };
  }));

  return withQueues.sort((a, b) => a.name.localeCompare(b.name, "de"));
}

function roundRobinAssignments(
  candidateIds: string[],
  callers: Caller[],
  target: number,
) {
  const state = callers.map((caller) => ({
    caller,
    projected: caller.queueCount,
    ids: [] as string[],
  }));
  const needed = () => state.filter((item) => item.projected < target);
  let index = 0;

  while (index < candidateIds.length) {
    const open = needed();
    if (!open.length) break;
    open.sort((a, b) =>
      (a.projected / target) - (b.projected / target)
      || a.projected - b.projected
      || a.caller.name.localeCompare(b.caller.name, "de")
    );
    const next = open[0];
    next.ids.push(candidateIds[index]);
    next.projected += 1;
    index += 1;
  }

  return state.filter((item) => item.ids.length);
}

async function importCandidateBatch(args: {
  workspaceId: string;
  actorUserId: string;
  ownerId: string;
  candidateIds: string[];
}) {
  const raw = await researchCandidatesForIntake(args.workspaceId, args.candidateIds);
  if (!raw.length) return { created: 0, imported: 0, skippedExisting: 0 };

  const preview = await prepareLeadIntake(args.workspaceId, raw);
  const selectedIntakeIds = preview.decisions
    .filter((decision) => decision.eligible)
    .map((decision) => decision.intakeId);

  const result = await commitLeadIntake({
    workspaceId: args.workspaceId,
    userId: args.actorUserId,
    raw,
    selectedIntakeIds,
    source: "Lead Scout Auto-Supply",
    ownerId: args.ownerId,
  });

  if (result.createdLeadIds.length) {
    const now = new Date();
    await Promise.all([
      getDb().update(leads).set({
        pipelineStage: "contact_ready",
        researchStatus: "enriched",
        validationStatus: "validated",
        analysisStatus: "ready",
        callStatus: "not_started",
        nextAction: "call",
        nextActionAt: null,
        lastActivityAt: now,
        updatedAt: now,
      }).where(and(
        eq(leads.workspaceId, args.workspaceId),
        inArray(leads.id, result.createdLeadIds),
      )),
      getDb().insert(activities).values(result.createdLeadIds.map((leadId) => ({
        workspaceId: args.workspaceId,
        leadId,
        userId: args.actorUserId,
        type: "auto_queue_supplied",
        title: "Automatisch für Tages-Queue bereitgestellt",
        detail: "Validierter Call-ready Lead aus dem Lead Scout.",
      }))),
    ]);
  }

  const mappings = [...result.committed, ...result.alreadyPresent].flatMap((item) =>
    item.candidateIds.map((candidateId) => ({ candidateId, leadId: item.leadId }))
  );
  const imported = await markResearchCandidatesImported(args.workspaceId, mappings);

  return {
    created: result.createdLeadIds.length,
    imported,
    skippedExisting: result.updatedLeadIds.length + result.alreadyPresent.length,
  };
}

export async function runLeadSupply(workspaceId: string, override?: Partial<LeadSupplyConfig>) {
  return withLease(workspaceId, "lead-supply", async () => {
    const stored = await getLeadSupplyConfig(workspaceId);
    const config = normalizeLeadSupplyConfig({ ...stored, ...override });
    const callers = await listAssignableCallers(workspaceId);
    const selected = callers.filter((caller) => config.assigneeIds.includes(caller.userId));

    const [poolRows, poolCountRows] = await Promise.all([
      getDb()
        .select({ id: researchCandidates.id })
        .from(researchCandidates)
        .where(and(
          eq(researchCandidates.workspaceId, workspaceId),
          eq(researchCandidates.status, "call_ready"),
        ))
        .orderBy(desc(researchCandidates.score), desc(researchCandidates.discoveredAt))
        .limit(250),
      getDb()
        .select({ value: count() })
        .from(researchCandidates)
        .where(and(
          eq(researchCandidates.workspaceId, workspaceId),
          eq(researchCandidates.status, "call_ready"),
        )),
    ]);
    const candidatePoolBefore = Number(poolCountRows[0]?.value || 0);

    if (!config.enabled || !selected.length) {
      const summary: LeadSupplySummary = {
        finishedAt: new Date().toISOString(),
        enabled: config.enabled,
        targetPerCaller: config.queueTarget,
        candidatePoolBefore,
        imported: 0,
        created: 0,
        skippedExisting: 0,
        remainingPool: candidatePoolBefore,
        callers: selected.map((caller) => ({
          userId: caller.userId,
          name: caller.name,
          before: caller.queueCount,
          added: 0,
          after: caller.queueCount,
          target: config.queueTarget,
        })),
      };
      await saveLeadSupplyLastRun(workspaceId, summary);
      return { ok: true, configured: Boolean(selected.length), config, summary };
    }

    const totalDeficit = selected.reduce((sum, caller) => sum + Math.max(0, config.queueTarget - caller.queueCount), 0);
    const maxNeeded = Math.min(100, totalDeficit);

    const [workspace] = await getDb()
      .select({ ownerId: workspaces.ownerId })
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    if (!workspace) throw new Error("Workspace nicht gefunden.");

    const addedByUser = new Map<string, number>();
    let created = 0;
    let imported = 0;
    let skippedExisting = 0;
    let cursor = 0;

    for (let pass = 0; pass < 3 && cursor < poolRows.length; pass += 1) {
      const currentCallers = selected.map((caller) => ({
        ...caller,
        queueCount: caller.queueCount + (addedByUser.get(caller.userId) || 0),
      }));
      const remainingDeficit = currentCallers.reduce(
        (sum, caller) => sum + Math.max(0, config.queueTarget - caller.queueCount),
        0,
      );
      if (!remainingDeficit) break;

      const take = Math.min(100 - created, remainingDeficit, poolRows.length - cursor);
      if (take <= 0) break;
      const candidateIds = poolRows.slice(cursor, cursor + take).map((row) => row.id);
      cursor += candidateIds.length;
      const allocations = roundRobinAssignments(candidateIds, currentCallers, config.queueTarget);

      for (const allocation of allocations) {
        for (let index = 0; index < allocation.ids.length; index += 30) {
          const batch = allocation.ids.slice(index, index + 30);
          const result = await importCandidateBatch({
            workspaceId,
            actorUserId: workspace.ownerId,
            ownerId: allocation.caller.userId,
            candidateIds: batch,
          });
          created += result.created;
          imported += result.imported;
          skippedExisting += result.skippedExisting;
          addedByUser.set(
            allocation.caller.userId,
            (addedByUser.get(allocation.caller.userId) || 0) + result.created,
          );
        }
      }

      if (created >= maxNeeded) break;
    }

    const [remainingCount] = await getDb()
      .select({ value: count() })
      .from(researchCandidates)
      .where(and(
        eq(researchCandidates.workspaceId, workspaceId),
        eq(researchCandidates.status, "call_ready"),
      ));
    const remainingPool = Number(remainingCount?.value || 0);

    const summary: LeadSupplySummary = {
      finishedAt: new Date().toISOString(),
      enabled: true,
      targetPerCaller: config.queueTarget,
      candidatePoolBefore,
      imported,
      created,
      skippedExisting,
      remainingPool,
      callers: selected.map((caller) => {
        const added = addedByUser.get(caller.userId) || 0;
        return {
          userId: caller.userId,
          name: caller.name,
          before: caller.queueCount,
          added,
          after: caller.queueCount + added,
          target: config.queueTarget,
        };
      }),
    };
    await saveLeadSupplyLastRun(workspaceId, summary);
    return {
      ok: true,
      configured: true,
      config,
      summary,
      remainingPool,
    };
  });
}
