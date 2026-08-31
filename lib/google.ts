import { and, eq } from "drizzle-orm";
import { getDb } from "@/db";
import { accounts } from "@/db/schema";

type GoogleAccount = typeof accounts.$inferSelect;

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
  const [account] = await getDb()
    .select()
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.provider, "google")))
    .limit(1);
  if (!account) throw new Error("Google/Gmail ist noch nicht verbunden.");
  const currentEpoch = Math.floor(Date.now() / 1000);
  if (account.access_token && account.expires_at && account.expires_at > currentEpoch + 60) return account.access_token;
  return refreshGoogleAccessToken(account);
}

function base64Url(value: string) {
  return Buffer.from(value)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

export async function sendGmailMessage(args: {
  userId: string;
  to: string;
  subject: string;
  body: string;
  html?: string;
  threadId?: string | null;
}) {
  const to = safeHeader(args.to);
  const subject = safeHeader(args.subject);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new Error("Die Empfängeradresse ist ungültig.");
  if (!subject) throw new Error("Die Betreffzeile ist leer.");

  const accessToken = await getGoogleAccessToken(args.userId);
  const boundary = `dg_${Date.now().toString(36)}`;
  const mime = [
    `To: ${to}`,
    `Subject: =?UTF-8?B?${Buffer.from(subject).toString("base64")}?=`,
    "MIME-Version: 1.0",
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
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: {
      authorization: `Bearer ${accessToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      raw: base64Url(mime),
      ...(args.threadId ? { threadId: args.threadId } : {}),
    }),
  });
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Gmail-Versand fehlgeschlagen (${response.status}): ${detail.slice(0, 240)}`);
  }
  return response.json() as Promise<{ id: string; threadId: string; labelIds?: string[] }>;
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
