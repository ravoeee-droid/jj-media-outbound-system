import { getVercelOidcToken } from "@vercel/oidc";

const PROJECT_URL = "https://dessavbytgxyygeohjrn.supabase.co";
const BUCKET = "jj-media-outbound";
const BROKER_URL = `${PROJECT_URL}/functions/v1/jj-media-storage-broker`;

async function broker<T>(payload: Record<string, unknown>): Promise<T> {
  const oidcToken = await getVercelOidcToken();
  if (!oidcToken) throw new Error("Vercel OIDC ist für den sicheren Medienspeicher nicht verfügbar.");
  const response = await fetch(BROKER_URL, {
    method: "POST",
    headers: {
      authorization: `Bearer ${oidcToken}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error || `Medienspeicher antwortete mit HTTP ${response.status}.`);
  return data;
}

function cleanPath(path: string) {
  return path.replace(/^\/+/, "").replace(/\.\./g, "");
}

export function mediaStorageUrl(path: string) {
  const encoded = cleanPath(path).split("/").map(encodeURIComponent).join("/");
  return `${PROJECT_URL}/storage/v1/object/authenticated/${BUCKET}/${encoded}`;
}

export function mediaPath(value: string) {
  if (!value) return value;
  if (!/^https?:\/\//i.test(value)) return cleanPath(value);
  try {
    const url = new URL(value);
    const marker = `/storage/v1/object/authenticated/${BUCKET}/`;
    const index = url.pathname.indexOf(marker);
    if (index >= 0) return decodeURIComponent(url.pathname.slice(index + marker.length));
  } catch {
    // Fall through and use the original value.
  }
  return cleanPath(value);
}

export async function createMediaUpload(path: string) {
  const clean = cleanPath(path);
  return broker<{ signedUrl: string; token: string; path: string }>({ action: "sign_upload", path: clean });
}

export async function uploadMedia(path: string, body: BodyInit, contentType: string) {
  const clean = cleanPath(path);
  const signed = await createMediaUpload(clean);
  const response = await fetch(signed.signedUrl, {
    method: "PUT",
    headers: {
      "content-type": contentType,
      "cache-control": "max-age=3600",
      "x-upsert": "true",
    },
    body,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Upload in den Medienspeicher fehlgeschlagen (${response.status})${detail ? `: ${detail.slice(0, 240)}` : ""}`);
  }
  return { url: mediaStorageUrl(clean), pathname: clean };
}

export async function signMediaDownload(pathOrUrl: string, expiresIn = 900) {
  const path = mediaPath(pathOrUrl);
  return broker<{ signedUrl: string; path: string; expiresIn: number }>({
    action: "sign_download",
    path,
    expiresIn,
  });
}

export async function downloadMedia(pathOrUrl: string) {
  const signed = await signMediaDownload(pathOrUrl, 900);
  const response = await fetch(signed.signedUrl, { cache: "no-store" });
  if (!response.ok) throw new Error(`Medium konnte nicht geladen werden (${response.status}).`);
  return response;
}

export async function deleteMedia(pathOrUrl: string) {
  const path = mediaPath(pathOrUrl);
  await broker<{ ok: boolean }>({ action: "delete", path });
}
