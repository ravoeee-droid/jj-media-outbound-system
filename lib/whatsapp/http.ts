import { cookies } from "next/headers";
import { z } from "zod";
import { COCKPIT_COOKIE, validCockpitToken } from "@/lib/cockpit-auth";
import { requirePermission } from "@/lib/workspace";

export async function whatsappWorkspace() {
  if (!await validCockpitToken((await cookies()).get(COCKPIT_COOKIE)?.value)) throw new Error("UNAUTHORIZED");
  return requirePermission("use_whatsapp");
}

export function whatsappError(error: unknown) {
  if (error instanceof z.ZodError) return Response.json({ error: error.issues[0]?.message || "Bitte die Eingaben prüfen." }, { status: 400 });
  if (error instanceof Error && error.message === "UNAUTHORIZED") return Response.json({ error: "Bitte am Outbound Tool anmelden." }, { status: 401 });
  if (error instanceof Error && error.message === "FORBIDDEN") return Response.json({ error: "Dafür fehlen dir die WhatsApp-Rechte." }, { status: 403 });
  return Response.json({ error: error instanceof Error ? error.message : "Der WhatsApp-Vorgang konnte nicht abgeschlossen werden." }, { status: 409 });
}

export async function limitedJson(request: Request, limit = 150_000) {
  if (Number(request.headers.get("content-length") || 0) > limit) throw new Error("Die Anfrage ist zu groß.");
  const body = await request.text();
  if (body.length > limit) throw new Error("Die Anfrage ist zu groß.");
  return JSON.parse(body);
}

// A tick can wait on the local WhatsApp laptop's AI job (bounded at 44s) plus several
// DB round trips. Under real-world latency that can still creep past the route's
// maxDuration, which Vercel then kills with an opaque platform timeout instead of a
// clean, catchable error. This bails out with time to spare so the worker gets a
// normal JSON response and retries on its own next poll instead of hanging.
export async function withWorkerDeadline<T>(work: () => Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} hat zu lange gebraucht.`)), ms);
    work().then(
      (value) => { clearTimeout(timer); resolve(value); },
      (error) => { clearTimeout(timer); reject(error); },
    );
  });
}
