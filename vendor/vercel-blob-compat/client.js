function cleanPath(value) {
  return String(value || "").replace(/^\/+/, "").replace(/\.\./g, "");
}

export async function upload(pathname, file, options = {}) {
  const handleUploadUrl = options.handleUploadUrl || "/api/assets/upload";
  options.onUploadProgress?.({ percentage: 1, loaded: 0, total: file.size || 0 });
  const tokenResponse = await fetch(handleUploadUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      pathname: cleanPath(pathname),
      clientPayload: options.clientPayload || "",
      contentType: options.contentType || file.type || "application/octet-stream",
      size: file.size || 0,
    }),
    signal: options.abortSignal,
  });
  const token = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !token.signedUrl) {
    throw new Error(token.error || `Upload konnte nicht vorbereitet werden (${tokenResponse.status}).`);
  }
  const response = await fetch(token.signedUrl, {
    method: "PUT",
    headers: {
      "content-type": options.contentType || file.type || "application/octet-stream",
      "cache-control": "max-age=3600",
      "x-upsert": "true",
    },
    body: file,
    signal: options.abortSignal,
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`Datei-Upload fehlgeschlagen (${response.status})${detail ? `: ${detail.slice(0, 200)}` : ""}`);
  }
  options.onUploadProgress?.({ percentage: 100, loaded: file.size || 0, total: file.size || 0 });
  return { url: token.url, pathname: token.pathname };
}
