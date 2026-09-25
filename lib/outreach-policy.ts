export type FollowupLeadState = {
  pipelineStage: string;
  contactLocked: boolean;
  emailStatus: string;
  tags: string[];
};

const STOP_TAGS = new Set(["opt-out", "do-not-contact", "gesperrt", "unsubscribe", "abgemeldet"]);

export function shouldStopEmailFollowups(lead: FollowupLeadState) {
  if (lead.contactLocked) return true;
  if (["call_booked", "won", "lost"].includes(lead.pipelineStage)) return true;
  if (["replied", "stopped"].includes(lead.emailStatus)) return true;
  return lead.tags.some((tag) => STOP_TAGS.has(tag.trim().toLowerCase()));
}

export function extractMailReferenceIds(input: { references?: string; inReplyTo?: string }) {
  const ids = new Set<string>();
  for (const value of [input.references || "", input.inReplyTo || ""]) {
    for (const match of value.matchAll(/<[^<>\s]+>/g)) ids.add(match[0]);
    const trimmed = value.trim();
    if (trimmed && !trimmed.includes(" ") && !trimmed.includes("<")) ids.add(trimmed);
  }
  return ids;
}
