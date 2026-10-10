import { env } from 'cloudflare:workers';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import type { WaitlistDeps } from './handlers';
import { bindingMailSender, logMailSender } from './mail';
import { DrizzleWaitlistRepository, type WaitlistRepository } from './repository';
import { skipsTurnstile } from './turnstile';

/**
 * A deployment without a Hyperdrive binding (the dev Worker before the database exists, VB-50)
 * must answer with the waitlist's own error page, not crash the Worker. Every repository call
 * throws, which the handlers report as `reason=server` / `500 {error:'server'}`.
 */
function unavailableRepository(): WaitlistRepository {
  return new Proxy({} as WaitlistRepository, {
    get: () => () => {
      throw new Error('[waitlist] HYPERDRIVE binding missing: database not configured');
    },
  });
}

function openRepository(): { repo: WaitlistRepository; close(): Promise<void> } {
  if (!env.HYPERDRIVE) return { repo: unavailableRepository(), close: async () => undefined };
  const pool = new Pool({ connectionString: env.HYPERDRIVE.connectionString, max: 1 });
  return { repo: new DrizzleWaitlistRepository(drizzle(pool)), close: () => pool.end() };
}

/**
 * Runs one waitlist request with the Cloudflare bindings. The pool lives for this request only
 * (Hyperdrive does the pooling at the edge) and connects on the first query, so rate-limited or
 * invalid requests never open a database connection.
 */
export async function withWaitlist(
  ctx: { waitUntil(promise: Promise<unknown>): void },
  run: (deps: WaitlistDeps) => Promise<Response>,
): Promise<Response> {
  const db = openRepository();
  try {
    return await run({
      repo: db.repo,
      // ponytail: local dev without Email Service logs the mail instead of failing.
      mail: env.EMAIL ? bindingMailSender(env.EMAIL) : logMailSender,
      siteUrl: env.SITE_URL,
      unsubscribeSecret: env.UNSUBSCRIBE_SECRET,
      turnstile: {
        secret: env.TURNSTILE_SECRET,
        skip: skipsTurnstile(env.TURNSTILE_SECRET, env.SITE_URL),
      },
      rateLimit: async (key) => (await env.RL_WAITLIST.limit({ key })).success,
    });
  } finally {
    ctx.waitUntil(db.close());
  }
}

/**
 * Runs the scheduled path (Cron Trigger) with a database only: no rate limit, no mail. Same
 * per-invocation pool as `withWaitlist`.
 */
export async function withWaitlistRepo<T>(
  ctx: { waitUntil(promise: Promise<unknown>): void },
  run: (repo: WaitlistRepository) => Promise<T>,
): Promise<T> {
  const db = openRepository();
  try {
    return await run(db.repo);
  } finally {
    ctx.waitUntil(db.close());
  }
}
