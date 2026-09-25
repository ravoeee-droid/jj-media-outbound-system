import test from "node:test";
import assert from "node:assert/strict";
import { extractMailReferenceIds, shouldStopEmailFollowups } from "../lib/outreach-policy.ts";

test("follow-ups stop for replies, meetings, lost leads and suppression tags", () => {
  const base = { pipelineStage: "contacted", contactLocked: false, emailStatus: "sent", tags: [] };
  assert.equal(shouldStopEmailFollowups(base), false);
  assert.equal(shouldStopEmailFollowups({ ...base, emailStatus: "replied" }), true);
  assert.equal(shouldStopEmailFollowups({ ...base, pipelineStage: "call_booked" }), true);
  assert.equal(shouldStopEmailFollowups({ ...base, pipelineStage: "lost" }), true);
  assert.equal(shouldStopEmailFollowups({ ...base, contactLocked: true }), true);
  assert.equal(shouldStopEmailFollowups({ ...base, tags: ["do-not-contact"] }), true);
});

test("mail reply references extract exact provider message ids", () => {
  const ids = extractMailReferenceIds({ references: "<first@jj-media.de> <second@jj-media.de>", inReplyTo: "<second@jj-media.de>" });
  assert.deepEqual([...ids], ["<first@jj-media.de>", "<second@jj-media.de>"]);
});
