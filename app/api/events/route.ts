import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { assertDatabaseConfigured, getDb } from "@/db";
import { events, leads, settings } from "@/db/schema";
import { sendTelegramMessage } from "@/lib/telegram";

const eventInput = z.object({
  slug: z.string().trim().min(2).max(250),
  type: z.enum(["view", "play", "progress", "calendar_click", "booking"]),
  value: z.number().min(0).max(100).optional(),
  visitorId: z.string().max(120).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

async function notifyOnce(workspaceId: string, key: string, message: string, landingUrl: string) {
  const db = getDb();
  const [existing] = await db.select().from(settings).where(and(eq(settings.workspaceId, workspaceId), eq(settings.key, key))).limit(1);
  if (existing) return;
  await db.insert(settings).values({ workspaceId, key, value: new Date().toISOString() }).onConflictDoNothing();
  await sendTelegramMessage(message, { buttons: [[{ text: "Lead-Seite öffnen ↗", url: landingUrl }, { text: "Hot Leads", callback_data: "lead:next" }]] });
}

export async function POST(request: Request) {
  try {
    assertDatabaseConfigured();
    const input = eventInput.parse(await request.json());
    const db = getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.slug, input.slug)).limit(1);
    if (!lead) return Response.json({ error: "Landingpage nicht gefunden." }, { status: 404 });
    await db.insert(events).values({ leadId: lead.id, type: input.type, value: input.value, visitorId: input.visitorId, metadata: input.metadata ?? {} });
    const updates: Partial<typeof leads.$inferInsert> = { lastActivityAt: new Date(), updatedAt: new Date() };
    if (input.type === "view" || input.type === "play") {
      if (lead.pipelineStage === "new" || lead.pipelineStage === "qualified" || lead.pipelineStage === "contacted") updates.pipelineStage = "replied";
    }
    if (input.type === "progress" && input.value !== undefined) updates.watchPercent = Math.max(lead.watchPercent, Math.round(input.value));
    await db.update(leads).set(updates).where(eq(leads.id, lead.id));

    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL || new URL(request.url).origin).replace(/\/$/, "");
    const landingUrl = `${baseUrl}/v/${lead.slug}`;
    if (input.type === "play") {
      await notifyOnce(lead.workspaceId, `telegram_play:${lead.id}`, `▶️ Video gestartet\n\n${lead.company} hat das persönliche Video abgespielt.\n${landingUrl}`, landingUrl);
    }
    if (input.type === "progress" && input.value !== undefined && input.value >= 60 && lead.watchPercent < 60) {
      await notifyOnce(lead.workspaceId, `telegram_hot:${lead.id}:60`, `🔥 Hot Lead: ${Math.round(input.value)} % Watchtime\n\nUnternehmen: ${lead.company}\nKontakt: ${lead.contact || "noch offen"}\nE-Mail: ${lead.email || "fehlt"}\n\n${landingUrl}`, landingUrl);
    }
    if (input.type === "progress" && input.value !== undefined && input.value >= 90 && lead.watchPercent < 90) {
      await notifyOnce(lead.workspaceId, `telegram_hot:${lead.id}:90`, `🚨 Sehr heißer Lead: ${Math.round(input.value)} % Watchtime\n\n${lead.company} hat fast das vollständige Video angesehen. Jetzt persönlich nachfassen.\n${landingUrl}`, landingUrl);
    }
    if (input.type === "calendar_click") {
      await notifyOnce(lead.workspaceId, `telegram_calendar:${lead.id}`, `📅 Kalender geöffnet\n\n${lead.company} zeigt konkrete Terminabsicht.\n${landingUrl}`, landingUrl);
    }
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Ungültiges Tracking-Ereignis." }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Tracking fehlgeschlagen." }, { status: 500 });
  }
}
