import { createHash, timingSafeEqual } from "node:crypto";

const HEADER_NAME = "x-internal-capture-key";

export function internalCaptureKey() {
  const source =
    process.env.AUTOMATION_SECRET ||
    process.env.AUTH_SECRET ||
    process.env.NEXTAUTH_SECRET ||
    process.env.DATABASE_URL;

  if (!source) {
    throw new Error("Interne Capture-Authentifizierung ist nicht konfiguriert.");
  }

  return createHash("sha256")
    .update(`jj-media:social-profile-capture:${source}`)
    .digest("hex");
}

export function internalCaptureHeader() {
  return { [HEADER_NAME]: internalCaptureKey() };
}

export function hasValidInternalCaptureKey(request: Request) {
  const provided = request.headers.get(HEADER_NAME);
  if (!provided) return false;

  const expected = internalCaptureKey();
  const providedBuffer = Buffer.from(provided);
  const expectedBuffer = Buffer.from(expected);
  return providedBuffer.length === expectedBuffer.length && timingSafeEqual(providedBuffer, expectedBuffer);
}
