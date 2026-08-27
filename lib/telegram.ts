import { createHash } from "node:crypto";

export type TelegramButton = { text: string; callback_data?: string; url?: string };
export type TelegramResult = { delivered: boolean; reason?: string; messageId?: number };

function token() {
  return process.env.TELEGRAM_BOT_TOKEN;
}

export function telegramConfigured() {
  return Boolean(token() && process.env.TELEGRAM_CHAT_ID);
}

export function telegramWebhookSecret() {
  const source = process.env.TELEGRAM_WEBHOOK_SECRET || process.env.AUTOMATION_SECRET || token() || "";
  return source ? createHash("sha256").update(source).digest("hex") : "";
}

async function telegramCall(method: string, body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const botToken = token();
  if (!botToken) throw new Error("TELEGRAM_BOT_TOKEN fehlt.");
  const response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(12_000),
    cache: "no-store",
  });
  const payload = await response.json().catch(() => ({})) as { ok?: boolean; description?: string; result?: Record<string, unknown> };
  if (!response.ok || !payload.ok) throw new Error(payload.description || `Telegram HTTP ${response.status}`);
  return payload.result || {};
}

export async function sendTelegramMessage(
  message: string,
  options?: { chatId?: string; buttons?: TelegramButton[][]; disablePreview?: boolean },
): Promise<TelegramResult> {
  const chatId = options?.chatId || process.env.TELEGRAM_CHAT_ID;
  if (!token() || !chatId) return { delivered: false, reason: "Telegram ist nicht konfiguriert." };
  try {
    const result = await telegramCall("sendMessage", {
      chat_id: chatId,
      text: message,
      disable_web_page_preview: options?.disablePreview ?? false,
      ...(options?.buttons?.length ? { reply_markup: { inline_keyboard: options.buttons } } : {}),
    });
    return { delivered: true, messageId: Number(result.message_id || 0) || undefined };
  } catch (error) {
    return { delivered: false, reason: error instanceof Error ? error.message : "Telegram-Fehler" };
  }
}

export async function notifyTelegram(message: string): Promise<TelegramResult> {
  return sendTelegramMessage(message);
}

export async function answerTelegramCallback(callbackQueryId: string, text?: string) {
  try {
    await telegramCall("answerCallbackQuery", { callback_query_id: callbackQueryId, text: text || "", show_alert: false });
  } catch {
    // The command result is still sent as a normal chat message.
  }
}

export async function registerTelegramWebhook(baseUrl: string) {
  const secret = telegramWebhookSecret();
  if (!secret) throw new Error("AUTOMATION_SECRET oder TELEGRAM_WEBHOOK_SECRET fehlt.");
  const webhookUrl = `${baseUrl.replace(/\/$/, "")}/api/telegram/webhook`;
  const result = await telegramCall("setWebhook", {
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
    drop_pending_updates: true,
  });
  await telegramCall("setMyCommands", {
    commands: [
      { command: "status", description: "Kampagne und Pipeline prüfen" },
      { command: "start", description: "Kampagnenstart bestätigen" },
      { command: "stop", description: "Kampagne sofort stoppen" },
      { command: "pause", description: "Versand pausieren, z. B. /pause 60" },
      { command: "queue", description: "Nächste versandbereite Leads" },
      { command: "next", description: "Nächsten Lead mit Aktionen öffnen" },
      { command: "best", description: "Heißeste Leads anzeigen" },
      { command: "errors", description: "Letzte Fehler mit Details" },
      { command: "logs", description: "Letzte Systemprozesse" },
      { command: "heute", description: "Tagesergebnis" },
      { command: "woche", description: "Wochenergebnis" },
      { command: "performance", description: "Conversion-Kennzahlen" },
      { command: "limit", description: "Tageslimit setzen, z. B. /limit 25" },
      { command: "zeiten", description: "Versandzeit setzen, z. B. /zeiten 08:00 18:00" },
      { command: "intervall", description: "Minutenabstand setzen" },
      { command: "help", description: "Alle Befehle anzeigen" },
    ],
  });
  return { ok: true, webhookUrl, result };
}
