export function googleOAuthAppBase(requestUrl: string) {
  const base = (process.env.NEXT_PUBLIC_APP_URL || new URL(requestUrl).origin).replace(/\/$/, "");
  return new URL(base).pathname.endsWith("/admin") ? base : `${base}/admin`;
}
