import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { outboundEvidenceItems } from "@/db/schema";

export type FactReviewStatus = "proposed" | "auto_verified" | "approved" | "rejected";

export async function listFactsForLead(workspace: string, leadId: string) {
  return getDb()
    .select()
    .from(outboundEvidenceItems)
    .where(and(eq(outboundEvidenceItems.workspace, workspace), eq(outboundEvidenceItems.leadId, leadId)));
}

export async function reviewFact(args: {
  workspace: string;
  leadId: string;
  factId: string;
  action: "approve" | "reject" | "toggle_lock";
  reviewer: string;
}) {
  const db = getDb();
  const [fact] = await db.select().from(outboundEvidenceItems)
    .where(and(
      eq(outboundEvidenceItems.workspace, args.workspace),
      eq(outboundEvidenceItems.leadId, args.leadId),
      eq(outboundEvidenceItems.id, args.factId),
    ))
    .limit(1);
  if (!fact) throw new Error("Fakt nicht gefunden.");

  if (args.action === "toggle_lock") {
    const [updated] = await db.update(outboundEvidenceItems).set({
      locked: !fact.locked,
      reviewedBy: args.reviewer,
      reviewedAt: new Date(),
    }).where(eq(outboundEvidenceItems.id, fact.id)).returning();
    return updated;
  }

  const approved = args.action === "approve";
  const [updated] = await db.update(outboundEvidenceItems).set({
    reviewStatus: approved ? "approved" : "rejected",
    outreachAllowed: approved,
    locked: approved ? fact.locked : true,
    reviewedBy: args.reviewer,
    reviewedAt: new Date(),
  }).where(eq(outboundEvidenceItems.id, fact.id)).returning();
  return updated;
}

export async function getAllowedFacts(workspace: string, leadId: string) {
  const facts = await listFactsForLead(workspace, leadId);
  return facts.filter((fact) =>
    fact.outreachAllowed &&
    fact.reviewStatus !== "rejected" &&
    !fact.expiresAt || (fact.expiresAt ? fact.expiresAt.getTime() > Date.now() : true),
  );
}

export async function buildClaimContext(workspace: string, leadId: string) {
  const facts = await listFactsForLead(workspace, leadId);
  const allowed = facts.filter((fact) => {
    const fresh = !fact.expiresAt || fact.expiresAt.getTime() > Date.now();
    return fresh && fact.outreachAllowed && ["auto_verified", "approved"].includes(fact.reviewStatus);
  });
  return {
    allowedClaims: allowed.map((fact) => ({
      id: fact.id,
      key: fact.evidenceKey,
      claim: fact.claim,
      value: fact.valueText || "",
      sourceUrl: fact.sourceUrl || "",
      confidence: Number(fact.confidence || 0),
      locked: fact.locked,
    })),
    blockedCount: facts.length - allowed.length,
    totalCount: facts.length,
  };
}

export async function assertClaimsGrounded(workspace: string, leadId: string, factIds: string[]) {
  if (!factIds.length) return { ok: true, facts: [] };
  const context = await buildClaimContext(workspace, leadId);
  const allowed = new Map(context.allowedClaims.map((fact) => [fact.id, fact]));
  const missing = factIds.filter((id) => !allowed.has(id));
  if (missing.length) {
    throw new Error("FACT_GATE_BLOCKED: Eine oder mehrere Aussagen sind nicht freigegeben oder nicht mehr aktuell.");
  }
  return { ok: true, facts: factIds.map((id) => allowed.get(id)!) };
}
