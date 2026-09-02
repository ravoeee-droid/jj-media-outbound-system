import { getVercelOidcToken } from "@vercel/oidc";

const PROJECT_URL = "https://dessavbytgxyygeohjrn.supabase.co";
const BUCKET = "jj-media-outbound";
const BROKER_URL = `${PROJECT_URL}/functions/v1/jj-media-storage-broker`;

function cleanPath(value) {
  const input = String(value || "");
  if (/^https?:\/\//i.test(input)) {
    try {
      const url = new URL(input);
      const marker = `/storage/v1/object/authenticated/${BUCKET}/`;
      const index = url.pathname.indexOf(marker);
      if (index >= 0) return decodeURIComponent(url.pathname.slice(index + marker.length));
    } catch {}
  }
  return input.replace(/^\/+/, "").replace(/\.\./g, "");
}

function storageUrl(path) {
  const encoded = cleanPath(path).split("/").map(encodeURIComponent).join("/");
  return `${PROJECT_URL}/storage/v1/object/authenticated/${BUCKET}/${encoded}`;
}

async function broker(payload) {
  const token = await getVercelOidcToken();
  if (!token) throw new Error("Vercel OIDC ist für den Medienspeicher nicht verfügbar.");
  const response = await fetch(BROKER_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(payload),
    cache: "no-store",
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `Medienspeicher antwortete mit HTTP ${response.status}.`);
  return data;
}

export async function put(pathname, body, options = {}) {
  const path = cleanPath(pathname);
  const signed = await broker({ action: "sign_upload", path });
  const response = await fetch(signed.signedUrl, {
    method: "PUT",
    headers: {
      "content-type": options.contentType || "application/octet-stream",
      "cache-control": "max-age=3600",
      "x-upsert": "true",
    },
    body,
  });
  if (!response.ok) throw new Error(`Upload fehlgeschlagen (${response.status}): ${(await response.text().catch(() => "")).slice(0, 240)}`);
  return { url: storageUrl(path), pathname: path, contentType: options.contentType };
}

export async function get(pathOrUrl, options = {}) {
  const path = cleanPath(pathOrUrl);
  const signed = await broker({ action: "sign_download", path, expiresIn: 900 });
  const headers = new Headers();
  const requested = new Headers(options.headers);
  for (const key of ["range", "if-none-match", "if-modified-since"]) {
    const value = requested.get(key);
    if (value) headers.set(key, value);
  }
  const response = await fetch(signed.signedUrl, { cache: "no-store", headers });
  if (!response.ok && response.status !== 304 && response.status !== 416) return null;
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const size = Number(response.headers.get("content-length") || 0);
  return {
    stream: response.body,
    headers: response.headers,
    statusCode: response.status,
    blob: { contentType, size },
    contentType,
    size,
    pathname: path,
    url: storageUrl(path),
  };
}

export async function del(pathOrUrl) {
  const path = cleanPath(pathOrUrl);
  await broker({ action: "delete", path });
}

export async function issueSignedToken({ pathname }) {
  return cleanPath(pathname);
}

export async function presignUrl(_token, options = {}) {
  const path = cleanPath(options.pathname || _token);
  const expiresMs = options.validUntil ? Math.max(60_000, Number(options.validUntil) - Date.now()) : 900_000;
  const signed = await broker({ action: "sign_download", path, expiresIn: Math.ceil(expiresMs / 1000) });
  return { presignedUrl: signed.signedUrl };
}
