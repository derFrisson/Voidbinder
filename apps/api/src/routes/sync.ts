import { zValidator } from '@hono/zod-validator';
import { SyncPullQuerySchema, SyncPushRequestSchema } from '@voidbinder/shared/api';
import { Hono } from 'hono';
import type { AppEnv } from '../app';
import { requireUser } from '../auth/middleware';
import { throwOnInvalid } from '../middleware/errors';
import { syncPull, syncPush } from '../platform/cloudflare/drizzle-sync-store';

/**
 * `/sync/**` (VB-32, ADR 0005): a device pushes its changed rows and pulls what changed since its
 * cursor. The signed-in user's binders, entries, wishes and decks only.
 */
export function syncRoutes() {
  return new Hono<AppEnv>()
    .use(requireUser)
    .post('/push', zValidator('json', SyncPushRequestSchema, throwOnInvalid), async (c) =>
      c.json(await syncPush(c.var.platform.db, c.var.user.id, c.req.valid('json')), 200),
    )
    .get('/pull', zValidator('query', SyncPullQuerySchema, throwOnInvalid), async (c) =>
      c.json(await syncPull(c.var.platform.db, c.var.user.id, c.req.valid('query')), 200),
    );
}
