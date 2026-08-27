import { eq } from "drizzle-orm";
import { z } from "zod";
import { assertDatabaseConfigured, getDb } from "@/db";
import { bookings, events, leads } from "@/db/schema";
import { sendTelegramMessage } from "@/lib/telegram";

const bookingInput = z.object({
  slug: z.string().trim().min(2).max(250),
  scheduledAt: z.string().datetime(),
  provider: z.string().trim().max(50).optional().default("request"),
});

export async function POST(request: Request) {
  try {
    assertDatabaseConfigured();
    const input = bookingInput.parse(await request.json());
    const db = getDb();
    const [lead] = await db.select().from(leads).where(eq(leads.slug, input.slug)).limit(1);
    if (!lead) return Response.json({ error: "Landingpage nicht gefunden." }, { status: 404 });
    const [booking] = await db.insert(bookings).values({ leadId: lead.id, scheduledAt: new Date(input.scheduledAt), provider: input.provider, status: "requested" }).returning();
    await Promise.all([
      db.update(leads).set({ pipelineStage: "call_booked", probability: Math.max(lead.probability, 60), lastActivityAt: new Date(), updatedAt: new Date() }).where(eq(leads.id, lead.id)),
      db.insert(events).values({ leadId: lead.id, type: "booking", metadata: { bookingId: booking.id } }),
    ]);
    const baseUrl = (process.env.NEXT_PUBLIC_APP_URL || process.env.NEXTAUTH_URL || process.env.AUTH_URL || new URL(request.url).origin).replace(/\/$/, "");
    await sendTelegramMessage(`🎯 Neuer Termin gebucht\n\nUnternehmen: ${lead.company}\nKontakt: ${lead.contact || "noch offen"}\nE-Mail: ${lead.email || "fehlt"}\nTermin: ${new Date(input.scheduledAt).toLocaleString("de-DE")}\n\n${baseUrl}/v/${lead.slug}`, {
      buttons: [[{ text: "CRM öffnen ↗", url: `${baseUrl}/dashboard#leads` }, { text: "Landingpage ↗", url: `${baseUrl}/v/${lead.slug}` }]],
    });
    return Response.json({ booking }, { status: 201 });
  } catch (error) {
    if (error instanceof z.ZodError) return Response.json({ error: "Bitte einen gültigen Termin auswählen." }, { status: 400 });
    return Response.json({ error: error instanceof Error ? error.message : "Termin konnte nicht gespeichert werden." }, { status: 500 });
  }
}
