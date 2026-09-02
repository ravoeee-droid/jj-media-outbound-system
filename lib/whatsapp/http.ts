import { cookies } from "next/headers";
import { z } from "zod";
import { COCKPIT_COOKIE, validCockpitToken } from "@/lib/cockpit-auth";
import { requireWorkspace } from "@/lib/workspace";

export async function whatsappWorkspace() {
  if (!await validCockpitToken((await cookies()).get(COCKPIT_COOKIE)?.value)) throw new Error("UNAUTHORIZED");
  return requireWorkspace();
}

export function whatsappError(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message || "Bitte die Eingaben prüfen." }, { status: 400 });
  if (error instanceof Error && error.message === "UNAUTHORIZED") return Response.json({ error: "Bitte am Outbound Tool anmelden." }, { status: 401 });
  return Response.json({ error: error instanceof Error ? error.message : "Der WhatsApp-Vorgang konnte nicht abgeschlossen werden." }, { status: 409 });
}

export async function limitedJson(request: Request, limit = 150_000) {
  if (Number(request.headers.get("content-length") || 0) > limit) throw new Error("Die Anfrage ist zu groß.");
  const body = await request.text();
  if (body.length > limit) throw new Error("Die Anfrage ist zu groß.");
  return JSON.parse(body);
}
