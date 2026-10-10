import { GameSchema, LocaleSchema, type Game, type Locale } from '@voidbinder/shared';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { read } from './http';

// The card search (`GET /catalog/search`, VB-35). The state lives in the URL, so a search can be
// shared: `/search?q=adeline&game=mtg&set=mid&rarity=rare&lang=en&finish=foil&page=2`.

export type SearchState = {
  q: string;
  game?: Game | undefined;
  /** Set code, lowercase. */
  set?: string | undefined;
  rarity?: string | undefined;
  /** Language of the names; the user's unless the URL says otherwise. */
  lang: Locale;
  finish?: string | undefined;
  page: number;
};

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) =>
  (Array.isArray(v) ? v[0] : v)?.trim() || undefined;

/** The URL's query params as a search; malformed values are dropped, `locale` is the default. */
export function fromParams(params: Params, locale: Locale): SearchState {
  const page = Number(first(params.page));
  return {
    q: first(params.q)?.slice(0, 80) ?? '',
    game: GameSchema.safeParse(first(params.game)).data,
    set: first(params.set)?.toLowerCase().slice(0, 32),
    rarity: first(params.rarity)?.slice(0, 32),
    lang: LocaleSchema.safeParse(first(params.lang)).data ?? locale,
    finish: first(params.finish)?.slice(0, 32),
    page: Number.isInteger(page) && page > 1 ? page : 1,
  };
}

/**
 * The search as URL params. Every key is present, the defaults (the user's language, page 1, an
 * unset filter) as undefined, so `router.setParams` removes them from the URL.
 */
export function toParams(state: SearchState, locale: Locale): Record<string, string | undefined> {
  return {
    q: state.q || undefined,
    game: state.game,
    set: state.set,
    rarity: state.rarity,
    lang: state.lang === locale ? undefined : state.lang,
    finish: state.finish,
    page: state.page > 1 ? String(state.page) : undefined,
  };
}

/**
 * A changed search: a new game clears the set, rarity and finish (they belong to a game), and any
 * change but the page goes back to page 1.
 */
export function updateSearch(state: SearchState, patch: Partial<SearchState>): SearchState {
  const gameChanged = 'game' in patch && patch.game !== state.game;
  return {
    ...state,
    ...(gameChanged && { set: undefined, rarity: undefined, finish: undefined }),
    ...patch,
    page: patch.page ?? 1,
  };
}

/** The search is sent from two characters on (the API's minimum). */
export const searchable = (q: string) => q.trim().length >= 2;

export function useSearch(state: SearchState) {
  const query = {
    ...(Object.fromEntries(Object.entries(state).filter(([, v]) => v !== undefined)) as Record<
      string,
      string
    >),
    q: state.q,
    page: String(state.page),
  };
  return useQuery({
    queryKey: ['catalog', 'search', query],
    queryFn: () => read(api.catalog.search.$get({ query })),
    enabled: searchable(state.q),
    // The previous page stays on screen while the next one loads.
    placeholderData: keepPreviousData,
    staleTime: 5 * 60_000,
  });
}
