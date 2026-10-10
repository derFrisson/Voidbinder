import { zValidator } from '@hono/zod-validator';
import {
  PriceMappingRequestSchema,
  PriceSourceSchema,
  type ErrorResponse,
  type ImportStartedResponse,
  type PriceMappingResponse,
} from '@voidbinder/shared/api';
import { Hono, type Handler } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'hono/utils/buffer';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { MappingConflict, setManualMapping } from '../import/prices/write';
import { throwOnInvalid } from '../middleware/errors';

/**
 * `/admin/**`, behind `Authorization: Bearer <ADMIN_TOKEN>`. Without the secret the routes do not
 * exist (404), so a missing secret can never open them.
 */
export function adminRoutes(adminToken: string | undefined) {
  return (
    new Hono<AppEnv>()
      .use((_c, next) => {
        if (!adminToken) throw new HTTPException(404, { message: 'Not found' });
        return next();
      })
      .use(bearerAuth({ verifyToken: (token) => timingSafeEqual(token, adminToken ?? '') }))
      .post('/import/scryfall', importRoute('scryfall', 'Scryfall'))
      .post('/import/ygoprodeck', importRoute('ygoprodeck', 'YGOPRODeck'))
      .post('/import/tcgcsv', importRoute('tcgcsv', 'TCGCSV'))
      // A manual price mapping (VB-30): confidence 100, never overwritten by the importers.
      .put(
        '/price-mappings/:printId/:source/:finish',
        zValidator(
          'param',
          z.object({ printId: z.uuid(), source: PriceSourceSchema, finish: z.string().max(32) }),
          throwOnInvalid,
        ),
        zValidator('json', PriceMappingRequestSchema, throwOnInvalid),
        async (c) => {
          const row = await setManualMapping(c.var.platform.db, {
            ...c.req.valid('param'),
            ...c.req.valid('json'),
          }).catch((err: unknown) => {
            if (err instanceof MappingConflict)
              throw new HTTPException(409, { message: err.message });
            throw err;
          });
          if (!row) throw new HTTPException(404, { message: 'Print not found' });
          const body: PriceMappingResponse = {
            printId: row.printId,
            source: row.source as PriceMappingResponse['source'],
            finish: row.finish,
            externalId: row.externalId,
            confidence: row.confidence,
            method: 'manual',
            overriddenBy: row.overriddenBy ?? 'admin',
            note: row.note,
          };
          return c.json(body, 200);
        },
      )
  );
}

/**
 * Starts the import of `source` (the `import_runs.source`, also the Workflow job `<source>-import`)
 * unless one is running.
 */
function importRoute(source: string, label: string): Handler<AppEnv> {
  return async (c) => {
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
    await c.var.platform.jobQueue.send({ type: `${source}-import`, payload: {} });
    const body: ImportStartedResponse = { status: 'started' };
    return c.json(body, 202);
  };
}
