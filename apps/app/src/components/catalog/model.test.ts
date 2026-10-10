import type { SetSummary } from '@voidbinder/shared/api';
import { describe, expect, it } from 'vitest';
import {
  change,
  completion,
  finishTotals,
  formatDate,
  groupSets,
  pageCount,
  pageWindow,
  parseFilters,
  setValue,
  toParams,
  toQuery,
  type Owned,
  type SetFilters,
} from './model';
import type { PriceTag } from './seams';

const base: SetFilters = { lang: 'de', sort: 'number', page: 1, view: 'grid' };

describe('set filters in the URL', () => {
  it('reads defaults from an empty query', () => {
    expect(parseFilters({}, 'de')).toEqual(base);
  });

  it('reads every filter and ignores values it does not know', () => {
    expect(
      parseFilters(
        { lang: 'en', rarity: 'rare', finish: 'foil', sort: 'name', page: '3', view: 'list' },
        'de',
      ),
    ).toEqual({ lang: 'en', rarity: 'rare', finish: 'foil', sort: 'name', page: 3, view: 'list' });
    expect(
      parseFilters({ lang: 'EN!', sort: 'popularity', page: '0', view: 'cloud', rarity: '' }, 'de'),
    ).toEqual(base);
    // The price sort is the API's `sort=price`, high to low.
    expect(parseFilters({ sort: 'price' }, 'de').sort).toBe('price');
    expect(toQuery({ ...base, sort: 'price' })).toMatchObject({ sort: 'price' });
    expect(parseFilters({ page: '2.5' }, 'de').page).toBe(1);
    expect(parseFilters({ page: ['4', '5'], sort: ['rarity'] }, 'de')).toMatchObject({
      page: 4,
      sort: 'rarity',
    });
  });

  it('writes only what differs from the defaults, and reads it back', () => {
    expect(toParams(base, 'de')).toEqual({});
    const all: SetFilters = {
      lang: 'en',
      rarity: 'mythic',
      finish: 'foil',
      sort: 'rarity',
      page: 2,
      view: 'list',
    };
    expect(toParams(all, 'de')).toEqual({
      lang: 'en',
      rarity: 'mythic',
      finish: 'foil',
      sort: 'rarity',
      page: '2',
      view: 'list',
    });
    expect(parseFilters(toParams(all, 'de'), 'de')).toEqual(all);
  });
});

describe('the API query', () => {
  it('carries the filters the route takes and leaves the view out', () => {
    expect(toQuery({ ...base, rarity: 'rare', page: 2, view: 'list' })).toEqual({
      lang: 'de',
      sort: 'number',
      page: 2,
      rarity: 'rare',
    });
    expect(toQuery(base)).toEqual({ lang: 'de', sort: 'number', page: 1 });
  });
});

describe('filter reducer', () => {
  it('goes back to page 1 when a filter or the sort changes', () => {
    const on3 = { ...base, page: 3 };
    expect(change(on3, { rarity: 'rare' })).toEqual({ ...base, rarity: 'rare' });
    expect(change(on3, { sort: 'name' }).page).toBe(1);
    expect(change(on3, { lang: 'en' }).page).toBe(1);
    expect(change({ ...on3, finish: 'foil' }, { finish: undefined })).toEqual(base);
  });

  it('keeps the page for a page change, a view change or a no-op', () => {
    const on3 = { ...base, page: 3 };
    expect(change(on3, { page: 4 }).page).toBe(4);
    expect(change(on3, { view: 'list' }).page).toBe(3);
    expect(change(on3, { sort: 'number' }).page).toBe(3);
  });

  it('clears a filter with undefined', () => {
    const next = change({ ...base, rarity: 'rare' }, { rarity: undefined });
    expect('rarity' in next).toBe(false);
  });
});

describe('pagination', () => {
  it('counts pages, at least one', () => {
    expect(pageCount(0, 60)).toBe(1);
    expect(pageCount(60, 60)).toBe(1);
    expect(pageCount(391, 60)).toBe(7);
  });

  it('shows the ends and two pages around the current one, with gaps', () => {
    expect(pageWindow(1, 3)).toEqual([1, 2, 3]);
    expect(pageWindow(1, 7)).toEqual([1, 2, 3, 'gap', 7]);
    expect(pageWindow(5, 12)).toEqual([1, 'gap', 3, 4, 5, 6, 7, 'gap', 12]);
    expect(pageWindow(12, 12)).toEqual([1, 'gap', 10, 11, 12]);
  });
});

describe('completion', () => {
  const owned: Owned = new Map([
    ['a', { count: 3, byFinish: { normal: 2, foil: 1 } }],
    ['b', { count: 1, byFinish: { foil: 1 } }],
    ['c', { count: 0, byFinish: {} }],
  ]);

  it('is the distinct prints owned over the set size', () => {
    expect(completion(owned, 8)).toEqual({ owned: 2, ratio: 0.25 });
  });

  it('is 0 for an empty collection or an unknown set size, and never above 1', () => {
    expect(completion(new Map(), 8)).toEqual({ owned: 0, ratio: 0 });
    expect(completion(owned, null).ratio).toBe(0);
    expect(completion(owned, 0).ratio).toBe(0);
    expect(completion(owned, 1).ratio).toBe(1);
  });

  it('adds the copies per finish', () => {
    expect(finishTotals(owned)).toEqual({ normal: 2, foil: 2 });
  });
});

describe('set value', () => {
  const price = (cents: number, extra: Partial<PriceTag> = {}): PriceTag => ({
    cents,
    currency: 'EUR',
    source: 'Cardmarket',
    asOf: '2026-10-09',
    ...extra,
  });

  it('is null without prices', () => {
    expect(setValue(new Map(), new Map())).toBeNull();
  });

  it('sums owned copies and missing prints, from one source and currency', () => {
    const owned: Owned = new Map([['a', { count: 2, byFinish: {} }]]);
    const prices = new Map([
      ['a', price(150)],
      ['b', price(400, { asOf: '2026-10-10' })],
      ['c', price(25)],
      ['d', price(999, { currency: 'USD' })],
    ]);
    expect(setValue(owned, prices)).toEqual({
      ownedCents: 300,
      ownedCount: 2,
      missingCents: 425,
      missingCount: 2,
      currency: 'EUR',
      source: 'Cardmarket',
      asOf: '2026-10-10',
    });
  });
});

describe('set list', () => {
  const set = (
    code: string,
    name: string,
    releasedOn: string | null,
    cardCount = 10,
  ): SetSummary => ({
    code,
    name,
    localizedName: null,
    releasedOn,
    cardCount,
    kind: null,
  });
  const sets = [
    set('old', 'Alpha', '2020-01-01', 5),
    set('new', 'Zeta', '2026-05-01', 50),
    set('mid', 'Mu', '2026-02-01', 20),
    set('und', 'Nameless', null),
  ];

  it('groups newest first by release year, undated last', () => {
    const groups = groupSets(sets, '', 'newest');
    expect(groups.map((g) => g.year)).toEqual(['2026', '2020', '']);
    expect(groups[0]?.sets.map((s) => s.code)).toEqual(['new', 'mid']);
  });

  it('sorts flat by name, code or card count', () => {
    expect(groupSets(sets, '', 'name')[0]?.sets.map((s) => s.code)).toEqual([
      'old',
      'mid',
      'und',
      'new',
    ]);
    expect(groupSets(sets, '', 'code')[0]?.sets.map((s) => s.code)).toEqual([
      'mid',
      'new',
      'old',
      'und',
    ]);
    expect(groupSets(sets, '', 'cards')[0]?.sets.map((s) => s.code)).toEqual([
      'new',
      'mid',
      'und',
      'old',
    ]);
    expect(groupSets(sets, '', 'name')[0]?.year).toBeNull();
  });

  it('filters by code or by name, in either language', () => {
    expect(groupSets(sets, ' MID ', 'newest').flatMap((g) => g.sets.map((s) => s.code))).toEqual([
      'mid',
    ]);
    const de = [{ ...set('x', 'Sunset', '2026-01-01'), localizedName: 'Abendrot' }];
    expect(groupSets(de, 'abend', 'newest')).toHaveLength(1);
    expect(groupSets(de, 'sunset', 'newest')).toHaveLength(1);
    expect(groupSets(sets, 'nope', 'newest')).toEqual([]);
    expect(groupSets(sets, 'nope', 'name')).toEqual([]);
  });
});

describe('formatDate', () => {
  it('writes the date the way the language does, without a timezone shift', () => {
    expect(formatDate('2026-03-14', 'de')).toBe('14.03.2026');
    expect(formatDate('2026-03-14', 'en')).toBe('03/14/2026');
    expect(formatDate('2026-01-01', 'de')).toBe('01.01.2026');
  });
});
