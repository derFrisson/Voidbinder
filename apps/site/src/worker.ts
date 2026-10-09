import { handle } from '@astrojs/cloudflare/handler';
import { handleUnsubscribe, isOneClickUnsubscribe } from './server/waitlist/handlers';
import { withWaitlist } from './server/waitlist/runtime';

/**
 * Worker entry (wrangler.jsonc `main`). Astro's `security.checkOrigin` runs before any Astro
 * middleware and has no per-route switch, so it would answer 403 to an RFC 8058 one-click
 * unsubscribe POST that carries a foreign `Origin`. That one request is answered here, before
 * Astro; everything else, including form posts to /api/waitlist, keeps the origin check.
 */
export default {
  async fetch(request, env, ctx) {
    if (await isOneClickUnsubscribe(request))
      return withWaitlist(ctx, (deps) => handleUnsubscribe(request, deps));
    return handle(request, env, ctx);
  },
} satisfies ExportedHandler<Env>;
