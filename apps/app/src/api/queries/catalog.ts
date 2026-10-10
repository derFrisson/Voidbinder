import type { Game, Locale } from '@voidbinder/shared';
import type { SetPageQuery } from '@voidbinder/shared/api';
import { useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { useCurrency } from './cards';
import { read } from './http';

// Catalog reads (`/catalog/**`, apps/api/README.md). Public, cached by the API for minutes, so a
// generous staleTime here too.
const staleTime = 5 * 60_000;

export function useGames() {
  return useQuery({
    queryKey: ['catalog', 'games'],
    queryFn: () => read(api.catalog.games.$get()),
    staleTime,
  });
}

export function useSets(game: Game, lang: Locale) {
  return useQuery({
    queryKey: ['catalog', 'sets', game, lang],
    queryFn: () => read(api.catalog.games[':game'].sets.$get({ param: { game }, query: { lang } })),
    staleTime,
  });
}

export function useSetPage(game: Game, code: string, query: Partial<SetPageQuery>) {
  // The prices come in the profile's currency (EUR signed out); wait for the session to know it.
  const { currency, ready } = useCurrency();
  const q = Object.fromEntries(
    Object.entries({ ...query, currency })
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, String(v)]),
  );
  return useQuery({
    queryKey: ['catalog', 'set', game, code, q],
    queryFn: () =>
      read(api.catalog.sets[':game'][':code'].$get({ param: { game, code }, query: q })),
    staleTime,
    enabled: ready,
    // Paging and filtering of one set keep its grid on screen until the next page arrives.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === game && previousQuery.queryKey[3] === code
        ? previous
        : undefined,
  });
}

export const cardOptions = (id: string) => ({
  queryKey: ['catalog', 'card', id],
  queryFn: () => read(api.catalog.cards[':id'].$get({ param: { id } })),
  staleTime,
});

export function useCard(id: string) {
  return useQuery(cardOptions(id));
}
