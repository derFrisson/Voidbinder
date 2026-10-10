import type { Locale } from '@voidbinder/shared';
import type { SetPageQuery, SetSummary } from '@voidbinder/shared/api';
import type { PriceTag } from './seams';

// The pure logic of the catalog screens: URL state, filter reducers, completion, set grouping.

export const SORTS = ['number', 'name', 'rarity', 'price'] as const;
export type SetSort = (typeof SORTS)[number];
export const VIEWS = ['grid', 'list'] as const;
export type SetView = (typeof VIEWS)[number];

/** The set page's filter state; it lives in the URL (`?rarity=rare&page=2`), defaults left out. */
export interface SetFilters {
  lang: string;
  rarity?: string;
  finish?: string;
  sort: SetSort;
  page: number;
  view: SetView;
}

type Params = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
const one = (v: string | string[] | undefined) => {
  const s = first(v);
  return s ? s : undefined;
};

/** The filters in a URL's query, each value checked: an unknown value falls back to its default. */
export function parseFilters(params: Params, defaultLang: string): SetFilters {
  const lang = one(params.lang);
  const sort = first(params.sort);
  const page = Number(first(params.page));
  const view = first(params.view);
  const rarity = one(params.rarity);
  const finish = one(params.finish);
  return {
    lang: lang && /^[a-z]{2,3}$/.test(lang) ? lang : defaultLang,
    ...(rarity ? { rarity } : {}),
    ...(finish ? { finish } : {}),
    sort: SORTS.find((s) => s === sort) ?? 'number',
    page: Number.isInteger(page) && page >= 1 && page <= 10_000 ? page : 1,
    view: VIEWS.find((v) => v === view) ?? 'grid',
  };
}

/** The URL's query for `filters`: only what differs from the defaults. */
export function toParams(filters: SetFilters, defaultLang: string): Record<string, string> {
  return {
    ...(filters.lang !== defaultLang ? { lang: filters.lang } : {}),
    ...(filters.rarity ? { rarity: filters.rarity } : {}),
    ...(filters.finish ? { finish: filters.finish } : {}),
    ...(filters.sort !== 'number' ? { sort: filters.sort } : {}),
    ...(filters.page > 1 ? { page: String(filters.page) } : {}),
    ...(filters.view !== 'grid' ? { view: filters.view } : {}),
  };
}

/** The API's query (`GET /catalog/sets/:game/:code`): the view is the app's own. */
export function toQuery(filters: SetFilters): Partial<SetPageQuery> {
  const { lang, rarity, finish, sort, page } = filters;
  return { lang, sort, page, ...(rarity ? { rarity } : {}), ...(finish ? { finish } : {}) };
}

/**
 * The next filters after a change. Any change but the page (and the view, which does not alter
 * what the API returns) goes back to page 1: page 4 of one filter is not page 4 of another.
 */
export function change(
  filters: SetFilters,
  patch: Partial<{ [K in keyof SetFilters]: SetFilters[K] | undefined }>,
): SetFilters {
  const { rarity, finish, ...rest } = { ...filters, ...patch };
  const next = {
    ...(rest as Omit<SetFilters, 'rarity' | 'finish'>),
    ...(rarity ? { rarity } : {}),
    ...(finish ? { finish } : {}),
  };
  const refilters = (['lang', 'rarity', 'finish', 'sort'] as const).some(
    (k) => k in patch && patch[k] !== filters[k],
  );
  return refilters && !('page' in patch) ? { ...next, page: 1 } : next;
}

export function pageCount(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/** Pages to show in the pagination: first, last, and two either side of the current one. */
export function pageWindow(page: number, pages: number): (number | 'gap')[] {
  const keep = new Set([1, pages, page - 2, page - 1, page, page + 1, page + 2]);
  const shown = [...keep].filter((p) => p >= 1 && p <= pages).sort((a, b) => a - b);
  return shown.flatMap((p, i) =>
    i > 0 && p - (shown[i - 1] ?? p) > 1 ? ['gap' as const, p] : [p],
  );
}

/** What the signed-in user owns of one print: copies and the split by finish. */
export interface OwnedPrint {
  count: number;
  byFinish: Record<string, number>;
}
export type Owned = ReadonlyMap<string, OwnedPrint>;

/** Share of a set owned, 0 to 1 (distinct prints owned over the set's card count). */
export function completion(owned: Owned, cards: number | null): { owned: number; ratio: number } {
  const have = [...owned.values()].filter((o) => o.count > 0).length;
  return { owned: have, ratio: cards && cards > 0 ? Math.min(1, have / cards) : 0 };
}

/** Copies owned per finish across the whole set, for the header line. */
export function finishTotals(owned: Owned): Record<string, number> {
  const totals: Record<string, number> = {};
  for (const o of owned.values())
    for (const [finish, n] of Object.entries(o.byFinish))
      totals[finish] = (totals[finish] ?? 0) + n;
  return totals;
}

export const SET_SORTS = ['newest', 'name', 'code', 'cards'] as const;
export type SetListSort = (typeof SET_SORTS)[number];

export interface SetGroup {
  /** The release year, '' for sets without a date, null for a flat list (no heading). */
  year: string | null;
  sets: SetSummary[];
}

/** The sets matching `text` (code or name), sorted, grouped by release year (newest first). */
export function groupSets(sets: SetSummary[], text: string, sort: SetListSort): SetGroup[] {
  const q = text.trim().toLowerCase();
  const label = (s: SetSummary) => s.localizedName ?? s.name;
  const hits = sets.filter(
    (s) =>
      !q ||
      s.code.toLowerCase().includes(q) ||
      s.name.toLowerCase().includes(q) ||
      label(s).toLowerCase().includes(q),
  );
  const by: Record<SetListSort, (a: SetSummary, b: SetSummary) => number> = {
    newest: (a, b) =>
      (b.releasedOn ?? '').localeCompare(a.releasedOn ?? '') || a.code.localeCompare(b.code),
    name: (a, b) => label(a).localeCompare(label(b)),
    code: (a, b) => a.code.localeCompare(b.code),
    cards: (a, b) => (b.cardCount ?? 0) - (a.cardCount ?? 0) || a.code.localeCompare(b.code),
  };
  hits.sort(by[sort]);
  // Only the date order is a timeline; the other sorts are one flat list.
  if (sort !== 'newest') return hits.length ? [{ year: null, sets: hits }] : [];
  const groups: SetGroup[] = [];
  for (const s of hits) {
    const year = s.releasedOn?.slice(0, 4) ?? '';
    const last = groups.at(-1);
    if (last?.year === year) last.sets.push(s);
    else groups.push({ year, sets: [s] });
  }
  return groups;
}

/** `2026-03-14` as the locale writes a date (14.03.2026 in German), in UTC so no timezone shifts it. */
export function formatDate(iso: string, locale: Locale): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

/** Owned and missing value of a set from the whole set's prices; null without prices. */
export function setValue(
  owned: Owned,
  prices: ReadonlyMap<string, PriceTag>,
): {
  ownedCents: number;
  missingCents: number;
  ownedCount: number;
  missingCount: number;
  currency: PriceTag['currency'];
  source: string;
  asOf: string | undefined;
} | null {
  const first = prices.values().next().value;
  if (!first) return null;
  let ownedCents = 0;
  let missingCents = 0;
  let ownedCount = 0;
  let missingCount = 0;
  let asOf = first.asOf;
  for (const [id, price] of prices) {
    // One currency per strip: a quote in another currency is not added to the sum.
    if (price.currency !== first.currency) continue;
    if (price.asOf && (!asOf || price.asOf > asOf)) asOf = price.asOf;
    const have = owned.get(id)?.count ?? 0;
    if (have > 0) {
      ownedCents += price.cents * have;
      ownedCount += have;
    } else {
      missingCents += price.cents;
      missingCount += 1;
    }
  }
  return {
    ownedCents,
    missingCents,
    ownedCount,
    missingCount,
    currency: first.currency,
    source: first.source,
    asOf,
  };
}
