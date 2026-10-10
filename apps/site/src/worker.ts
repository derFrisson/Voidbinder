import { handle } from '@astrojs/cloudflare/handler';
import { securityHeaders } from './security-headers';
import { handleUnsubscribe, isOneClickUnsubscribe, purgeExpired } from './server/waitlist/handlers';
import { withWaitlist, withWaitlistRepo } from './server/waitlist/runtime';

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
    return withSecurityHeaders(response, env.SITE_URL === import.meta.env.SITE, env.PLAUSIBLE_HOST);
  },
  /** Cron Trigger (wrangler.jsonc `triggers`): the waitlist retention purge. Errors propagate so a failed run shows up as one. */
  async scheduled(controller, env, ctx) {
    await withWaitlistRepo(ctx, (repo) =>
      purgeExpired({
        repo,
        pendingDays: env.WAITLIST_PENDING_RETENTION_DAYS,
        unsubscribedDays: env.WAITLIST_UNSUBSCRIBED_RETENTION_DAYS,
        now: () => new Date(controller.scheduledTime),
        log: console.log,
        warn: console.warn,
      }),
    );
  },
} satisfies ExportedHandler<Env>;

function withSecurityHeaders(
  response: Response,
  prod: boolean,
  plausibleHost: string | undefined,
): Response {
  // Responses from fetch() or Response.redirect() have immutable headers; copy before setting.
  const out = new Response(response.body, response);
  for (const [name, value] of Object.entries(securityHeaders(prod, plausibleHost)))
    out.headers.set(name, value);
  return out;
}
