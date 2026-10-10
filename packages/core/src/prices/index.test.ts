import { describe, expect, it } from 'vitest';
import {
  collectionValue,
  conditionEstimate,
  downsampleHistory,
  pickDisplayPrice,
  type PriceLike,
} from './index.js';
import type { PriceSource } from '@voidbinder/shared/api';

const prices: PriceLike[] = [
  {
    source: 'tcgplayer',
    finish: 'normal',
    lang: 'en',
    currency: 'USD',
    market: 120,
    observedAt: '2026-10-10T03:00:00.000Z',
  },
  {
    source: 'cardmarket',
    finish: 'normal',
    lang: 'en',
    currency: 'EUR',
    market: 95,
    observedAt: '2026-10-10T03:00:00.000Z',
  },
  {
    source: 'tcgplayer_scryfall',
    finish: 'normal',
    lang: 'en',
    currency: 'USD',
    market: 118,
    observedAt: '2026-10-10T03:00:00.000Z',
  },
  {
    source: 'cardmarket',
    finish: 'foil',
    lang: 'en',
    currency: 'EUR',
    market: 400,
    observedAt: '2026-10-10T03:00:00.000Z',
  },
  {
    source: 'tcgplayer',
    finish: 'foil',
    lang: 'en',
    currency: 'USD',
    market: 450,
    observedAt: '2026-10-10T03:00:00.000Z',
  },
];

describe('pickDisplayPrice', () => {
  it('prefers the source of the user’s currency, in its own currency', () => {
    expect(pickDisplayPrice(prices, { currency: 'EUR', lang: 'en' })).toEqual({
      source: 'cardmarket',
      finish: 'normal',
      lang: 'en',
      currency: 'EUR',
      cents: 95,
      observedAt: '2026-10-10T03:00:00.000Z',
    });
    expect(pickDisplayPrice(prices, { currency: 'USD', lang: 'en' })?.source).toBe('tcgplayer');
  });

  it('falls back to another currency when the preferred source has no price', () => {
    const usdOnly = prices.filter((p) => p.currency === 'USD');
    expect(pickDisplayPrice(usdOnly, { currency: 'EUR', lang: 'en' })).toMatchObject({
      source: 'tcgplayer',
      currency: 'USD',
    });
  });

  it('picks the finish before the source: asked finish, normal, the print’s finishes', () => {
    expect(pickDisplayPrice(prices, { currency: 'USD', lang: 'en', finish: 'foil' })?.cents).toBe(
      450,
    );
    const holoOnly: PriceLike[] = [
      {
        source: 'tcgplayer',
        finish: 'reverse',
        lang: 'en',
        currency: 'USD',
        market: 30,
        observedAt: '2026-10-10T03:00:00.000Z',
      },
      {
        source: 'tcgplayer',
        finish: 'holo',
        lang: 'en',
        currency: 'USD',
        market: 80,
        observedAt: '2026-10-10T03:00:00.000Z',
      },
    ];
    expect(
      pickDisplayPrice(holoOnly, { currency: 'EUR', lang: 'en', finishes: ['holo', 'reverse'] })
        ?.finish,
    ).toBe('holo');
    expect(
      pickDisplayPrice(holoOnly, { currency: 'EUR', lang: 'en', finish: 'etched' })?.finish,
    ).toBe('holo');
    expect(pickDisplayPrice([], { currency: 'EUR', lang: 'en' })).toBeNull();
  });

  it('prefers the language shown, then English, then any, before the source', () => {
    const row = (source: PriceSource, lang: string, market: number, finish = 'normal') => ({
      source,
      finish,
      lang,
      currency: source === 'cardmarket' ? ('EUR' as const) : ('USD' as const),
      market,
      observedAt: '2026-10-10T03:00:00.000Z',
    });
    const rows = [
      row('cardmarket', 'en', 95),
      row('cardmarket', 'de', 140),
      row('tcgplayer', 'en', 120),
      row('cardmarket', 'ja', 300),
      row('cardmarket', 'de', 500, 'foil'),
    ];
    expect(pickDisplayPrice(rows, { currency: 'EUR', lang: 'de' })).toMatchObject({
      lang: 'de',
      cents: 140,
    });
    // A German copy's price wins over the currency's source in English.
    expect(pickDisplayPrice(rows, { currency: 'USD', lang: 'de' })).toMatchObject({
      source: 'cardmarket',
      lang: 'de',
    });
    expect(pickDisplayPrice(rows, { currency: 'USD', lang: 'fr' })).toMatchObject({
      source: 'tcgplayer',
      lang: 'en',
    });
    // Neither the language nor English: any, by source, then by language code.
    const others = rows.filter((r) => r.lang !== 'en');
    expect(pickDisplayPrice(others, { currency: 'EUR', lang: 'fr' })).toMatchObject({ lang: 'de' });
    // The finish comes first: a foil asked for is the German foil, whatever the language shown.
    expect(pickDisplayPrice(rows, { currency: 'EUR', lang: 'en', finish: 'foil' })).toMatchObject({
      lang: 'de',
      cents: 500,
    });
  });

  it('follows the API finishRank: listed finish, then unlisted ones alphabetically', () => {
    const row = (source: PriceSource, finish: string): PriceLike => ({
      source,
      finish,
      lang: 'en',
      currency: 'EUR',
      market: 10,
      observedAt: '2026-10-10T03:00:00.000Z',
    });
    // print lists only holo: holo beats the cheaper-by-source normal row
    const holoAndNormal = [row('cardmarket', 'normal'), row('tcgplayer', 'holo')];
    expect(
      pickDisplayPrice(holoAndNormal, { currency: 'EUR', lang: 'en', finishes: ['holo'] })?.finish,
    ).toBe('holo');
    // only unlisted finishes: alphabetical (first_edition < reverse), not the source's pick
    const unlisted = [row('cardmarket', 'reverse'), row('tcgplayer', 'first_edition')];
    expect(
      pickDisplayPrice(unlisted, { currency: 'EUR', lang: 'en', finishes: ['normal'] })?.finish,
    ).toBe('first_edition');
  });
});

describe('conditionEstimate', () => {
  it('rounds the factor of the near-mint cents to whole cents', () => {
    expect(conditionEstimate(1000, 0.85)).toBe(850);
    expect(conditionEstimate(95, 0.45)).toBe(43);
    expect(conditionEstimate(95, 1)).toBe(95);
  });
});

describe('collectionValue', () => {
  it('sums per currency and counts unpriced copies', () => {
    expect(
      collectionValue([
        { quantity: 2, price: { cents: 150, currency: 'EUR' } },
        { quantity: 1, price: { cents: 99, currency: 'USD' } },
        { quantity: 3, price: null },
        { quantity: 1, price: { cents: 50, currency: 'EUR' } },
      ]),
    ).toEqual({ totals: { EUR: 350, USD: 99 }, unpriced: 3 });
  });
});

describe('downsampleHistory', () => {
  const days = (from: string, n: number) =>
    Array.from({ length: n }, (_, i) => ({
      date: new Date(Date.parse(`${from}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10),
      cents: i,
    }));

  it('keeps every day of the last 180 days', () => {
    const points = days('2026-06-01', 100);
    expect(downsampleHistory(points, '2026-10-10')).toEqual(points);
  });

  it('keeps the last point of each ISO week before that', () => {
    // 2025-12-29 is a Monday; 4 weeks of daily points, all older than 180 days.
    const points = days('2025-12-29', 28);
    expect(downsampleHistory(points, '2026-10-10').map((p) => p.date)).toEqual([
      '2026-01-04',
      '2026-01-11',
      '2026-01-18',
      '2026-01-25',
    ]);
  });

  it('switches to daily points at the cutoff', () => {
    // today - 180 days = 2026-04-13 (a Monday)
    const out = downsampleHistory(days('2026-04-06', 10), '2026-10-10');
    expect(out.map((p) => p.date)).toEqual([
      '2026-04-12',
      '2026-04-13',
      '2026-04-14',
      '2026-04-15',
    ]);
  });
});
