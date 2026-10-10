import type { ErrorResponse, ImportStartedResponse } from '@voidbinder/shared/api';
import { Hono, type Context, type Handler } from 'hono';
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
    .post('/import/scryfall', importRoute('scryfall', 'Scryfall'))
    .post('/import/ygoprodeck', importRoute('ygoprodeck', 'YGOPRODeck'))
    .post(
      '/import/tcgdex',
      // `?mode=full` refetches every set; the default only the new, incomplete and recent ones.
      importRoute('tcgdex', 'TCGdex', (c) => {
        const mode = c.req.query('mode') ?? 'incremental';
        if (mode !== 'incremental' && mode !== 'full')
          throw new HTTPException(400, { message: 'mode must be incremental or full' });
        return { mode };
      }),
    );
}

/**
 * Starts the import of `source` (the `import_runs.source`, also the Workflow job `<source>-import`)
 * unless one is running.
 */
function importRoute(
  source: string,
  label: string,
  payload: (c: Context<AppEnv>) => Record<string, unknown> = () => ({}),
): Handler<AppEnv> {
  return async (c) => {
    const params = payload(c);
    // ponytail: the check and the Workflow's own `import_runs` row are not atomic; two calls
    // within the seconds before its first step can both start (the cron's daily id is unique).
    if (await c.var.platform.cardStore.importRunning(source)) {
      const error: ErrorResponse = {
        error: {
          code: 'import_running',
          message: `A ${label} import is already running`,
          requestId: c.var.requestId,
        },
      };
      return c.json(error, 409);
    }
    await c.var.platform.jobQueue.send({ type: `${source}-import`, payload: params });
    const body: ImportStartedResponse = { status: 'started' };
    return c.json(body, 202);
  };
}
