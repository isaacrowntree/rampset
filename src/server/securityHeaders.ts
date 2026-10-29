/** Headers every response carries. Set on the Worker's responses here, and on
 * static assets by public/_headers (which never sees a Worker response).
 *
 * script-src keeps 'unsafe-inline': the App Router streams each page's RSC
 * payload as inline scripts whose content changes per build, and pages are
 * prerendered and cached offline by the service worker, so per-request nonces
 * aren't available. (A hash for the theme script would make browsers ignore
 * 'unsafe-inline' and break those.) Everything else is locked down: no script
 * from anywhere but this origin and Turnstile, no plugins, no <base>, no
 * framing, and fetches only to this origin. */
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://challenges.cloudflare.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self'",
  "connect-src 'self'",
  "frame-src https://challenges.cloudflare.com",
  "worker-src 'self'",
  "manifest-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join("; ");

export const SECURITY_HEADERS: Record<string, string> = {
  "Content-Security-Policy": CSP,
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=(), payment=(), usb=()",
  "Strict-Transport-Security": "max-age=31536000; includeSubDomains",
  "Cross-Origin-Opener-Policy": "same-origin",
};

/** The response with the security headers, and — for the API, which is one
 * account's live state — never stored by any cache. */
export function withSecurityHeaders(res: Response, pathname: string): Response {
  // Responses from fetch() can have immutable headers; copy to be sure.
  const out = new Response(res.body, res);
  for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
    if (!out.headers.has(k)) out.headers.set(k, v);
  }
  if (pathname.startsWith("/api/")) out.headers.set("Cache-Control", "private, no-store");
  return out;
}
