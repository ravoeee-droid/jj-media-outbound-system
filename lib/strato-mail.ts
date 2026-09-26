import { randomUUID } from "node:crypto";
import tls, { type TLSSocket } from "node:tls";
import { getStoredStratoAccounts, getStoredStratoCredentials } from "@/lib/strato-credentials";

export type MailView = "inbox" | "unread" | "starred" | "sent" | "drafts" | "all" | "trash";
export type MailThreadAction = "archive" | "read" | "unread" | "star" | "unstar" | "trash" | "untrash" | "spam" | "inbox";

export type MailMessageView = {
  id: string;
  threadId: string;
  labels: string[];
  from: string;
  to: string;
  cc: string;
  subject: string;
  date: string;
  messageId: string;
  references: string;
  body: string;
  snippet: string;
  internalDate: string;
};

export type MailThreadView = {
  id: string;
  from: string;
  to: string;
  subject: string;
  date: string;
  internalDate: string;
  snippet: string;
  unread: boolean;
  starred: boolean;
  draft: boolean;
  sent: boolean;
  messageCount: number;
  labels: string[];
};

type StratoConfig = {
  email: string;
  password: string;
  senderName: string;
  imapHost: string;
  imapPort: number;
  smtpHost: string;
  smtpPort: number;
};

type FolderInfo = { name: string; flags: string[] };
type FolderMap = { inbox: string; sent: string; drafts: string; trash: string; junk: string; archive: string; all: string };
type ParsedHeaders = Record<string, string>;

type ImapResult = { status: "OK" | "NO" | "BAD"; response: Buffer; line: string };

function envText(name: string) {
  return (process.env[name] || "").trim();
}

export function stratoMailStatus() {
  const email = envText("STRATO_MAIL_EMAIL");
  const password = envText("STRATO_MAIL_PASSWORD");
  return {
    configured: Boolean(email && password),
    email,
    source: email && password ? "env" as const : "none" as const,
    imapHost: envText("STRATO_IMAP_HOST") || "imap.strato.de",
    imapPort: Number(envText("STRATO_IMAP_PORT") || 993),
    smtpHost: envText("STRATO_SMTP_HOST") || "smtp.strato.de",
    smtpPort: Number(envText("STRATO_SMTP_PORT") || 465),
  };
}

export async function getStratoMailStatus(workspaceId: string, accountEmail?: string) {
  const env = stratoMailStatus();
  if (env.configured) return env;
  const stored = await getStoredStratoCredentials(workspaceId, accountEmail);
  return {
    configured: Boolean(stored?.email && stored?.password),
    email: stored?.email || "",
    source: stored ? "stored" as const : "none" as const,
    imapHost: env.imapHost,
    imapPort: env.imapPort,
    smtpHost: env.smtpHost,
    smtpPort: env.smtpPort,
    accounts: await getStoredStratoAccounts(workspaceId),
  };
}

async function config(workspaceId?: string, accountEmail?: string): Promise<StratoConfig> {
  const env = stratoMailStatus();
  if (env.configured) {
    return {
      email: env.email,
      password: process.env.STRATO_MAIL_PASSWORD || "",
      senderName: envText("STRATO_MAIL_NAME") || envText("EMAIL_SENDER_NAME") || "JJ-Media",
      imapHost: env.imapHost,
      imapPort: env.imapPort,
      smtpHost: env.smtpHost,
      smtpPort: env.smtpPort,
    };
  }

  if (workspaceId) {
    const stored = await getStoredStratoCredentials(workspaceId, accountEmail);
    if (stored) {
      return {
        email: stored.email,
        password: stored.password,
        senderName: stored.senderName,
        imapHost: env.imapHost,
        imapPort: env.imapPort,
        smtpHost: env.smtpHost,
        smtpPort: env.smtpPort,
      };
    }
  }

  throw new Error("STRATO Mail ist noch nicht eingerichtet.");
}

function timeoutError(label: string) {
  return new Error(`${label} hat zu lange gebraucht.`);
}

function tlsSocket(host: string, port: number, label: string) {
  return new Promise<TLSSocket>((resolve, reject) => {
    const socket = tls.connect({ host, port, servername: host, rejectUnauthorized: true });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(timeoutError(label));
    }, 15_000);
    socket.once("secureConnect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

class BufferedTls {
  protected buffer = Buffer.alloc(0);
  private waiters = new Set<() => void>();
  protected closed = false;

  constructor(protected socket: TLSSocket) {
    socket.on("data", (chunk: Buffer) => {
      this.buffer = Buffer.concat([this.buffer, chunk]);
      for (const wake of [...this.waiters]) wake();
    });
    socket.on("close", () => {
      this.closed = true;
      for (const wake of [...this.waiters]) wake();
    });
    socket.on("error", () => {
      this.closed = true;
      for (const wake of [...this.waiters]) wake();
    });
  }

  protected async waitForData(ms = 15_000, previousLength = 0) {
    if (this.closed && !this.buffer.length) throw new Error("Die Verbindung zum Mailserver wurde unerwartet beendet.");
    if (this.buffer.length > previousLength) return;
    await new Promise<void>((resolve, reject) => {
      const done = () => {
        if (this.buffer.length <= previousLength && !this.closed) return;
        clearTimeout(timer);
        this.waiters.delete(done);
        resolve();
      };
      const timer = setTimeout(() => {
        this.waiters.delete(done);
        reject(timeoutError("Mailserver"));
      }, ms);
      this.waiters.add(done);
    });
    if (this.closed && !this.buffer.length) throw new Error("Die Verbindung zum Mailserver wurde unerwartet beendet.");
  }

  protected async readLine() {
    for (;;) {
      const index = this.buffer.indexOf("\r\n");
      if (index >= 0) {
        const line = this.buffer.subarray(0, index).toString("utf8");
        this.buffer = this.buffer.subarray(index + 2);
        return line;
      }
      await this.waitForData(15_000, this.buffer.length);
    }
  }
}

class ImapClient extends BufferedTls {
  private sequence = 0;

  static async open(c: StratoConfig) {
    const socket = await tlsSocket(c.imapHost, c.imapPort, "STRATO IMAP");
    const client = new ImapClient(socket);
    const greeting = await client.readLine();
    if (!/^\* (?:OK|PREAUTH)/i.test(greeting)) {
      socket.destroy();
      throw new Error(`STRATO IMAP hat die Verbindung abgelehnt: ${greeting.slice(0, 180)}`);
    }
    await client.execute(`LOGIN ${imapQuote(c.email)} ${imapQuote(c.password)}`);
    return client;
  }

  private nextTag() {
    this.sequence += 1;
    return `A${String(this.sequence).padStart(4, "0")}`;
  }

  private async waitTagged(tag: string): Promise<ImapResult> {
    for (;;) {
      const text = this.buffer.toString("latin1");
      let start = text.indexOf(`\r\n${tag} `);
      if (start >= 0) start += 2;
      else if (text.startsWith(`${tag} `)) start = 0;
      if (start >= 0) {
        const end = text.indexOf("\r\n", start);
        if (end >= 0) {
          const line = text.slice(start, end);
          const match = line.match(new RegExp(`^${tag} (OK|NO|BAD)\\b`, "i"));
          if (!match) throw new Error(`Unverständliche IMAP-Antwort: ${line.slice(0, 180)}`);
          const response = this.buffer.subarray(0, end + 2);
          this.buffer = this.buffer.subarray(end + 2);
          return { status: match[1].toUpperCase() as ImapResult["status"], response, line };
        }
      }
      await this.waitForData(20_000, this.buffer.length);
    }
  }

  async executeResult(command: string) {
    const tag = this.nextTag();
    this.socket.write(`${tag} ${command}\r\n`);
    return this.waitTagged(tag);
  }

  async execute(command: string) {
    const result = await this.executeResult(command);
    if (result.status !== "OK") throw new Error(`STRATO IMAP: ${result.line.replace(/^A\d+\s+/i, "").slice(0, 240)}`);
    return result.response;
  }

  async append(folder: string, raw: Buffer, flags = "\\Seen") {
    const tag = this.nextTag();
    this.socket.write(`${tag} APPEND ${imapQuote(folder)} (${flags}) {${raw.length}}\r\n`);
    const continuation = await this.readLine();
    if (!continuation.startsWith("+")) {
      if (continuation.startsWith(tag)) throw new Error(`STRATO IMAP APPEND: ${continuation}`);
      throw new Error(`STRATO IMAP erwartet keine Nachrichtendaten: ${continuation.slice(0, 180)}`);
    }
    this.socket.write(raw);
    this.socket.write("\r\n");
    const result = await this.waitTagged(tag);
    if (result.status !== "OK") throw new Error(`STRATO IMAP APPEND: ${result.line.slice(0, 220)}`);
    return result.line;
  }

  async logout() {
    try { await this.executeResult("LOGOUT"); } catch { /* connection may already be gone */ }
    this.socket.end();
  }
}

function imapQuote(value: string) {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function extractLiterals(response: Buffer) {
  const text = response.toString("latin1");
  const literals: Buffer[] = [];
  const pattern = /\{(\d+)\}\r\n/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text))) {
    const length = Number(match[1]);
    const start = match.index + match[0].length;
    if (Number.isFinite(length) && start + length <= response.length) {
      literals.push(response.subarray(start, start + length));
      pattern.lastIndex = start + length;
    }
  }
  return literals;
}

function responseText(response: Buffer) {
  return response.toString("latin1");
}

function parseFlags(response: Buffer) {
  const match = responseText(response).match(/FLAGS \(([^)]*)\)/i);
  return match ? match[1].split(/\s+/).filter(Boolean) : [];
}

function parseInternalDate(response: Buffer) {
  const match = responseText(response).match(/INTERNALDATE "([^"]+)"/i);
  if (!match) return "";
  const stamp = Date.parse(match[1]);
  return Number.isFinite(stamp) ? String(stamp) : "";
}

function parseUidSearch(response: Buffer) {
  const values: number[] = [];
  for (const match of responseText(response).matchAll(/^\* SEARCH(?: (.*))?$/gim)) {
    for (const token of (match[1] || "").trim().split(/\s+/)) {
      const value = Number(token);
      if (Number.isInteger(value) && value > 0) values.push(value);
    }
  }
  return values;
}

function decodeMimeWord(value: string) {
  return value.replace(/=\?([^?]+)\?([bq])\?([^?]*)\?=/gi, (_all, _charset: string, kind: string, content: string) => {
    try {
      if (kind.toLowerCase() === "b") return Buffer.from(content, "base64").toString("utf8");
      const q = content.replace(/_/g, " ").replace(/=([0-9A-F]{2})/gi, (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16)));
      return Buffer.from(q, "latin1").toString("utf8");
    } catch { return content; }
  });
}

function parseHeaders(buffer: Buffer | string): ParsedHeaders {
  const text = Buffer.isBuffer(buffer) ? buffer.toString("utf8") : buffer;
  const unfolded = text.replace(/\r?\n[ \t]+/g, " ");
  const headers: ParsedHeaders = {};
  for (const line of unfolded.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index <= 0) continue;
    const key = line.slice(0, index).trim().toLowerCase();
    const value = decodeMimeWord(line.slice(index + 1).trim());
    if (!headers[key]) headers[key] = value;
  }
  return headers;
}

function splitHeaderBody(raw: string) {
  const match = raw.match(/\r?\n\r?\n/);
  if (!match || match.index == null) return { headerText: raw, body: "" };
  return { headerText: raw.slice(0, match.index), body: raw.slice(match.index + match[0].length) };
}

function decodeQuotedPrintable(input: string) {
  const soft = input.replace(/=\r?\n/g, "");
  const bytes: number[] = [];
  for (let i = 0; i < soft.length; i += 1) {
    if (soft[i] === "=" && /^[0-9A-Fa-f]{2}$/.test(soft.slice(i + 1, i + 3))) {
      bytes.push(parseInt(soft.slice(i + 1, i + 3), 16));
      i += 2;
    } else bytes.push(soft.charCodeAt(i) & 0xff);
  }
  return Buffer.from(bytes).toString("utf8");
}

function decodeBody(body: string, transfer: string) {
  const kind = transfer.toLowerCase();
  if (kind.includes("base64")) {
    try { return Buffer.from(body.replace(/\s+/g, ""), "base64").toString("utf8"); } catch { return body; }
  }
  if (kind.includes("quoted-printable")) return decodeQuotedPrintable(body);
  return body;
}

function htmlToText(value: string) {
  return value
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<br\s*\/?\s*>/gi, "\n")
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

function bodyTextFromMime(raw: string): string {
  const { headerText, body } = splitHeaderBody(raw);
  const headers = parseHeaders(headerText);
  const contentType = headers["content-type"] || "text/plain";
  const transfer = headers["content-transfer-encoding"] || "";
  const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;\s]+))/i)?.slice(1).find(Boolean);
  if (/multipart\//i.test(contentType) && boundary) {
    const parts = body.split(`--${boundary}`).slice(1, -1);
    const plain: string[] = [];
    const html: string[] = [];
    for (const part of parts) {
      const trimmed = part.replace(/^\r?\n/, "");
      const partHeaders = parseHeaders(splitHeaderBody(trimmed).headerText);
      const type = partHeaders["content-type"] || "text/plain";
      const text = bodyTextFromMime(trimmed);
      if (/text\/plain/i.test(type) && text) plain.push(text);
      else if (/text\/html/i.test(type) && text) html.push(text);
      else if (/multipart\//i.test(type) && text) plain.push(text);
    }
    return (plain.join("\n\n").trim() || htmlToText(html.join("\n\n"))).trim();
  }
  const decoded = decodeBody(body, transfer).trim();
  return /text\/html/i.test(contentType) ? htmlToText(decoded) : decoded;
}

function parseRawMail(raw: Buffer, id: string, internalDate = "", flags: string[] = []): MailMessageView {
  const text = raw.toString("utf8");
  const { headerText } = splitHeaderBody(text);
  const headers = parseHeaders(headerText);
  const body = bodyTextFromMime(text).slice(0, 100_000);
  const labels = flags.map((flag) => flag.replace(/^\\/, ""));
  return {
    id,
    threadId: id,
    labels,
    from: headers.from || "",
    to: headers.to || "",
    cc: headers.cc || "",
    subject: headers.subject || "(ohne Betreff)",
    date: headers.date || "",
    messageId: headers["message-id"] || "",
    references: headers.references || headers["in-reply-to"] || "",
    body,
    snippet: body.replace(/\s+/g, " ").trim().slice(0, 260),
    internalDate,
  };
}

function parseListFolders(response: Buffer): FolderInfo[] {
  const folders: FolderInfo[] = [];
  for (const line of responseText(response).split("\r\n")) {
    const match = line.match(/^\* LIST \(([^)]*)\) (?:(?:"[^"]*")|NIL) (?:(?:"((?:[^"\\]|\\.)*)")|(.+))$/i);
    if (!match) continue;
    const rawName = (match[2] || match[3] || "").replace(/\\"/g, '"').replace(/\\\\/g, "\\");
    folders.push({ name: rawName, flags: match[1].split(/\s+/).filter(Boolean) });
  }
  return folders;
}

function folderByFlag(folders: FolderInfo[], flag: string) {
  return folders.find((folder) => folder.flags.some((value) => value.toLowerCase() === flag.toLowerCase()))?.name || "";
}

function folderByName(folders: FolderInfo[], names: string[]) {
  const normalized = names.map((name) => name.toLowerCase());
  return folders.find((folder) => normalized.some((name) => folder.name.toLowerCase().includes(name)))?.name || "";
}

function foldersFromList(folders: FolderInfo[]): FolderMap {
  return {
    inbox: "INBOX",
    sent: folderByFlag(folders, "\\Sent") || folderByName(folders, ["sent", "gesendet"]),
    drafts: folderByFlag(folders, "\\Drafts") || folderByName(folders, ["draft", "entwurf"]),
    trash: folderByFlag(folders, "\\Trash") || folderByName(folders, ["trash", "papierkorb", "gelöscht", "deleted"]),
    junk: folderByFlag(folders, "\\Junk") || folderByName(folders, ["junk", "spam"]),
    archive: folderByFlag(folders, "\\Archive") || folderByName(folders, ["archive", "archiv"]),
    all: folderByFlag(folders, "\\All") || folderByName(folders, ["all mail", "alle nachrichten", "all"]),
  };
}

async function getFolders(client: ImapClient) {
  return foldersFromList(parseListFolders(await client.execute('LIST "" "*"')));
}

function folderForView(view: MailView, folders: FolderMap) {
  if (view === "sent") return folders.sent || folders.inbox;
  if (view === "drafts") return folders.drafts || folders.inbox;
  if (view === "trash") return folders.trash || folders.inbox;
  if (view === "all") return folders.all || folders.inbox;
  return folders.inbox;
}

function encodeMailId(folder: string, uid: number) {
  return Buffer.from(JSON.stringify({ f: folder, u: uid }), "utf8").toString("base64url");
}

function decodeMailId(id: string) {
  try {
    const value = JSON.parse(Buffer.from(id, "base64url").toString("utf8")) as { f?: unknown; u?: unknown };
    if (typeof value.f !== "string" || !Number.isInteger(value.u) || Number(value.u) <= 0) throw new Error();
    return { folder: value.f, uid: Number(value.u) };
  } catch {
    throw new Error("Ungültige STRATO-Mail-ID.");
  }
}

function imapSearchText(value: string) {
  return imapQuote(value.replace(/[\r\n]/g, " ").slice(0, 300));
}

function searchCriteria(view: MailView, query: string) {
  const terms: string[] = [];
  if (view === "unread") terms.push("UNSEEN");
  if (view === "starred") terms.push("FLAGGED");
  const remaining = query.trim().replace(/\b(from|to|subject):(?:"([^"]+)"|(\S+))/gi, (_all, field: string, quoted: string, bare: string) => {
    const value = quoted || bare || "";
    const map: Record<string, string> = { from: "FROM", to: "TO", subject: "SUBJECT" };
    terms.push(`${map[field.toLowerCase()]} ${imapSearchText(value)}`);
    return " ";
  }).trim();
  if (remaining) terms.push(`TEXT ${imapSearchText(remaining)}`);
  return terms.length ? terms.join(" ") : "ALL";
}

async function fetchHeader(client: ImapClient, folder: string, uid: number, view: MailView): Promise<MailThreadView> {
  const response = await client.execute(`UID FETCH ${uid} (FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)])`);
  const literal = extractLiterals(response)[0] || Buffer.alloc(0);
  const headers = parseHeaders(literal);
  const flags = parseFlags(response);
  const id = encodeMailId(folder, uid);
  const labels = flags.map((flag) => flag.replace(/^\\/, ""));
  const from = view === "sent" ? (headers.to || headers.from || "") : (headers.from || "");
  return {
    id,
    from,
    to: headers.to || "",
    subject: headers.subject || "(ohne Betreff)",
    date: headers.date || "",
    internalDate: parseInternalDate(response),
    snippet: "",
    unread: !flags.some((flag) => flag.toLowerCase() === "\\seen"),
    starred: flags.some((flag) => flag.toLowerCase() === "\\flagged"),
    draft: flags.some((flag) => flag.toLowerCase() === "\\draft") || view === "drafts",
    sent: view === "sent",
    messageCount: 1,
    labels,
  };
}

function splitFetchResponses(response: Buffer) {
  const text = response.toString("latin1");
  const starts = [...text.matchAll(/(?:^|\r\n)(\* \d+ FETCH \()/g)].map((match) => {
    const index = match.index || 0;
    return text.startsWith("\r\n", index) ? index + 2 : index;
  });
  return starts.map((start, index) => {
    const end = index + 1 < starts.length ? starts[index + 1] : response.length;
    return response.subarray(start, end);
  });
}

function parseBatchHeaderThreads(response: Buffer, folder: string, view: MailView) {
  const rows: Array<{ uid: number; thread: MailThreadView }> = [];
  for (const chunk of splitFetchResponses(response)) {
    const uidMatch = responseText(chunk).match(/\bUID (\d+)\b/i);
    const uid = Number(uidMatch?.[1] || 0);
    if (!uid) continue;
    const literal = extractLiterals(chunk)[0] || Buffer.alloc(0);
    const headers = parseHeaders(literal);
    const flags = parseFlags(chunk);
    const id = encodeMailId(folder, uid);
    const labels = flags.map((flag) => flag.replace(/^\\/, ""));
    const from = view === "sent" ? (headers.to || headers.from || "") : (headers.from || "");
    rows.push({
      uid,
      thread: {
        id,
        from,
        to: headers.to || "",
        subject: headers.subject || "(ohne Betreff)",
        date: headers.date || "",
        internalDate: parseInternalDate(chunk),
        snippet: "",
        unread: !flags.some((flag) => flag.toLowerCase() === "\\seen"),
        starred: flags.some((flag) => flag.toLowerCase() === "\\flagged"),
        draft: flags.some((flag) => flag.toLowerCase() === "\\draft") || view === "drafts",
        sent: view === "sent",
        messageCount: 1,
        labels,
      },
    });
  }
  return rows;
}

export async function listStratoMailThreads(options: { view?: MailView; q?: string; maxResults?: number } = {}, workspaceId?: string, accountEmail?: string) {
  const c = await config(workspaceId, accountEmail);
  const client = await ImapClient.open(c);
  try {
    const view = options.view || "inbox";
    // STRATO can be very slow when enumerating all folders. Inbox-style views do not
    // need LIST at all, so go straight to INBOX and keep the first paint fast.
    const folders = (view === "inbox" || view === "unread" || view === "starred")
      ? { inbox: "INBOX", sent: "", drafts: "", trash: "", junk: "", archive: "", all: "" }
      : await getFolders(client);
    const folder = folderForView(view, folders);
    await client.execute(`SELECT ${imapQuote(folder)}`);
    const uids = parseUidSearch(await client.execute(`UID SEARCH ${searchCriteria(view, options.q || "")}`));
    const selected = uids.slice(-Math.min(50, Math.max(5, options.maxResults || 30))).reverse();
    let threads: MailThreadView[] = [];
    if (selected.length) {
      const response = await client.execute(`UID FETCH ${selected.join(",")} (UID FLAGS INTERNALDATE BODY.PEEK[HEADER.FIELDS (FROM TO CC SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)])`);
      const fetched = parseBatchHeaderThreads(response, folder, view);
      const byUid = new Map(fetched.map((row) => [row.uid, row.thread]));
      threads = selected.map((uid) => byUid.get(uid)).filter((thread): thread is MailThreadView => Boolean(thread));
    }
    return {
      connected: true,
      canManageMail: true,
      provider: "strato" as const,
      profile: { emailAddress: c.email },
      threads,
      resultSizeEstimate: uids.length,
      nextPageToken: "",
    };
  } finally { await client.logout(); }
}

export async function getStratoMailThread(id: string, workspaceId?: string, accountEmail?: string) {
  const c = await config(workspaceId, accountEmail);
  const { folder, uid } = decodeMailId(id);
  const client = await ImapClient.open(c);
  try {
    await client.execute(`SELECT ${imapQuote(folder)}`);
    const response = await client.execute(`UID FETCH ${uid} (FLAGS INTERNALDATE BODY.PEEK[])`);
    const raw = extractLiterals(response)[0];
    if (!raw) throw new Error("Die E-Mail konnte bei STRATO nicht geladen werden.");
    const message = parseRawMail(raw, id, parseInternalDate(response), parseFlags(response));
    return {
      connected: true,
      canManageMail: true,
      provider: "strato" as const,
      profile: { emailAddress: c.email },
      thread: {
        id,
        subject: message.subject,
        unread: !message.labels.some((label) => label.toLowerCase() === "seen"),
        starred: message.labels.some((label) => label.toLowerCase() === "flagged"),
        messages: [message],
      },
    };
  } finally { await client.logout(); }
}

async function moveMessage(client: ImapClient, uid: number, target: string) {
  if (!target) throw new Error("Der benötigte STRATO-Ordner wurde nicht gefunden.");
  const result = await client.executeResult(`UID MOVE ${uid} ${imapQuote(target)}`);
  if (result.status === "OK") return;
  await client.execute(`UID COPY ${uid} ${imapQuote(target)}`);
  await client.execute(`UID STORE ${uid} +FLAGS.SILENT (\\Deleted)`);
  await client.execute("EXPUNGE");
}

export async function modifyStratoMailMessages(ids: string[], action: MailThreadAction, workspaceId?: string, accountEmail?: string) {
  if (!ids.length) return { changed: 0 };
  const c = await config(workspaceId, accountEmail);
  const client = await ImapClient.open(c);
  try {
    const folders = await getFolders(client);
    let changed = 0;
    for (const id of ids) {
      const { folder, uid } = decodeMailId(id);
      await client.execute(`SELECT ${imapQuote(folder)}`);
      if (action === "read") await client.execute(`UID STORE ${uid} +FLAGS.SILENT (\\Seen)`);
      else if (action === "unread") await client.execute(`UID STORE ${uid} -FLAGS.SILENT (\\Seen)`);
      else if (action === "star") await client.execute(`UID STORE ${uid} +FLAGS.SILENT (\\Flagged)`);
      else if (action === "unstar") await client.execute(`UID STORE ${uid} -FLAGS.SILENT (\\Flagged)`);
      else if (action === "trash") await moveMessage(client, uid, folders.trash);
      else if (action === "untrash" || action === "inbox") await moveMessage(client, uid, folders.inbox);
      else if (action === "spam") await moveMessage(client, uid, folders.junk);
      else if (action === "archive") await moveMessage(client, uid, folders.archive || folders.all);
      changed += 1;
    }
    return { changed };
  } finally { await client.logout(); }
}

function safeHeader(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodedHeader(value: string) {
  return `=?UTF-8?B?${Buffer.from(value, "utf8").toString("base64")}?=`;
}

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

function addresses(value = "") {
  return value.split(",").map((item) => item.trim()).filter(Boolean).map((item) => item.match(/<([^>]+)>/)?.[1] || item).filter((item) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(item));
}

function normalizeReference(value = "") {
  const clean = value.trim();
  if (!clean) return "";
  return clean.startsWith("<") ? clean : `<${clean.replace(/[<>]/g, "")}>`;
}

function buildRawMessage(args: { to: string; cc?: string; bcc?: string; subject: string; body: string; html?: string; inReplyTo?: string; references?: string }, c: StratoConfig) {
  const to = safeHeader(args.to);
  const cc = safeHeader(args.cc || "");
  const subject = safeHeader(args.subject);
  if (!addresses(to).length) throw new Error("Bitte eine gültige Empfängeradresse angeben.");
  if (!subject) throw new Error("Bitte einen Betreff eingeben.");
  const domain = c.email.split("@")[1] || "jj-media.local";
  const messageId = `<${randomUUID()}@${domain}>`;
  const boundary = `jj_${randomUUID().replace(/-/g, "")}`;
  const inReplyTo = normalizeReference(args.inReplyTo || "");
  const references = [args.references || "", inReplyTo].filter(Boolean).join(" ").trim();
  const html = args.html || `<div style="font-family:Arial,sans-serif;white-space:pre-wrap">${escapeHtml(args.body).replace(/\n/g, "<br>")}</div>`;
  const headers = [
    `From: ${encodedHeader(c.senderName)} <${c.email}>`,
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${encodedHeader(subject)}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: ${messageId}`,
    ...(inReplyTo ? [`In-Reply-To: ${inReplyTo}`] : []),
    ...(references ? [`References: ${references}`] : []),
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    args.body,
    `--${boundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${boundary}--`,
    "",
  ];
  return { raw: Buffer.from(headers.join("\r\n"), "utf8"), messageId };
}

class SmtpClient extends BufferedTls {
  static async open(c: StratoConfig) {
    const socket = await tlsSocket(c.smtpHost, c.smtpPort, "STRATO SMTP");
    const client = new SmtpClient(socket);
    const greeting = await client.readReply();
    if (greeting.code !== 220) throw new Error(`STRATO SMTP: ${greeting.text.slice(0, 180)}`);
    await client.expect("EHLO jj-media.local", 250);
    await client.expect("AUTH LOGIN", 334);
    await client.expect(Buffer.from(c.email).toString("base64"), 334);
    await client.expect(Buffer.from(c.password).toString("base64"), 235);
    return client;
  }

  private async readReply() {
    const lines: string[] = [];
    let code = 0;
    for (;;) {
      const line = await this.readLine();
      lines.push(line);
      const match = line.match(/^(\d{3})([ -])(.*)$/);
      if (!match) continue;
      code = Number(match[1]);
      if (match[2] === " ") return { code, text: lines.join("\n") };
    }
  }

  async expect(command: string, expected: number | number[]) {
    this.socket.write(`${command}\r\n`);
    const reply = await this.readReply();
    const allowed = Array.isArray(expected) ? expected : [expected];
    if (!allowed.includes(reply.code)) throw new Error(`STRATO SMTP ${reply.code}: ${reply.text.slice(0, 260)}`);
    return reply;
  }

  async send(raw: Buffer, recipients: string[], senderEmail: string) {
    await this.expect(`MAIL FROM:<${senderEmail}>`, 250);
    for (const recipient of recipients) await this.expect(`RCPT TO:<${recipient}>`, [250, 251]);
    await this.expect("DATA", 354);
    const text = raw.toString("utf8").replace(/(^|\r\n)\./g, "$1..");
    this.socket.write(text.endsWith("\r\n") ? text : `${text}\r\n`);
    this.socket.write(".\r\n");
    const reply = await this.readReply();
    if (reply.code !== 250) throw new Error(`STRATO SMTP ${reply.code}: ${reply.text.slice(0, 260)}`);
  }

  async quit() {
    try { await this.expect("QUIT", 221); } catch { /* message may already be accepted */ }
    this.socket.end();
  }
}

async function appendCopy(raw: Buffer, kind: "sent" | "draft", c: StratoConfig) {
  const client = await ImapClient.open(c);
  try {
    const folders = await getFolders(client);
    const folder = kind === "sent" ? folders.sent : folders.drafts;
    if (!folder) return;
    await client.append(folder, raw, kind === "draft" ? "\\Draft \\Seen" : "\\Seen");
  } finally { await client.logout(); }
}

export async function sendStratoMessage(args: { to: string; cc?: string; bcc?: string; subject: string; body: string; html?: string; threadId?: string | null; inReplyTo?: string; references?: string }, workspaceId?: string, accountEmail?: string) {
  const c = await config(workspaceId, accountEmail);
  const reference = args.inReplyTo || args.threadId || "";
  const { raw, messageId } = buildRawMessage({ ...args, inReplyTo: reference, references: args.references }, c);
  const recipients = [...new Set([...addresses(args.to), ...addresses(args.cc), ...addresses(args.bcc)])];
  if (!recipients.length) throw new Error("Kein gültiger E-Mail-Empfänger gefunden.");
  const smtp = await SmtpClient.open(c);
  try { await smtp.send(raw, recipients, c.email); }
  finally { await smtp.quit(); }
  // Do not block the user-facing send request on a second IMAP roundtrip.
  // SMTP acceptance means the message is sent. STRATO's IMAP folder sync can be
  // noticeably slower and previously caused the whole request to hit Vercel's 60s limit.
  void appendCopy(raw, "sent", c).catch((error) => console.warn("STRATO Sent-Kopie konnte nicht gespeichert werden", error));
  return { id: messageId, threadId: messageId };
}

export async function createStratoDraft(args: { to: string; cc?: string; bcc?: string; subject: string; body: string; threadId?: string | null; inReplyTo?: string; references?: string }, workspaceId?: string, accountEmail?: string) {
  const c = await config(workspaceId, accountEmail);
  const { raw, messageId } = buildRawMessage({ ...args, inReplyTo: args.inReplyTo || args.threadId || "", references: args.references }, c);
  await appendCopy(raw, "draft", c);
  return { id: messageId, threadId: messageId };
}

export async function sendStratoReply(args: { threadId: string; to: string; subject?: string; body: string }, workspaceId?: string, accountEmail?: string) {
  const detail = await getStratoMailThread(args.threadId, workspaceId, accountEmail);
  const message = detail.thread.messages.at(-1);
  if (!message) throw new Error("Die ursprüngliche STRATO-Mail wurde nicht gefunden.");
  const original = args.subject || message.subject || "";
  const subject = /^re:/i.test(original) ? original : `Re: ${original}`;
  return sendStratoMessage({
    to: args.to,
    subject,
    body: args.body,
    inReplyTo: message.messageId,
    references: [message.references, message.messageId].filter(Boolean).join(" "),
  }, workspaceId, accountEmail);
}

function imapDate(date: Date) {
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${String(date.getUTCDate()).padStart(2, "0")}-${months[date.getUTCMonth()]}-${date.getUTCFullYear()}`;
}

export async function listRecentStratoInboxMessages(days = 2, workspaceId?: string, accountEmail?: string) {
  const c = await config(workspaceId, accountEmail);
  const client = await ImapClient.open(c);
  try {
    await client.execute('SELECT "INBOX"');
    const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000);
    const uids = parseUidSearch(await client.execute(`UID SEARCH SINCE ${imapDate(since)}`)).slice(-150).reverse();
    const messages: Array<{ messageId: string; references: string; inReplyTo: string; from: string; subject: string; date: string }> = [];
    if (!uids.length) return messages;
    const response = await client.execute(`UID FETCH ${uids.join(",")} (UID BODY.PEEK[HEADER.FIELDS (FROM SUBJECT DATE MESSAGE-ID REFERENCES IN-REPLY-TO)])`);
    const chunks = splitFetchResponses(response);
    const byUid = new Map<number, { messageId: string; references: string; inReplyTo: string; from: string; subject: string; date: string }>();
    for (const chunk of chunks) {
      const uid = Number(responseText(chunk).match(/\bUID (\d+)\b/i)?.[1] || 0);
      if (!uid) continue;
      const headers = parseHeaders(extractLiterals(chunk)[0] || Buffer.alloc(0));
      byUid.set(uid, {
        messageId: headers["message-id"] || "",
        references: headers.references || "",
        inReplyTo: headers["in-reply-to"] || "",
        from: headers.from || "",
        subject: headers.subject || "",
        date: headers.date || "",
      });
    }
    for (const uid of uids) {
      const message = byUid.get(uid);
      if (message) messages.push(message);
    }
    return messages;
  } finally { await client.logout(); }
}

export async function testStratoCredentials(input: { email: string; password: string; senderName?: string }) {
  const base = stratoMailStatus();
  const c: StratoConfig = {
    email: input.email.trim().toLowerCase(),
    password: input.password,
    senderName: input.senderName?.trim() || "JJ-Media",
    imapHost: base.imapHost,
    imapPort: base.imapPort,
    smtpHost: base.smtpHost,
    smtpPort: base.smtpPort,
  };

  const imap = await ImapClient.open(c);
  await imap.logout();
  const smtp = await SmtpClient.open(c);
  await smtp.quit();
  return { ok: true, email: c.email, imapHost: c.imapHost, smtpHost: c.smtpHost };
}
