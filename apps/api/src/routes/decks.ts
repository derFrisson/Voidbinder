import { zValidator } from '@hono/zod-validator';
import type { DeckReadOptions } from '@voidbinder/core';
import {
  CreateDeckRequestSchema,
  DeckQuerySchema,
  PutDeckEntriesRequestSchema,
  UpdateDeckRequestSchema,
  type Currency,
  type DecksResponse,
} from '@voidbinder/shared/api';
import type { Locale } from '@voidbinder/shared';
import { Hono } from 'hono';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { requireUser } from '../auth/middleware';
import { throwOnInvalid } from '../middleware/errors';

const id = zValidator('param', z.object({ id: z.uuid() }), throwOnInvalid);
const query = zValidator('query', DeckQuerySchema, throwOnInvalid);

/** Prices in `?currency=` (else the user's), names in the user's language. */
const readOptions = (
  user: { currency: string; language: string },
  currency?: Currency,
): DeckReadOptions => ({
  currency: currency ?? (user.currency as Currency),
  lang: user.language as Locale,
});

/**
 * `/decks/**` (VB-34): the signed-in user's decks. Every answer with a deck carries its entries
 * and the rules' verdict against the user's collection; another user's deck answers 404.
 */
export function deckRoutes() {
  return new Hono<AppEnv>()
    .use(requireUser)
    .get('/', query, async (c) => {
      const body: DecksResponse = {
        decks: await c.var.platform.deckStore.list(
          c.var.user.id,
          readOptions(c.var.user, c.req.valid('query').currency),
        ),
      };
      return c.json(body, 200);
    })
    .post('/', zValidator('json', CreateDeckRequestSchema, throwOnInvalid), async (c) => {
      const deck = await c.var.platform.deckStore.create(
        c.var.user.id,
        c.req.valid('json'),
        readOptions(c.var.user),
      );
      return c.json(deck, 201);
    })
    .get('/:id', id, query, async (c) => {
      const deck = await c.var.platform.deckStore.get(
        c.var.user.id,
        c.req.valid('param').id,
        readOptions(c.var.user, c.req.valid('query').currency),
      );
      return c.json(deck, 200);
    })
    .patch('/:id', id, zValidator('json', UpdateDeckRequestSchema, throwOnInvalid), async (c) => {
      const deck = await c.var.platform.deckStore.update(
        c.var.user.id,
        c.req.valid('param').id,
        c.req.valid('json'),
        readOptions(c.var.user),
      );
      return c.json(deck, 200);
    })
    .delete('/:id', id, async (c) => {
      await c.var.platform.deckStore.delete(c.var.user.id, c.req.valid('param').id);
      return c.body(null, 204);
    })
    .put(
      '/:id/entries',
      id,
      zValidator('json', PutDeckEntriesRequestSchema, throwOnInvalid),
      async (c) => {
        const deck = await c.var.platform.deckStore.putEntries(
          c.var.user.id,
          c.req.valid('param').id,
          c.req.valid('json').entries,
          readOptions(c.var.user),
        );
        return c.json(deck, 200);
      },
    );
}
