import { zValidator } from '@hono/zod-validator';
import { GameSchema } from '@voidbinder/shared';
import {
  BANLIST_CHANGE_DAYS,
  BanlistGameSchema,
  BanlistQuerySchema,
  CardQuerySchema,
  NewSetsQuerySchema,
  SEARCH_PAGE_SIZE,
  SearchQuerySchema,
  SearchSuggestQuerySchema,
  SUGGEST_LIMIT,
  SET_PAGE_SIZE,
  SetPageQuerySchema,
  SetsQuerySchema,
  type BanlistResponse,
  type CardResponse,
  type GamesResponse,
  type NewSetsResponse,
  type PrintResponse,
  type SearchResponse,
  type SearchSuggestResponse,
  type SetPageResponse,
  type SetsResponse,
} from '@voidbinder/shared/api';
import type { IndexedSuggestions, SearchIndex } from '@voidbinder/core';
import { Hono, type Context } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { catalogCache } from '../middleware/catalog-cache';
import { throwOnInvalid } from '../middleware/errors';
import { log } from '../middleware/log';
import { priceRoutes } from './prices';

const IdParam = z.object({ id: z.uuid() });

/**
 * The typeahead from the search index (VB-98), null when Postgres must answer: no index
 * (self-hosting), an error, an index that cannot answer (never synced, stale) or no suggestions
 * (the first deploy). Sets `x-search-source` and logs the source.
 */
async function fromIndex(
  c: Context<AppEnv>,
  read: (index: SearchIndex) => Promise<IndexedSuggestions | null>,
): Promise<IndexedSuggestions | null> {
  const index = c.var.platform.searchIndex;
  let indexed: IndexedSuggestions | null = null;
  let fallback: string | undefined = 'no index';
  if (index) {
    try {
      indexed = await read(index);
      fallback = !indexed ? 'unavailable' : indexed.result.suggestions.length ? undefined : 'none';
    } catch (err) {
      fallback = 'error';
      log('warn', { message: 'search index failed', error: String(err) });
    }
    log('info', { message: 'search source', source: fallback ? 'postgres' : 'd1', fallback });
  }
  c.header('x-search-source', fallback ? 'postgres' : 'd1');
  return fallback ? null : indexed;
}

/** The UTC day `days` days ago: day-sized, so the reads that take it stay cacheable. */
const daysAgo = (days: number, now = Date.now()) =>
  new Date(now - days * 86_400_000).toISOString().slice(0, 10);

/** The UTC day BANLIST_CHANGE_DAYS days ago. */
export const banlistSince = (now = Date.now()) => daysAgo(BANLIST_CHANGE_DAYS, now);

function found<T>(value: T | null, what: string): T {
  if (!value) throw new HTTPException(404, { message: `${what} not found` });
  return value;
}

/**
 * `GET /catalog/**`: games, sets, set pages, cards, prints and prices (VB-26, VB-30), the search
 * (VB-35) with its typeahead (VB-79) and the Yu-Gi-Oh! ban list (VB-81), cached per ADR 0004.
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
    .get('/sets/new', zValidator('query', NewSetsQuerySchema, throwOnInvalid), async (c) => {
      // The home page's "new in the catalog" (VB-83).
      const { lang, days } = c.req.valid('query');
      const sets = await c.var.platform.cardStore.listNewSets(lang, daysAgo(days), daysAgo(0));
      const body: NewSetsResponse = { sets };
      return c.json(body, 200);
    })
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
      '/search/suggest',
      zValidator('query', SearchSuggestQuerySchema, throwOnInvalid),
      async (c) => {
        const query = c.req.valid('query');
        const indexed = await fromIndex(c, (index) => index.suggest(query, SUGGEST_LIMIT));
        // Answered by the index alone: its version tags the response, no Postgres round trip.
        if (indexed) c.set('catalogVersion', indexed.catalogVersion);
        const body: SearchSuggestResponse =
          indexed?.result ?? (await c.var.platform.cardStore.suggest(query, SUGGEST_LIMIT));
        return c.json(body, 200);
      },
    )
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
