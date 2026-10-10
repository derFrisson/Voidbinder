import { zValidator } from '@hono/zod-validator';
import {
  PriceHistoryQuerySchema,
  PricesQuerySchema,
  type PriceHistoryResponse,
  type PrintPricesResponse,
} from '@voidbinder/shared/api';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { throwOnInvalid } from '../middleware/errors';

const IdParam = z.object({ id: z.uuid() });

function found<T>(value: T | null): T {
  if (!value) throw new HTTPException(404, { message: 'Print not found' });
  return value;
}

/**
 * `GET /catalog/prints/:id/prices[/history]` (VB-30). Mounted inside the catalog routes, so the
 * catalog cache (ETag of catalog_version, ADR 0004) and the cached pool apply.
 */
export function priceRoutes() {
  return new Hono<AppEnv>()
    .get(
      '/prints/:id/prices',
      zValidator('param', IdParam, throwOnInvalid),
      zValidator('query', PricesQuerySchema, throwOnInvalid),
      async (c) => {
        const { id } = c.req.valid('param');
        const prices = await c.var.platform.cardStore.getPrintPrices(id, c.req.valid('query'));
        const body: PrintPricesResponse = found(prices);
        return c.json(body, 200);
      },
    )
    .get(
      '/prints/:id/prices/history',
      zValidator('param', IdParam, throwOnInvalid),
      zValidator('query', PriceHistoryQuerySchema, throwOnInvalid),
      async (c) => {
        const { id } = c.req.valid('param');
        // The day comes from the Worker, never `now()` in SQL, so Hyperdrive can cache the read.
        const today = new Date().toISOString().slice(0, 10);
        const history = await c.var.platform.cardStore.getPriceHistory(
          id,
          c.req.valid('query').days,
          today,
        );
        const body: PriceHistoryResponse = found(history);
        return c.json(body, 200);
      },
    );
}
