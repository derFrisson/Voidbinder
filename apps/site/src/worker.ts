import { handle } from '@astrojs/cloudflare/handler';
import { securityHeaders } from './security-headers';
import { handleUnsubscribe, isOneClickUnsubscribe } from './server/waitlist/handlers';
import { withWaitlist } from './server/waitlist/runtime';

/**
 * Worker entry (wrangler.jsonc `main`). Astro's `security.checkOrigin` runs before any Astro
 * middleware and has no per-route switch, so it would answer 403 to an RFC 8058 one-click
 * unsubscribe POST that carries a foreign `Origin`. That one request is answered here, before
 * Astro; everything else, including form posts to /api/waitlist, keeps the origin check.
 *
 * Static assets never reach this code and get their security headers from _headers; everything
 * answered here (the `/` redirect, the API, error pages) gets the same set below.
 */
export default {
  async fetch(request, env, ctx) {
    const response = (await isOneClickUnsubscribe(request))
      ? await withWaitlist(ctx, (deps) => handleUnsubscribe(request, deps))
      : await handle(request, env, ctx);
    // Prod is the environment whose SITE_URL is astro.config `site`; only it sends HSTS.
    return withSecurityHeaders(response, env.SITE_URL === import.meta.env.SITE);
  },
} satisfies ExportedHandler<Env>;

function withSecurityHeaders(response: Response, prod: boolean): Response {
  // Responses from fetch() or Response.redirect() have immutable headers; copy before setting.
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders(prod))) out.headers.set(name, value);
  return out;
}
