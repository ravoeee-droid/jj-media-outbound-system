import { z } from "zod";
import { requireWorkspace, apiError } from "@/lib/workspace";
import {
  createGmailDraft,
  getGmailProfile,
  getGmailThreadDetail,
  getGoogleConnectionStatus,
  listGmailWorkspaceThreads,
  modifyGmailThread,
  sendGmailMessage,
  sendGmailReply,
  type GmailThreadAction,
  type GmailView,
} from "@/lib/google";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const views = new Set<GmailView>(["inbox", "unread", "starred", "sent", "drafts", "all", "trash"]);
const actions = new Set<GmailThreadAction>(["archive", "read", "unread", "star", "unstar", "trash", "untrash", "spam", "inbox"]);

export async function GET(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const connection = await getGoogleConnectionStatus(workspace.user.id);
    if (!connection.connected) return Response.json({ connected: false, canManageMail: false });
    if (!connection.canManageMail) return Response.json({ connected: true, canManageMail: false, reconnectRequired: true });

    const url = new URL(request.url);
    const threadId = url.searchParams.get("threadId")?.trim();
    if (threadId) {
      const [thread, profile] = await Promise.all([
        getGmailThreadDetail(workspace.user.id, threadId),
        getGmailProfile(workspace.user.id),
      ]);
      return Response.json({ connected: true, canManageMail: true, thread, profile });
    }

    const rawView = url.searchParams.get("view") || "inbox";
    const view = (views.has(rawView as GmailView) ? rawView : "inbox") as GmailView;
    const q = (url.searchParams.get("q") || "").slice(0, 500);
    const pageToken = (url.searchParams.get("pageToken") || "").slice(0, 1_000);
    const [mail, profile] = await Promise.all([
      listGmailWorkspaceThreads(workspace.user.id, { view, q, pageToken, maxResults: 30 }),
      getGmailProfile(workspace.user.id),
    ]);
    return Response.json({ connected: true, canManageMail: true, ...mail, profile, view, q });
  } catch (error) {
    return apiError(error);
  }
}

const sendSchema = z.object({
  action: z.literal("send"),
  to: z.string().min(3).max(1_000),
  cc: z.string().max(1_000).optional(),
  bcc: z.string().max(1_000).optional(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(100_000),
});
const replySchema = z.object({
  action: z.literal("reply"),
  threadId: z.string().min(1).max(300),
  to: z.string().min(3).max(1_000),
  subject: z.string().max(500).optional(),
  body: z.string().min(1).max(100_000),
});
const draftSchema = z.object({
  action: z.literal("draft"),
  to: z.string().min(3).max(1_000),
  cc: z.string().max(1_000).optional(),
  bcc: z.string().max(1_000).optional(),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(100_000),
});
const modifySchema = z.object({
  action: z.literal("modify"),
  threadIds: z.array(z.string().min(1).max(300)).min(1).max(50),
  operation: z.string().min(1).max(30),
});
const inputSchema = z.discriminatedUnion("action", [sendSchema, replySchema, draftSchema, modifySchema]);

export async function POST(request: Request) {
  try {
    const workspace = await requireWorkspace();
    const connection = await getGoogleConnectionStatus(workspace.user.id);
    if (!connection.connected) return Response.json({ error: "Gmail ist noch nicht verbunden." }, { status: 409 });
    if (!connection.canManageMail) return Response.json({ error: "Bitte Gmail einmal neu verbinden, damit Posteingang und Verwaltung freigeschaltet werden." }, { status: 409 });

    const input = inputSchema.parse(await request.json());
    if (input.action === "send") {
      const result = await sendGmailMessage({ userId: workspace.user.id, to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, body: input.body });
      return Response.json({ ok: true, result });
    }
    if (input.action === "reply") {
      const result = await sendGmailReply({ userId: workspace.user.id, threadId: input.threadId, to: input.to, subject: input.subject, body: input.body });
      return Response.json({ ok: true, result });
    }
    if (input.action === "draft") {
      const result = await createGmailDraft({ userId: workspace.user.id, to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, body: input.body });
      return Response.json({ ok: true, result });
    }

    if (!actions.has(input.operation as GmailThreadAction)) return Response.json({ error: "Unbekannte Mail-Aktion." }, { status: 400 });
    const operation = input.operation as GmailThreadAction;
    const results = await Promise.allSettled(input.threadIds.map((threadId) => modifyGmailThread(workspace.user.id, threadId, operation)));
    const failed = results.filter((result) => result.status === "rejected").length;
    if (failed) return Response.json({ ok: failed < results.length, changed: results.length - failed, failed }, { status: failed === results.length ? 502 : 207 });
    return Response.json({ ok: true, changed: results.length, failed: 0 });
  } catch (error) {
    return apiError(error);
  }
}
