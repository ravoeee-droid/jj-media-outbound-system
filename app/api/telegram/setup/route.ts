import { registerTelegramWebhook, sendTelegramMessage, telegramConfigured } from "@/lib/telegram";
import { apiError, requireWorkspace } from "@/lib/workspace";

export const dynamic = "force-dynamic";

function baseUrl(request: Request) {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL || new URL(request.url).origin).replace(/\/$/, "");
}

export async function GET() {
  try {
    await requireWorkspace();
    return Response.json({ configured: telegramConfigured(), webhookPath: "/api/telegram/webhook" }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    return apiError(error);
  }
}

export async function POST(request: Request) {
  try {
    await requireWorkspace();
    if (!telegramConfigured()) return Response.json({ error: "TELEGRAM_BOT_TOKEN oder TELEGRAM_CHAT_ID fehlt." }, { status: 400 });
    const registered = await registerTelegramWebhook(baseUrl(request));
    const test = await sendTelegramMessage("✅ Telegram-Steuerzentrale ist aktiviert.\n\nSende /help für alle Befehle oder /status für den aktuellen Systemzustand.");
    return Response.json({ ok: true, registered, test });
  } catch (error) {
    return apiError(error);
  }
}
