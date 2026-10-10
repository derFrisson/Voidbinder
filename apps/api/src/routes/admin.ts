import { zValidator } from '@hono/zod-validator';
import {
  PriceMappingRequestSchema,
  type ErrorResponse,
  type ImportHealth,
  type ImportsResponse,
  type ImportStartedResponse,
  type PriceMappingResponse,
} from '@voidbinder/shared/api';
import { Hono, type Context, type Handler } from 'hono';
import { bearerAuth } from 'hono/bearer-auth';
import { HTTPException } from 'hono/http-exception';
import { timingSafeEqual } from 'hono/utils/buffer';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { importOverview } from '../import/health';
import { MappingConflict, setManualMapping } from '../import/prices/override';
import { throwOnInvalid } from '../middleware/errors';

/**
 * `/admin/**`, behind `Authorization: Bearer <ADMIN_TOKEN>`. Without the secret the routes do not
 * exist (404), so a missing secret can never open them.
 */
export function adminRoutes(adminToken: string | undefined, importEnv = 'local') {
  return (
    new Hono<AppEnv>()
      .use((_c, next) => {
        if (!adminToken) throw new HTTPException(404, { message: 'Not found' });
        return next();
      })
      .use(bearerAuth({ verifyToken: (token) => timingSafeEqual(token, adminToken ?? '') }))
      // VB-83: the last runs per source and whether each scheduled import succeeded in time; the
      // health alone is what scripts/vps/import-health.sh pushes to Uptime Kuma.
      .get('/imports', async (c) => {
        const body: ImportsResponse = await importOverview(c.var.platform.db, importEnv);
        return c.json(body, 200);
      })
      .get('/imports/health', async (c) => {
        const body: ImportHealth = (await importOverview(c.var.platform.db, importEnv)).health;
        return c.json(body, 200);
      })
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
      )
      .post(
        '/import/tcgcsv',
        // `?force=true` (or `1`) imports even a build already imported: the group and product
        // matching re-runs, so a new rule reaches the prices without a new build (VB-110, VB-111).
        importRoute('tcgcsv', 'TCGCSV', (c) => ({
          force: ['true', '1'].includes(c.req.query('force') ?? ''),
        })),
      )
      // VB-93: names and texts YGOPRODeck lacks, from Yugipedia.
      .post('/import/yugipedia', importRoute('yugipedia', 'Yugipedia'))
      // VB-106: the artwork of every print from the set galleries (the Yugipedia Workflow alone).
      .post(
        '/import/yugipedia-galleries',
        importRoute('yugipedia-galleries', 'Yugipedia gallery', () => ({ galleries: 'only' })),
      )
      // VB-111: per set the prints with a current TCGplayer price, the groups no set matched and
      // the sets that have a group and no price, from the group list of the last TCGCSV run.
      .get(
        '/prices/coverage',
        zValidator(
          'query',
          z.object({ game: z.enum(['mtg', 'yugioh', 'pokemon']) }),
          throwOnInvalid,
        ),
        async (c) => {
          const coverage = await c.var.platform.priceCoverage?.(c.req.valid('query').game);
          if (!coverage) throw new HTTPException(404, { message: 'No TCGCSV group list yet' });
          return c.json(coverage, 200);
        },
      )
      // Rewrites the whole search index from Postgres (VB-98); waits for a running refresh.
      .post('/search-index/rebuild', async (c) => {
        await c.var.platform.jobQueue.send({
          type: 'search-index-refresh',
          payload: { full: true },
        });
        const body: ImportStartedResponse = { status: 'started' };
        return c.json(body, 202);
      })
      // A manual price mapping (VB-30): confidence 100, never overwritten by the importers.
      // `tcgplayer` only: the Scryfall sources write by print, never through price_mappings.
      .put(
        '/price-mappings/:printId/:source/:finish',
        zValidator(
          'param',
          z.object({
            printId: z.uuid(),
            source: z.literal('tcgplayer'),
            finish: z.string().max(32),
          }),
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
            source: 'tcgplayer',
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

/** `import_runs` sources that crawl one site and so share its rate (VB-106: Yugipedia, 1 req/s). */
const SHARED_LOCKS = [['yugipedia', 'yugipedia-galleries', 'yugipedia-set-lists']];

/** Whether an import of `source`, or of a source it shares a lock with, is running. */
export async function importBlocked(
  store: { importRunning(source: string): Promise<boolean> },
  source: string,
): Promise<boolean> {
  for (const s of SHARED_LOCKS.find((l) => l.includes(source)) ?? [source])
    if (await store.importRunning(s)) return true;
  return false;
}

/**
 * Starts the import of `source` (the `import_runs.source`, also the Workflow job `<source>-import`)
 * unless one of it, or of a source sharing its lock (`importBlocked`), is running.
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
    if (await importBlocked(c.var.platform.cardStore, source)) {
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
