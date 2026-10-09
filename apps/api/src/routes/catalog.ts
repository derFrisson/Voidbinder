import { zValidator } from '@hono/zod-validator';
import { GameSchema } from '@voidbinder/shared';
import {
  SET_PAGE_SIZE,
  SetPageQuerySchema,
  SetsQuerySchema,
  type CardResponse,
  type GamesResponse,
  type PrintResponse,
  type SetPageResponse,
  type SetsResponse,
} from '@voidbinder/shared/api';
import { COPYRIGHT } from '@voidbinder/shared/notices';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { z } from 'zod';
import type { AppEnv } from '../app';
import { catalogCache } from '../middleware/catalog-cache';
import { throwOnInvalid } from '../middleware/errors';

const IdParam = z.object({ id: z.uuid() });

function found<T>(value: T | null, what: string): T {
  if (!value) throw new HTTPException(404, { message: `${what} not found` });
  return value;
}

/** `GET /catalog/**`: games, sets, set pages, cards and prints (VB-26), cached per ADR 0004. */
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
    .get('/cards/:id', zValidator('param', IdParam, throwOnInvalid), async (c) => {
      const card: CardResponse = found(
        await c.var.platform.cardStore.getCard(c.req.valid('param').id),
        'Card',
      );
      // The card page shows each print's `artist` and this line next to the image (VB-57).
      const body = { ...card, copyright: COPYRIGHT[card.card.game] };
      return c.json(body, 200);
    })
    .get('/prints/:id', zValidator('param', IdParam, throwOnInvalid), async (c) => {
      const print: PrintResponse = found(
        await c.var.platform.cardStore.getPrint(c.req.valid('param').id),
        'Print',
      );
      const body = { ...print, copyright: COPYRIGHT[print.card.game] };
      return c.json(body, 200);
    });
}
