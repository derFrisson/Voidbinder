import type { Game, Locale } from '@voidbinder/shared';
import type { BanlistFormat, Currency, SetPageQuery } from '@voidbinder/shared/api';
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

/**
 * A card with its prints; `currency` picks the source of each print's `marketPrice`, `lang` (the
 * language the page shows) its language (VB-103). EUR and `en` are the API's defaults and are not
 * sent, so a caller that only needs the prints (the collection buttons) and a signed-out visitor
 * share one URL and one cache entry.
 */
export const cardOptions = (id: string, currency?: Currency, lang?: string) => ({
  queryKey: ['catalog', 'card', id, currency ?? 'EUR', lang ?? 'en'],
  queryFn: () =>
    read(
      api.catalog.cards[':id'].$get({
        param: { id },
        query: {
          ...(currency && currency !== 'EUR' ? { currency } : {}),
          ...(lang && lang !== 'en' ? { lang } : {}),
        },
      }),
    ),
  staleTime,
});

export function useCard(id: string, lang: string) {
  // The prints table is priced in the profile's currency; wait for the session to know it.
  const { currency, ready } = useCurrency();
  return useQuery({ ...cardOptions(id, currency, lang), enabled: ready });
}

/**
 * The Yu-Gi-Oh! ban list of `format` (VB-81), names in `lang`; null: no list wanted (another game),
 * nothing is fetched. Every tile of a page shares the one cached answer.
 */
export function useBanlist(format: BanlistFormat | null, lang: Locale) {
  return useQuery({
    queryKey: ['catalog', 'banlist', format, lang],
    queryFn: () =>
      read(
        api.catalog.banlist[':game'].$get({
          param: { game: 'yugioh' },
          query: { format: format ?? 'tcg', lang },
        }),
      ),
    staleTime,
    enabled: format !== null,
  });
}
