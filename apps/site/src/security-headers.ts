// Security headers for every response (docs/site/seo.md). One list, two delivery paths: the build
// writes them into dist/client/_headers for static assets (src/integrations/seo.ts),
// and src/worker.ts sets them on everything the Worker answers, because Cloudflare does not apply
// _headers to Worker responses.
//
// No hashes or nonces: the built pages contain no inline <script> or <style> and no style=""
// attributes (build.inlineStylesheets is 'never'; apps/site/test/build.test.ts guards it). JSON-LD
// is a data block, which CSP does not govern. The Web Analytics beacon is an external script from
// static.cloudflareinsights.com that reports to cloudflareinsights.com. The waitlist's Turnstile
// widget (VB-72) loads its script from and draws its iframe from challenges.cloudflare.com.
export const contentSecurityPolicy = [
  "default-src 'self'",
  "script-src 'self' https://static.cloudflareinsights.com https://challenges.cloudflare.com",
  'frame-src https://challenges.cloudflare.com',
  "style-src 'self'",
  "img-src 'self' data:",
  "connect-src 'self' https://cloudflareinsights.com",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

/** `prod` adds HSTS; dev (workers.dev, already on the HSTS preload list) and local go without. */
export function securityHeaders(prod: boolean): Record<string, string> {
  return {
    'Content-Security-Policy': contentSecurityPolicy,
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Opener-Policy': 'same-origin',
    // ponytail: no includeSubDomains/preload until every voidbinder.de subdomain is known to be HTTPS.
    ...(prod ? { 'Strict-Transport-Security': 'max-age=63072000' } : {}),
  };
}
