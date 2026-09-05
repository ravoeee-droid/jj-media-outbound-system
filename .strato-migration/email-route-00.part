import { z } from "zod";
import { apiError, requireWorkspace } from "@/lib/workspace";
import {
  createStratoDraft,
  getStratoMailThread,
  listStratoMailThreads,
  modifyStratoMailMessages,
  sendStratoMessage,
  sendStratoReply,
  stratoMailStatus,
  type MailThreadAction,
  type MailView,
} from "@/lib/strato-mail";

export const runtime = "nodejs";
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const views = new Set<MailView>(["inbox", "unread", "starred", "sent", "drafts", "all", "trash"]);
const actions = new Set<MailThreadAction>(["archive", "read", "unread", "star", "unstar", "trash", "untrash", "spam", "inbox"]);

export async function GET(request: Request) {
  try {
    await requireWorkspace();
    const status = stratoMailStatus();
    if (!status.configured) return Response.json({ connected: false, canManageMail: false, provider: "strato", profile: status.email ? { emailAddress: status.email } : null });

    const url = new URL(request.url);
    const threadId = url.searchParams.get("threadId")?.trim();
    if (threadId) return Response.json(await getStratoMailThread(threadId));

    const rawView = url.searchParams.get("view") || "inbox";
    const view = (views.has(rawView as MailView) ? rawView : "inbox") as MailView;
    const q = (url.searchParams.get("q") || "").slice(0, 500);
    return Response.json(await listStratoMailThreads({ view, q, maxResults: 30 }));
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
  threadId: z.string().min(1).max(2_000),
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
  threadIds: z.array(z.string().min(1).max(2_000)).min(1).max(50),
  operation: z.string().min(1).max(30),
});
const inputSchema = z.discriminatedUnion("action", [sendSchema, replySchema, draftSchema, modifySchema]);

export async function POST(request: Request) {
  try {
    await requireWorkspace();
    if (!stratoMailStatus().configured) return Response.json({ error: "STRATO Mail ist noch nicht eingerichtet." }, { status: 409 });
    const input = inputSchema.parse(await request.json());

    if (input.action === "send") {
      const result = await sendStratoMessage({ to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, body: input.body });
      return Response.json({ ok: true, result });
    }
    if (input.action === "reply") {
      const result = await sendStratoReply({ threadId: input.threadId, to: input.to, subject: input.subject, body: input.body });
      return Response.json({ ok: true, result });
    }
    if (input.action === "draft") {
      const result = await createStratoDraft({ to: input.to, cc: input.cc, bcc: input.bcc, subject: input.subject, body: input.body });
      return Response.json({ ok: true, result });
    }

    if (!actions.has(input.operation as MailThreadAction)) return Response.json({ error: "Unbekannte Mail-Aktion." }, { status: 400 });
    const result = await modifyStratoMailMessages(input.threadIds, input.operation as MailThreadAction);
    return Response.json({ ok: true, changed: result.changed, failed: 0 });
  } catch (error) {
    return apiError(error);
  }
}
