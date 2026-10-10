import { describe, expect, it } from 'vitest';
import {
  collectionValue,
  conditionEstimate,
  downsampleHistory,
  pickDisplayPrice,
  type PriceLike,
} from './index.js';

const prices: PriceLike[] = [
  {
    source: 'tcgplayer',
    finish: 'normal',
    currency: 'USD',
    market: 120,
    observedAt: '2026-10-10T03:00:00.000Z',
  },
  {
    source: 'cardmarket',
    finish: 'normal',
    currency: 'EUR',
    market: 95,
    observedAt: '2026-10-10T03:00:00.000Z',
  },
  {
    source: 'tcgplayer_scryfall',
    finish: 'normal',
    currency: 'USD',
    market: 118,
    observedAt: '2026-10-10T03:00:00.000Z',
  },
  {
    source: 'cardmarket',
    finish: 'foil',
    currency: 'EUR',
    market: 400,
    observedAt: '2026-10-10T03:00:00.000Z',
  },
  {
    source: 'tcgplayer',
    finish: 'foil',
    currency: 'USD',
    market: 450,
    observedAt: '2026-10-10T03:00:00.000Z',
  },
];

describe('pickDisplayPrice', () => {
  it('prefers the source of the user’s currency, in its own currency', () => {
    expect(pickDisplayPrice(prices, { currency: 'EUR' })).toEqual({
      source: 'cardmarket',
      finish: 'normal',
      currency: 'EUR',
      cents: 95,
      observedAt: '2026-10-10T03:00:00.000Z',
    });
    expect(pickDisplayPrice(prices, { currency: 'USD' })?.source).toBe('tcgplayer');
  });

  it('falls back to another currency when the preferred source has no price', () => {
    const usdOnly = prices.filter((p) => p.currency === 'USD');
    expect(pickDisplayPrice(usdOnly, { currency: 'EUR' })).toMatchObject({
      source: 'tcgplayer',
      currency: 'USD',
    });
  });

  it('picks the finish before the source: asked finish, normal, the print’s finishes', () => {
    expect(pickDisplayPrice(prices, { currency: 'USD', finish: 'foil' })?.cents).toBe(450);
    const holoOnly: PriceLike[] = [
      {
        source: 'tcgplayer',
        finish: 'reverse',
        currency: 'USD',
        market: 30,
        observedAt: '2026-10-10T03:00:00.000Z',
      },
      {
        source: 'tcgplayer',
        finish: 'holo',
        currency: 'USD',
        market: 80,
        observedAt: '2026-10-10T03:00:00.000Z',
      },
    ];
    expect(
      pickDisplayPrice(holoOnly, { currency: 'EUR', finishes: ['holo', 'reverse'] })?.finish,
    ).toBe('holo');
    expect(pickDisplayPrice(holoOnly, { currency: 'EUR', finish: 'etched' })?.finish).toBe(
      'reverse',
    );
    expect(pickDisplayPrice([], { currency: 'EUR' })).toBeNull();
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
