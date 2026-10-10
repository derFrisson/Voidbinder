import { zValidator } from '@hono/zod-validator';
import type { ExportRow } from '@voidbinder/core';
import {
  BinderOrderRequestSchema,
  COLLECTION_PAGE_SIZE,
  CreateBinderRequestSchema,
  CreateEntriesRequestSchema,
  CreateWishesRequestSchema,
  EntriesQuerySchema,
  OwnedQuerySchema,
  SummaryQuerySchema,
  UpdateBinderRequestSchema,
  UpdateEntryRequestSchema,
  UpdateWishRequestSchema,
  WishlistQuerySchema,
  type BindersResponse,
  type CreateEntriesResponse,
  type CreateWishesResponse,
  type Currency,
} from '@voidbinder/shared/api';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { requireUser } from '../auth/middleware';
import { throwOnInvalid } from '../middleware/errors';

const IdParam = z.object({ id: z.uuid() });
const id = zValidator('param', IdParam, throwOnInvalid);

const CSV_COLUMNS = ['Name', 'Set Code', 'Number', 'Language', 'Condition', 'Finish', 'Quantity'];

/** One CSV field: quoted when it holds a comma, quote or line break (RFC 4180). */
const field = (v: string | number) => {
  const s = String(v);
  return /[",\r\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};
export const csvLine = (values: (string | number)[]) => `${values.map(field).join(',')}\r\n`;

const csvRow = (r: ExportRow) =>
  csvLine([r.name, r.setCode, r.number, r.language, r.condition, r.finish, r.quantity]);

/**
 * `/collection/**` (VB-31): binders, the have list, the wish list, the value summary, owned
 * counts for the card and set pages and the CSV export. Every route needs a user and only ever
 * sees that user's rows; another user's id answers 404.
 */
export function collectionRoutes() {
  return (
    new Hono<AppEnv>()
      .use(requireUser)
      // ---- binders ----
      .get('/binders', async (c) => {
        const body: BindersResponse = {
          binders: await c.var.platform.collectionStore.listBinders(c.var.user.id),
        };
        return c.json(body, 200);
      })
      .post(
        '/binders',
        zValidator('json', CreateBinderRequestSchema, throwOnInvalid),
        async (c) => {
          const binder = await c.var.platform.collectionStore.createBinder(
            c.var.user.id,
            c.req.valid('json'),
          );
          return c.json(binder, 201);
        },
      )
      .put(
        '/binders/order',
        zValidator('json', BinderOrderRequestSchema, throwOnInvalid),
        async (c) => {
          const body: BindersResponse = {
            binders: await c.var.platform.collectionStore.orderBinders(
              c.var.user.id,
              c.req.valid('json'),
            ),
          };
          return c.json(body, 200);
        },
      )
      .patch(
        '/binders/:id',
        id,
        zValidator('json', UpdateBinderRequestSchema, throwOnInvalid),
        async (c) => {
          const binder = await c.var.platform.collectionStore.updateBinder(
            c.var.user.id,
            c.req.valid('param').id,
            c.req.valid('json'),
          );
          return c.json(binder, 200);
        },
      )
      .delete('/binders/:id', id, async (c) => {
        await c.var.platform.collectionStore.deleteBinder(c.var.user.id, c.req.valid('param').id);
        return c.body(null, 204);
      })
      // ---- entries ----
      .get('/entries', zValidator('query', EntriesQuerySchema, throwOnInvalid), async (c) => {
        const query = c.req.valid('query');
        const body = await c.var.platform.collectionStore.listEntries(
          c.var.user.id,
          { ...query, currency: query.currency ?? (c.var.user.currency as Currency) },
          COLLECTION_PAGE_SIZE,
        );
        return c.json(body, 200);
      })
      .post(
        '/entries',
        zValidator('json', CreateEntriesRequestSchema, throwOnInvalid),
        async (c) => {
          const json = c.req.valid('json');
          const body: CreateEntriesResponse = {
            entries: await c.var.platform.collectionStore.createEntries(
              c.var.user.id,
              Array.isArray(json) ? json : [json],
              c.var.user.currency as Currency,
            ),
          };
          return c.json(body, 201);
        },
      )
      .patch(
        '/entries/:id',
        id,
        zValidator('json', UpdateEntryRequestSchema, throwOnInvalid),
        async (c) => {
          const entry = await c.var.platform.collectionStore.updateEntry(
            c.var.user.id,
            c.req.valid('param').id,
            c.req.valid('json'),
            c.var.user.currency as Currency,
          );
          return c.json(entry, 200);
        },
      )
      .delete('/entries/:id', id, async (c) => {
        await c.var.platform.collectionStore.deleteEntry(c.var.user.id, c.req.valid('param').id);
        return c.body(null, 204);
      })
      // ---- wish list ----
      .get('/wishlist', zValidator('query', WishlistQuerySchema, throwOnInvalid), async (c) => {
        const query = c.req.valid('query');
        const body = await c.var.platform.collectionStore.listWishes(
          c.var.user.id,
          { ...query, currency: query.currency ?? (c.var.user.currency as Currency) },
          COLLECTION_PAGE_SIZE,
        );
        return c.json(body, 200);
      })
      .post(
        '/wishlist',
        zValidator('json', CreateWishesRequestSchema, throwOnInvalid),
        async (c) => {
          const json = c.req.valid('json');
          const body: CreateWishesResponse = {
            entries: await c.var.platform.collectionStore.createWishes(
              c.var.user.id,
              Array.isArray(json) ? json : [json],
              c.var.user.currency as Currency,
            ),
          };
          return c.json(body, 201);
        },
      )
      .patch(
        '/wishlist/:id',
        id,
        zValidator('json', UpdateWishRequestSchema, throwOnInvalid),
        async (c) => {
          const wish = await c.var.platform.collectionStore.updateWish(
            c.var.user.id,
            c.req.valid('param').id,
            c.req.valid('json'),
            c.var.user.currency as Currency,
          );
          return c.json(wish, 200);
        },
      )
      .delete('/wishlist/:id', id, async (c) => {
        await c.var.platform.collectionStore.deleteWish(c.var.user.id, c.req.valid('param').id);
        return c.body(null, 204);
      })
      // ---- summary, owned, export ----
      .get('/summary', zValidator('query', SummaryQuerySchema, throwOnInvalid), async (c) => {
        const currency = c.req.valid('query').currency ?? (c.var.user.currency as Currency);
        const body = await c.var.platform.collectionStore.summary(c.var.user.id, currency);
        return c.json(body, 200);
      })
      .get('/owned', zValidator('query', OwnedQuerySchema, throwOnInvalid), async (c) => {
        const body = await c.var.platform.collectionStore.owned(
          c.var.user.id,
          c.req.valid('query').printIds,
        );
        return c.json(body, 200);
      })
      .get('/export.csv', async (c) => {
        // ponytail: the request's pool closes when the handler returns, so every batch is read
        // here and the body streams from memory (about 60 bytes per entry). Stream from the
        // database once the platform can close after the response body.
        const chunks = [csvLine(CSV_COLUMNS)];
        for await (const batch of c.var.platform.collectionStore.exportRows(c.var.user.id)) {
          chunks.push(batch.map(csvRow).join(''));
        }
        const encoder = new TextEncoder();
        const body = new ReadableStream<Uint8Array>({
          pull(controller) {
            const next = chunks.shift();
            if (next === undefined) controller.close();
            else controller.enqueue(encoder.encode(next));
          },
        });
        return new Response(body, {
          headers: {
            'Content-Type': 'text/csv; charset=utf-8',
            'Content-Disposition': 'attachment; filename="voidbinder-collection.csv"',
            'Cache-Control': 'no-store',
          },
        });
      })
  );
}
