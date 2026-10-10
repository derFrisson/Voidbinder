import { zValidator } from '@hono/zod-validator';
import { GameSchema } from '@voidbinder/shared';
import {
  BANLIST_CHANGE_DAYS,
  BanlistGameSchema,
  BanlistQuerySchema,
  CardQuerySchema,
  SEARCH_PAGE_SIZE,
  SearchQuerySchema,
  SET_PAGE_SIZE,
  SetPageQuerySchema,
  SetsQuerySchema,
  type BanlistResponse,
  type CardResponse,
  type GamesResponse,
  type PrintResponse,
  type SearchResponse,
  type SetPageResponse,
  type SetsResponse,
} from '@voidbinder/shared/api';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { catalogCache } from '../middleware/catalog-cache';
import { throwOnInvalid } from '../middleware/errors';
import { priceRoutes } from './prices';

const IdParam = z.object({ id: z.uuid() });

/** The UTC day BANLIST_CHANGE_DAYS days ago: day-sized, so the ban list reads stay cacheable. */
export const banlistSince = (now = Date.now()) =>
  new Date(now - BANLIST_CHANGE_DAYS * 86_400_000).toISOString().slice(0, 10);

function found<T>(value: T | null, what: string): T {
  if (!value) throw new HTTPException(404, { message: `${what} not found` });
  return value;
}

/**
 * `GET /catalog/**`: games, sets, set pages, cards, prints and prices (VB-26, VB-30) and the
 * search (VB-35) and the Yu-Gi-Oh! ban list (VB-81), cached per ADR 0004.
 */
export function catalogRoutes() {
  return new Hono<AppEnv>()
    .use(catalogCache)
    .get('/games', async (c) => {
      const body: GamesResponse = { games: await c.var.platform.cardStore.listGames() };
      return c.json(body, 200);
    })
    .get(
      '/games/:game/sets',
      zValidator('param', z.object({ game: GameSchema }), throwOnInvalid),
      zValidator('query', SetsQuerySchema, throwOnInvalid),
      async (c) => {
        const { game } = c.req.valid('param');
        const sets = await c.var.platform.cardStore.listSets(game, c.req.valid('query').lang);
        const body: SetsResponse = { game, sets };
        return c.json(body, 200);
      },
    )
    .get(
      '/sets/:game/:code',
      zValidator('param', z.object({ game: GameSchema, code: z.string().max(32) }), throwOnInvalid),
      zValidator('query', SetPageQuerySchema, throwOnInvalid),
      async (c) => {
        const { game, code } = c.req.valid('param');
        const page = await c.var.platform.cardStore.getSetPage(
          game,
          code.toLowerCase(),
          c.req.valid('query'),
          SET_PAGE_SIZE,
        );
        const body: SetPageResponse = found(page, 'Set');
        return c.json(body, 200);
      },
    )
    .get('/search', zValidator('query', SearchQuerySchema, throwOnInvalid), async (c) => {
      const body: SearchResponse = await c.var.platform.cardStore.search(
        c.req.valid('query'),
        SEARCH_PAGE_SIZE,
      );
      return c.json(body, 200);
    })
    .get(
      '/cards/:id',
      zValidator('param', IdParam, throwOnInvalid),
      zValidator('query', CardQuerySchema, throwOnInvalid),
      async (c) => {
        const card = await c.var.platform.cardStore.getCard(
          c.req.valid('param').id,
          c.req.valid('query'),
        );
        const body: CardResponse = found(card, 'Card');
        return c.json(body, 200);
      },
    )
    .get(
      '/banlist/:game',
      zValidator('param', z.object({ game: BanlistGameSchema }), throwOnInvalid),
      zValidator('query', BanlistQuerySchema, throwOnInvalid),
      async (c) => {
        const body: BanlistResponse = await c.var.platform.cardStore.getBanlist(
          c.req.valid('query'),
          banlistSince(),
        );
        return c.json(body, 200);
      },
    )
    .get('/prints/:id', zValidator('param', IdParam, throwOnInvalid), async (c) => {
      const print = await c.var.platform.cardStore.getPrint(c.req.valid('param').id);
      const body: PrintResponse = found(print, 'Print');
      return c.json(body, 200);
    })
    .route('/', priceRoutes());
}
