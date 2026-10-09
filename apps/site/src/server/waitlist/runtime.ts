import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { WaitlistDeps } from './handlers';
import { bindingMailSender, logMailSender } from './mail';
import { DrizzleWaitlistRepository } from './repository';

/**
 * Runs one waitlist request with the Cloudflare bindings. The pool lives for this request only
 * (Hyperdrive does the pooling at the edge) and connects on the first query, so rate-limited or
 * invalid requests never open a database connection.
 */
export async function withWaitlist(
  ctx: { waitUntil(promise: Promise<unknown>): void },
  run: (deps: WaitlistDeps) => Promise<Response>,
): Promise<Response> {
  const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  try {
    return await run({
      repo: new DrizzleWaitlistRepository(drizzle(pool)),
      // ponytail: local dev without Email Service logs the mail instead of failing.
      mail: env.EMAIL ? bindingMailSender(env.EMAIL) : logMailSender,
      siteUrl: env.SITE_URL,
      rateLimit: async (key) => (await env.RL_WAITLIST.limit({ key })).success,
    });
  } finally {
    ctx.waitUntil(pool.end());
  }
}
