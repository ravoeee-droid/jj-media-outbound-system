import { put } from "@vercel/blob";
import { getDb } from "@/db";
import { assets } from "@/db/schema";
import { whatsappError, whatsappWorkspace } from "@/lib/whatsapp/http";

export const runtime = "nodejs";
const allowed = new Map([['image/jpeg', 'image'], ['image/png', 'image'], ['image/webp', 'image'], ['application/pdf', 'document'], ['audio/mpeg', 'audio'], ['audio/mp4', 'audio'], ['audio/ogg', 'audio'], ['audio/wav', 'audio'], ['audio/webm', 'audio']]);

export async function POST(request: Request) {
  try {
    const { workspaceId } = await whatsappWorkspace();
    if (Number(request.headers.get("content-length") || 0) > 3_300_000) throw new Error("Bitte einen Anhang bis 3 MB auswählen.");
    const data = await request.formData();
    const file = data.get("file");
    if (!(file instanceof File) || !allowed.has(file.type) || file.size > 3 * 1024 * 1024 || file.size === 0) throw new Error("Erlaubt sind Bilder, PDF und Audio bis 3 MB.");
    const filename = file.name.replace(/[^\p{L}\p{N}._-]/gu, "_").slice(0, 120);
    const path = `whatsapp/${workspaceId}/${crypto.randomUUID()}/${filename}`;
    const stored = await put(path, file, { access: "private", contentType: file.type, addRandomSuffix: false });
    const [asset] = await getDb().insert(assets).values({ workspaceId, kind: `whatsapp_${allowed.get(file.type)}`, blobUrl: stored.url, pathname: stored.pathname, filename, contentType: file.type, size: file.size }).returning({ id: assets.id, filename: assets.filename, contentType: assets.contentType, size: assets.size });
    return Response.json({ asset });
  } catch (error) { return whatsappError(error); }
}
