// Security headers of the web app, after the site's pattern (apps/site/src/security-headers.ts):
// one list, two delivery paths. `scripts/write-headers.ts` writes it into dist/_headers after the
// export, for the static assets (index.html included, it is the SPA fallback), and src/worker.ts
// sets it on what the Worker itself answers, since Cloudflare does not apply _headers there.
//
// No inline scripts: the export's index.html loads one external bundle (public/index.html is the
// template, without Expo's inline reset). Styles need 'unsafe-inline': react-native-web inserts its
// atomic styles into a <style> element at runtime and expo-font registers the fonts the same way;
// neither can carry a nonce, and a hash cannot cover rules that are generated per render.
// The API is same-origin (`/api`, proxied by the Worker), so 'self' covers connect-src.
/** The one host card images may come from (CSP `img-src`, and `CardImage`). */
export const imageHost = 'img.voidbinder.de';

/** Cloudflare Turnstile (VB-72): its script and the iframe it draws (CSP `script-src`, `frame-src`). */
const turnstileHost = 'https://challenges.cloudflare.com';

export const contentSecurityPolicy = [
  "default-src 'self'",
  `script-src 'self' ${turnstileHost}`,
  `frame-src ${turnstileHost}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: https://${imageHost}`,
  "font-src 'self'",
  "connect-src 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

export const securityHeaders: Record<string, string> = {
  'Content-Security-Policy': contentSecurityPolicy,
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'X-Content-Type-Options': 'nosniff',
  'Cross-Origin-Opener-Policy': 'same-origin',
  // Ignored on plain http (local) and harmless on workers.dev, so one list serves every environment.
  // ponytail: no includeSubDomains/preload until every voidbinder.de subdomain is known to be HTTPS.
  'Strict-Transport-Security': 'max-age=63072000',
};
