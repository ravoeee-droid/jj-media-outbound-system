import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { acquisitionLeadScores, leads, settings } from "@/db/schema";
import { buildClaimContext } from "@/lib/facts-ledger";

export type Personalization = {
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

function key(leadId: string) {
  return "acquisition_personalization:" + leadId;
}

function firstName(contact: string) {
  return contact.trim().split(/\s+/)[0] || "Guten Tag";
}

function pickFactValue(facts: Awaited<ReturnType<typeof buildClaimContext>>["allowedClaims"], matcher: RegExp) {
  return facts.find((fact) => matcher.test((fact.key + " " + fact.claim + " " + fact.value).toLowerCase()));
}

export async function getPersonalization(workspaceId: string, leadId: string): Promise<Personalization | null> {
  const [row] = await getDb().select({ value: settings.value }).from(settings)
    .where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, key(leadId)))).limit(1);
  if (!row?.value) return null;
  try { return JSON.parse(row.value) as Personalization; } catch { return null; }
}

export async function savePersonalization(workspaceId: string, leadId: string, personalization: Personalization) {
  await getDb().insert(settings).values({
    workspaceId,
    key: key(leadId),
    value: JSON.stringify(personalization),
  }).onConflictDoUpdate({
    target: [settings.workspaceId, settings.key],
    set: { value: JSON.stringify(personalization), updatedAt: new Date() },
  });
  return personalization;
}

export async function generatePersonalization(workspaceId: string, leadId: string) {
  const db = getDb();
  const [lead, score, existing, claims] = await Promise.all([
    db.select().from(leads).where(and(eq(leads.workspaceId, workspaceId), eq(leads.id, leadId))).limit(1).then((rows) => rows[0]),
    db.select().from(acquisitionLeadScores).where(and(eq(acquisitionLeadScores.workspaceId, workspaceId), eq(acquisitionLeadScores.leadId, leadId))).limit(1).then((rows) => rows[0] || null),
    getPersonalization(workspaceId, leadId),
    buildClaimContext(workspaceId, leadId),
  ]);
  if (!lead) throw new Error("Lead nicht gefunden.");

  const facts = claims.allowedClaims;
  const hiring = pickFactValue(facts, /active_hiring|personalbedarf|offene stelle/);
  const website = pickFactValue(facts, /weak_web_presence|website|web-auftritt/);
  const social = pickFactValue(facts, /social_presence|instagram|social-media/);
  const decisionMaker = pickFactValue(facts, /executive_contact|geschäftsführung|ansprech/);

  const locked = new Set(existing?.lockedFields || []);
  const keep = <K extends keyof Personalization>(field: K, generated: Personalization[K]) =>
    existing && locked.has(String(field)) ? existing[field] : generated;

  let angle = score?.recommendedAngle || "Konkreten digitalen Wachstumshebel mit kurzer persönlicher Analyse ansprechen.";
  let hook = "Ich habe mir Ihren digitalen Auftritt angesehen und einen konkreten Ansatzpunkt gefunden.";
  let rationale = score?.rationale || "Angle basiert auf den stärksten belegten Research-Fakten.";

  if (hiring) {
    hook = "Mir ist aufgefallen, dass Sie aktuell Personal suchen – genau deshalb habe ich mir Ihren Recruiting-Auftritt genauer angesehen.";
    angle = score?.recommendedAngle || "Offenen Personalbedarf als konkreten Kosten- und Kapazitätshebel ansprechen.";
  } else if (website) {
    hook = "Ich habe mir Ihren aktuellen Web-Auftritt angesehen und dabei einen klaren Conversion-Hebel entdeckt.";
  } else if (social) {
    hook = "Ich habe mir Ihren Social-Media-Auftritt angesehen und drei konkrete Hebel entdeckt, die ich zuerst testen würde.";
  }

  const greeting = "Hallo " + firstName(lead.contact) + ",";
  const subject = hiring
    ? "Kurze Recruiting-Idee für " + lead.company
    : social
      ? "Kurze Social-Media-Idee für " + lead.company
      : "Kurze Idee für " + lead.company;
  const body = [
    greeting,
    "",
    hook,
    "",
    "Ich habe dazu eine kurze persönliche Analyse vorbereitet:",
    "{{video_link}}",
    "",
    "Wenn der Ansatz relevant ist, können Sie direkt auf der Seite einen 15-Minuten-Termin auswählen.",
    "",
    "Viele Grüße",
    "Jessica | JJ-Media",
  ].join("\n");

  const landingEyebrow = hiring ? "Persönliche Recruiting-Analyse" : "Persönliche Potenzial-Analyse";
  const landingHeadline = hiring
    ? "Wo {{unternehmen}} im Recruiting aktuell am schnellsten Hebel gewinnen kann."
    : social
      ? "3 konkrete Social-Media-Hebel für {{unternehmen}}."
      : "3 konkrete digitale Hebel für {{unternehmen}}.";
  const landingSubheadline = hiring
    ? "Kurze Analyse auf Basis belegter Signale aus Ihrem aktuellen Recruiting-Auftritt – mit einem klaren nächsten Schritt."
    : "Kurze persönliche Analyse auf Basis Ihres aktuellen digitalen Auftritts – konkret, nachvollziehbar und ohne allgemeinen Agentur-Pitch.";
  const videoHook = decisionMaker?.value
    ? "Ich habe mir " + lead.company + " und Ihren aktuellen Auftritt angesehen und würde Ihnen direkt drei Punkte zeigen, die ich zuerst angehen würde."
    : "Ich habe mir " + lead.company + " angesehen und drei konkrete Punkte vorbereitet, die ich zuerst testen würde.";

  const next: Personalization = {
    version: (existing?.version || 0) + 1,
    status: existing?.status === "locked" ? "locked" : "draft",
    angle: keep("angle", angle) as string,
    hook: keep("hook", hook) as string,
    subject: keep("subject", subject) as string,
    emailBody: keep("emailBody", body) as string,
    landingEyebrow: keep("landingEyebrow", landingEyebrow) as string,
    landingHeadline: keep("landingHeadline", landingHeadline) as string,
    landingSubheadline: keep("landingSubheadline", landingSubheadline) as string,
    videoHook: keep("videoHook", videoHook) as string,
    cta: keep("cta", "15 Minuten Potenzial-Call") as string,
    factIds: facts.slice(0, 8).map((fact) => fact.id),
    lockedFields: existing?.lockedFields || [],
    rationale,
    generatedBy: "facts_rules_v1",
    generatedAt: new Date().toISOString(),
  };

  await savePersonalization(workspaceId, leadId, next);
  return next;
}

export async function updatePersonalization(workspaceId: string, leadId: string, patch: Partial<Personalization>) {
  const current = await getPersonalization(workspaceId, leadId) || await generatePersonalization(workspaceId, leadId);
  const next = { ...current, ...patch, version: current.version + 1, generatedAt: new Date().toISOString() };
  return savePersonalization(workspaceId, leadId, next);
}
