import type { GamesResponse, HealthResponse, SearchSuggestResponse } from '@voidbinder/shared/api';
import { describe, expect, expectTypeOf, it } from 'vitest';
import { createApiClient } from './client';
import { testApp } from './test-helpers';

describe('createApiClient', () => {
  it('calls the app and returns typed JSON', async () => {
    const app = testApp();
    const client = createApiClient('http://api.test', {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
    });
    const res = await client.health.$get();
    const body = await res.json();
    expectTypeOf(body).toEqualTypeOf<HealthResponse>();
    expect(body).toEqual({ status: 'ok', db: 'ok', version: 'test' });
  });

  it('types the catalog routes', async () => {
    const games: GamesResponse['games'] = [
      { id: 'mtg', name: 'Magic: The Gathering', setCount: 1 },
    ];
    const app = testApp({
      cardStore: { listGames: async () => games, catalogVersion: async () => '1' } as never,
    });
    const client = createApiClient('http://api.test', {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
    });
    const res = await client.catalog.games.$get();
    const body = await res.json();
    expectTypeOf(body).toEqualTypeOf<GamesResponse>();
    expect(body.games).toEqual(games);
    expectTypeOf(client.catalog.cards[':id'].$get)
      .parameter(0)
      .toEqualTypeOf<
        { param: { id: string } } & { query: { currency?: 'EUR' | 'USD' | undefined } }
      >();
  });

  it('types the search suggestions', async () => {
    const suggestions: SearchSuggestResponse['suggestions'] = [
      {
        kind: 'set',
        id: '00000000-0000-4000-8000-000000000001',
        name: 'Legendary Duelists: Season 3',
        game: 'yugioh',
        set: { code: 'lds3', name: 'Legendary Duelists: Season 3' },
      },
    ];
    const app = testApp({
      cardStore: {
        suggest: async () => ({ suggestions }),
        catalogVersion: async () => '1',
      } as never,
    });
    const client = createApiClient('http://api.test', {
      fetch: (input: RequestInfo | URL, init?: RequestInit) => app.request(input, init),
    });
    const res = await client.catalog.search.suggest.$get({ query: { q: 'lds3' } });
    const body = await res.json();
    expectTypeOf(body).toEqualTypeOf<SearchSuggestResponse>();
    expect(body.suggestions).toEqual(suggestions);
  });
});
