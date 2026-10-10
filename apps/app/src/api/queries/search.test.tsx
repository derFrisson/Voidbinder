import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it } from 'vitest';
import { fakeApi, json } from '../../../test/fake-api';
import { fromParams, toParams, updateSearch, useSearch, type SearchState } from './search';

function wrapper({ children }: { children: ReactNode }) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

const base: SearchState = { q: 'adeline', lang: 'de', page: 1 };

describe('search params', () => {
  it('reads the URL, drops malformed values and defaults to the user language', () => {
    expect(fromParams({}, 'de')).toEqual({ ...base, q: '', set: undefined });
    expect(
      fromParams(
        {
          q: '  adeline ',
          game: 'mtg',
          set: 'MID',
          rarity: 'rare',
          lang: 'en',
          finish: 'foil',
          page: '3',
        },
        'de',
      ),
    ).toEqual({
      q: 'adeline',
      game: 'mtg',
      set: 'mid',
      rarity: 'rare',
      lang: 'en',
      finish: 'foil',
      page: 3,
    });
    expect(fromParams({ q: ['a', 'b'], game: 'chess', lang: 'fr', page: '-2' }, 'en')).toEqual({
      q: 'a',
      game: undefined,
      set: undefined,
      rarity: undefined,
      lang: 'en',
      finish: undefined,
      page: 1,
    });
    expect(fromParams({ page: '1.5' }, 'de').page).toBe(1);
  });

  it('writes only what differs from the defaults and round-trips', () => {
    expect(toParams(base, 'de')).toEqual({
      q: 'adeline',
      game: undefined,
      set: undefined,
      rarity: undefined,
      lang: undefined,
      finish: undefined,
      page: undefined,
    });
    const full: SearchState = { ...base, game: 'mtg', set: 'mid', lang: 'en', page: 2 };
    expect(toParams(full, 'de')).toMatchObject({ game: 'mtg', set: 'mid', lang: 'en', page: '2' });
    const params = Object.fromEntries(
      Object.entries(toParams(full, 'de')).filter(([, v]) => v !== undefined),
    );
    expect(fromParams(params, 'de')).toEqual({ ...full, rarity: undefined, finish: undefined });
  });

  it('clears the game filters with a new game and goes back to page 1', () => {
    const state: SearchState = { ...base, game: 'mtg', set: 'mid', rarity: 'rare', page: 4 };
    expect(updateSearch(state, { game: 'pokemon' })).toEqual({
      ...base,
      game: 'pokemon',
      set: undefined,
      rarity: undefined,
      finish: undefined,
    });
    expect(updateSearch(state, { rarity: 'common' })).toEqual({
      ...state,
      rarity: 'common',
      page: 1,
    });
    expect(updateSearch(state, { page: 5 }).page).toBe(5);
    expect(updateSearch(state, { game: 'mtg' }).set).toBe('mid');
  });
});

describe('useSearch', () => {
  const answer = { prints: [], page: 1, pageSize: 30, total: 0 };

  it('reads GET /api/catalog/search with the set filters', async () => {
    const calls = fakeApi((c) => (c.path.startsWith('/catalog/search') ? json(answer) : undefined));
    const { result } = renderHook(() => useSearch({ ...base, game: 'mtg', set: 'mid' }), {
      wrapper,
    });
    await waitFor(() => expect(result.current.data).toEqual(answer));
    const url = new URL(`http://x${calls[0]?.path}`);
    expect(url.pathname).toBe('/catalog/search');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: 'adeline',
      game: 'mtg',
      set: 'mid',
      lang: 'de',
      page: '1',
    });
  });

  it('sends nothing below two characters', async () => {
    const calls = fakeApi();
    const { result } = renderHook(() => useSearch({ ...base, q: ' a ' }), { wrapper });
    await new Promise((r) => setTimeout(r, 20));
    expect(result.current.fetchStatus).toBe('idle');
    expect(calls).toEqual([]);
  });
});
