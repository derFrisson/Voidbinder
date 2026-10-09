import type { ErrorResponse, ImportStartedResponse } from '@voidbinder/shared/api';
import { Hono } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'hono/utils/buffer';
import type { AppEnv } from '../app';

/**
 * `/admin/**`, behind `Authorization: Bearer <ADMIN_TOKEN>`. Without the secret the routes do not
 * exist (404), so a missing secret can never open them.
 */
export function adminRoutes(adminToken: string | undefined) {
  return new Hono<AppEnv>()
    .use((_c, next) => {
      if (!adminToken) throw new HTTPException(404, { message: 'Not found' });
      return next();
    })
    .use(bearerAuth({ verifyToken: (token) => timingSafeEqual(token, adminToken ?? '') }))
    .post('/import/scryfall', async (c) => {
      // ponytail: the check and the Workflow's own `import_runs` row are not atomic; two calls
      // within the seconds before its first step can both start (the cron's daily id is unique).
      if (await c.var.platform.cardStore.importRunning('scryfall')) {
        const error: ErrorResponse = {
          error: {
            code: 'import_running',
            message: 'A Scryfall import is already running',
            requestId: c.var.requestId,
          },
        };
        return c.json(error, 409);
      }
      await c.var.platform.jobQueue.send({ type: 'scryfall-import', payload: {} });
      const body: ImportStartedResponse = { status: 'started' };
      return c.json(body, 202);
    });
}
