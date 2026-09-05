import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts } from "@/db/schema";

type GoogleAccount = typeof accounts.$inferSelect;

type GmailHeader = { name: string; value: string };
type GmailPart = {
  mimeType?: string;
  filename?: string;
  headers?: GmailHeader[];
  body?: { data?: string; size?: number; attachmentId?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
};

async function googleAccount(userId: string) {
  const [account] = await getDb()
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  return account;
}

async function refreshGoogleAccessToken(account: GoogleAccount) {
  if (!account.refresh_token) throw new Error("Google muss erneut verbunden werden, da kein Refresh-Token gespeichert ist.");
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: process.env.AUTH_GOOGLE_ID ?? "",
      client_secret: process.env.AUTH_GOOGLE_SECRET ?? "",
      grant_type: "refresh_token",
      refresh_token: account.refresh_token,
    }),
  });
  if (!response.ok) throw new Error("Google-Zugriff konnte nicht erneuert werden.");
  const token = await response.json() as { access_token: string; expires_in?: number; scope?: string; token_type?: string };
  const expiresAt = Math.floor(Date.now() / 1000) + (token.expires_in ?? 3600);
  await getDb()
    .update(accounts)
    .set({
      access_token: token.access_token,
      expires_at: expiresAt,
      scope: token.scope ?? account.scope,
      token_type: token.token_type ?? account.token_type,
    })
    .where(and(eq(accounts.provider, "google"), eq(accounts.providerAccountId, account.providerAccountId)));
  return token.access_token;
}

export async function getGoogleAccessToken(userId: string) {
  const account = await googleAccount(userId);
  if (!account) throw new Error("Google/Gmail ist noch nicht verbunden.");
  const currentEpoch = Math.floor(Date.now() / 1000);
  if (account.access_token && account.expires_at && account.expires_at > currentEpoch + 60) return account.access_token;
  return refreshGoogleAccessToken(account);
}

export async function getGoogleConnectionStatus(userId: string) {
  const account = await googleAccount(userId);
  const scope = account?.scope || "";
  return {
    connected: Boolean(account?.refresh_token || account?.access_token),
    canManageMail: scope.includes("https://www.googleapis.com/auth/gmail.modify") || scope.includes("https://mail.google.com/"),
    scope,
  };
}

function base64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decodeBase64Url(value = "") {
  if (!value) return "";
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
  try { return Buffer.from(padded, "base64").toString("utf8"); } catch { return ""; }
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function mimeHeader(name: string, value?: string) {
  const clean = value ? safeHeader(value) : "";
  return clean ? `${name}: ${clean}` : "";
}

function buildMime(args: {
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html?: string;
  inReplyTo?: string;
  references?: string;
}) {
  const to = safeHeader(args.to);
  const subject = safeHeader(args.subject);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+(?:\s*,\s*[^\s@]+@[^\s@]+\.[^\s@]+)*$/.test(to)) throw new Error("Die Empfängeradresse ist ungültig.");
  if (!subject) throw new Error("Die Betreffzeile ist leer.");

  const boundary = `jj_${Date.now().toString(36)}_${crypto.randomUUID().slice(0, 8)}`;
  const headers = [
    `To: ${to}`,
    mimeHeader("Cc", args.cc),
    mimeHeader("Bcc", args.bcc),
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    mimeHeader("In-Reply-To", args.inReplyTo),
    mimeHeader("References", args.references),
    "MIME-Version: 1.0",
  ].filter(Boolean);

  return [
    ...headers,
    ...(args.html
      ? [`Content-Type: multipart/alternative; boundary="${boundary}"`]
      : ['Content-Type: text/plain; charset="UTF-8"', "Content-Transfer-Encoding: 8bit"]),
    "",
    ...(args.html
      ? [
          `--${boundary}`,
          'Content-Type: text/plain; charset="UTF-8"',
          "Content-Transfer-Encoding: 8bit",
          "",
          args.body,
          `--${boundary}`,
          'Content-Type: text/html; charset="UTF-8"',
          "Content-Transfer-Encoding: 8bit",
          "",
          args.html,
          `--${boundary}--`,
        ]
      : [args.body]),
  ].join("\r\n");
}

async function gmailFetch(userId: string, path: string, init: RequestInit = {}) {
  const accessToken = await getGoogleAccessToken(userId);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${accessToken}`,
      ...(init.body ? { "content-type": "application/json" } : {}),
      ...(init.headers || {}),
    },
    cache: "no-store",
    signal: init.signal || AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (response.status === 403 && /scope|permission|insufficient/i.test(detail)) {
      throw new Error("Gmail braucht zusätzliche Rechte. Bitte die E-Mail-Verbindung einmal neu verbinden.");
    }
    throw new Error(`Gmail-API Fehler (${response.status}): ${detail.slice(0, 220)}`);
  }
  if (response.status === 204) return null;
  return response.json();
}

export async function sendGmailMessage(args: {
  userId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html?: string;
  threadId?: string | null;
  inReplyTo?: string;
  references?: string;
}) {
  const raw = base64Url(buildMime(args));
  return gmailFetch(args.userId, "/messages/send", {
    method: "POST",
    body: JSON.stringify({ raw, ...(args.threadId ? { threadId: args.threadId } : {}) }),
  }) as Promise<{ id: string; threadId: string; labelIds?: string[] }>;
}

export async function createGmailDraft(args: {
  userId: string;
  to: string;
  cc?: string;
  bcc?: string;
  subject: string;
  body: string;
  html?: string;
  threadId?: string | null;
  inReplyTo?: string;
  references?: string;
}) {
  const raw = base64Url(buildMime(args));
  return gmailFetch(args.userId, "/drafts", {
    method: "POST",
    body: JSON.stringify({ message: { raw, ...(args.threadId ? { threadId: args.threadId } : {}) } }),
  }) as Promise<{ id: string; message?: { id: string; threadId: string } }>;
}

function header(payload: GmailPart | undefined, name: string) {
  return payload?.headers?.find((entry) => entry.name.toLowerCase() === name.toLowerCase())?.value || "";
}

function htmlToText(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/div>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{4,}/g, "\n\n\n")
    .trim();
}

function extractBodies(part?: GmailPart): { plain: string; html: string } {
  if (!part) return { plain: "", html: "" };
  let plain = "";
  let html = "";
  const walk = (node: GmailPart) => {
    const mime = node.mimeType || "";
    const body = decodeBase64Url(node.body?.data || "");
    if (mime === "text/plain" && body && !plain) plain = body;
    if (mime === "text/html" && body && !html) html = body;
    for (const child of node.parts || []) walk(child);
  };
  walk(part);
  if (!plain && part.body?.data) {
    const own = decodeBase64Url(part.body.data);
    if ((part.mimeType || "").includes("html")) html = own;
    else plain = own;
  }
  return { plain: plain.trim(), html };
}

function threadMessage(message: GmailMessage) {
  const bodies = extractBodies(message.payload);
  return {
    id: message.id,
    threadId: message.threadId,
    labels: message.labelIds || [],
    from: header(message.payload, "From"),
    to: header(message.payload, "To"),
    cc: header(message.payload, "Cc"),
    subject: header(message.payload, "Subject"),
    date: header(message.payload, "Date"),
    messageId: header(message.payload, "Message-ID"),
    references: header(message.payload, "References"),
    body: (bodies.plain || htmlToText(bodies.html) || message.snippet || "").slice(0, 60_000),
    snippet: message.snippet || "",
    internalDate: message.internalDate || "",
  };
}

export async function getGmailProfile(userId: string) {
  return gmailFetch(userId, "/profile") as Promise<{ emailAddress: string; messagesTotal?: number; threadsTotal?: number; historyId?: string }>;
}

export async function getGmailThread(userId: string, threadId: string) {
  const accessToken = await getGoogleAccessToken(userId);
  const response = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/threads/${encodeURIComponent(threadId)}?format=metadata&metadataHeaders=From&metadataHeaders=To&metadataHeaders=Subject`, {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gmail-Thread konnte nicht geprüft werden (${response.status}): ${detail.slice(0, 180)}`);
  }
  return response.json() as Promise<{
    id: string;
    messages?: Array<{
      id: string;
      threadId: string;
      labelIds?: string[];
      internalDate?: string;
      payload?: { headers?: Array<{ name: string; value: string }> };
    }>;
  }>;
}

export async function getGmailThreadDetail(userId: string, threadId: string) {
  const thread = await gmailFetch(userId, `/threads/${encodeURIComponent(threadId)}?format=full`) as { id: string; historyId?: string; messages?: GmailMessage[] };
  const messages = (thread.messages || []).map(threadMessage);
  const last = messages.at(-1);
  return {
    id: thread.id,
    historyId: thread.historyId || "",
    subject: messages.find((entry) => entry.subject)?.subject || "(ohne Betreff)",
    unread: messages.some((entry) => entry.labels.includes("UNREAD")),
    starred: messages.some((entry) => entry.labels.includes("STARRED")),
    messages,
    replyContext: last ? { messageId: last.messageId, references: [last.references, last.messageId].filter(Boolean).join(" ").trim(), subject: last.subject } : null,
  };
}

export type GmailView = "inbox" | "unread" | "starred" | "sent" | "drafts" | "all" | "trash";

function viewQuery(view: GmailView) {
  if (view === "unread") return "in:inbox is:unread";
  if (view === "starred") return "is:starred -in:trash";
  if (view === "sent") return "in:sent";
  if (view === "drafts") return "in:drafts";
  if (view === "all") return "-in:spam -in:trash";
  if (view === "trash") return "in:trash";
  return "in:inbox -in:spam -in:trash";
}

export async function listGmailWorkspaceThreads(userId: string, options: { view?: GmailView; q?: string; pageToken?: string; maxResults?: number } = {}) {
  const view = options.view || "inbox";
  const maxResults = Math.min(50, Math.max(5, options.maxResults || 30));
  const query = [viewQuery(view), options.q?.trim()].filter(Boolean).join(" ");
  const params = new URLSearchParams({ q: query, maxResults: String(maxResults) });
  if (options.pageToken) params.set("pageToken", options.pageToken);
  const list = await gmailFetch(userId, `/threads?${params}`) as { threads?: Array<{ id: string; historyId?: string; snippet?: string }>; nextPageToken?: string; resultSizeEstimate?: number };
  const rows = await Promise.all((list.threads || []).map(async (row) => {
    const params = new URLSearchParams({ format: "metadata" });
    ["From", "To", "Subject", "Date"].forEach((name) => params.append("metadataHeaders", name));
    const thread = await gmailFetch(userId, `/threads/${encodeURIComponent(row.id)}?${params}`) as { id: string; historyId?: string; snippet?: string; messages?: GmailMessage[] };
    const messages = thread.messages || [];
    const last = messages.at(-1);
    const first = messages[0];
    const labels = new Set(messages.flatMap((message) => message.labelIds || []));
    return {
      id: thread.id,
      historyId: thread.historyId || "",
      from: header(last?.payload || first?.payload, view === "sent" ? "To" : "From"),
      to: header(last?.payload || first?.payload, "To"),
      subject: header(first?.payload || last?.payload, "Subject") || "(ohne Betreff)",
      date: header(last?.payload || first?.payload, "Date"),
      internalDate: last?.internalDate || first?.internalDate || "",
      snippet: (thread.snippet || last?.snippet || row.snippet || "").slice(0, 320),
      unread: labels.has("UNREAD"),
      starred: labels.has("STARRED"),
      draft: labels.has("DRAFT"),
      sent: labels.has("SENT"),
      messageCount: messages.length,
      labels: [...labels],
    };
  }));
  return {
    threads: rows,
    nextPageToken: list.nextPageToken || "",
    resultSizeEstimate: list.resultSizeEstimate || 0,
  };
}

export type GmailThreadAction = "archive" | "read" | "unread" | "star" | "unstar" | "trash" | "untrash" | "spam" | "inbox";

export async function modifyGmailThread(userId: string, threadId: string, action: GmailThreadAction) {
  if (action === "trash" || action === "untrash") {
    return gmailFetch(userId, `/threads/${encodeURIComponent(threadId)}/${action}`, { method: "POST", body: "{}" });
  }
  const labelPatch: Record<Exclude<GmailThreadAction, "trash" | "untrash">, { addLabelIds?: string[]; removeLabelIds?: string[] }> = {
    archive: { removeLabelIds: ["INBOX"] },
    read: { removeLabelIds: ["UNREAD"] },
    unread: { addLabelIds: ["UNREAD"] },
    star: { addLabelIds: ["STARRED"] },
    unstar: { removeLabelIds: ["STARRED"] },
    spam: { addLabelIds: ["SPAM"], removeLabelIds: ["INBOX"] },
    inbox: { addLabelIds: ["INBOX"], removeLabelIds: ["SPAM"] },
  };
  return gmailFetch(userId, `/threads/${encodeURIComponent(threadId)}/modify`, {
    method: "POST",
    body: JSON.stringify(labelPatch[action]),
  });
}

export async function sendGmailReply(args: { userId: string; threadId: string; to: string; body: string; subject?: string }) {
  const thread = await getGmailThreadDetail(args.userId, args.threadId);
  const context = thread.replyContext;
  const original = args.subject || context?.subject || thread.subject || "";
  const subject = /^re:/i.test(original) ? original : `Re: ${original}`;
  return sendGmailMessage({
    userId: args.userId,
    to: args.to,
    subject,
    body: args.body,
    threadId: args.threadId,
    inReplyTo: context?.messageId || undefined,
    references: context?.references || undefined,
  });
}

export async function listRecentGmailInboxThreads(userId: string) {
  const accessToken = await getGoogleAccessToken(userId);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages?q=in%3Ainbox%20newer_than%3A2d&maxResults=100", {
    headers: { authorization: `Bearer ${accessToken}` },
    cache: "no-store",
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Gmail-Antworten konnten nicht geprüft werden (${response.status}): ${detail.slice(0, 180)}`);
  }
  const payload = await response.json() as { messages?: Array<{ id: string; threadId: string }> };
  return payload.messages || [];
}
