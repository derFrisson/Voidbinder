import type { EntryPrice } from '@voidbinder/shared/api';
import { describe, expect, it } from 'vitest';
import { conditionFactor, inBudget, MINT_FACTOR, priceEntry, valueBy, valueOf } from './value.js';

const at = '2026-10-09T03:00:00.000Z';
const prices = [
  {
    source: 'cardmarket',
    finish: 'normal',
    lang: 'en',
    currency: 'EUR',
    market: 320,
    observedAt: at,
  },
  {
    source: 'cardmarket',
    finish: 'holo',
    lang: 'en',
    currency: 'EUR',
    market: 900,
    observedAt: at,
  },
  {
    source: 'tcgplayer',
    finish: 'normal',
    lang: 'en',
    currency: 'USD',
    market: 350,
    observedAt: at,
  },
] as const;

const price = (unitCents: number, extra: Partial<EntryPrice> = {}): EntryPrice => ({
  source: 'cardmarket',
  finish: 'normal',
  lang: 'en',
  currency: 'EUR',
  marketCents: unitCents,
  factor: 1,
  unitCents,
  observedAt: at,
  ...extra,
});

describe('conditionFactor', () => {
  it('uses the game’s factors, the defaults without them, and a fixed one for MT', () => {
    expect(conditionFactor('EX', [{ condition: 'EX', factor: 0.9 }])).toBe(0.9);
    expect(conditionFactor('EX')).toBe(0.85);
    expect(conditionFactor('PO')).toBe(0.3);
    expect(conditionFactor('NM')).toBe(1);
    expect(conditionFactor('MT', [{ condition: 'NM', factor: 1 }])).toBe(MINT_FACTOR);
  });
});

describe('priceEntry', () => {
  it('prices the entry’s finish from the preferred source, times the condition factor', () => {
    expect(
      priceEntry(prices, { currency: 'EUR', lang: 'en', finish: 'holo', condition: 'EX' }),
    ).toEqual({
      source: 'cardmarket',
      finish: 'holo',
      lang: 'en',
      currency: 'EUR',
      marketCents: 900,
      factor: 0.85,
      unitCents: 765,
      observedAt: at,
    });
  });

  it('takes the observation date from the price it picked, matched by currency too', () => {
    const old = '2026-10-01T03:00:00.000Z';
    const rows = [
      {
        source: 'tcgplayer',
        finish: 'normal',
        lang: 'en',
        currency: 'EUR',
        market: 300,
        observedAt: old,
      },
      {
        source: 'tcgplayer',
        finish: 'normal',
        lang: 'en',
        currency: 'USD',
        market: 350,
        observedAt: at,
      },
    ] as const;
    const picked = priceEntry(rows, { currency: 'USD', lang: 'en', condition: 'NM' });
    expect(picked?.observedAt).toBe(rows.find((r) => r.currency === picked?.currency)?.observedAt);
  });

  it('prices a copy in its language, else English', () => {
    const de = { ...prices[0], lang: 'de', market: 480 };
    expect(
      priceEntry([...prices, de], { currency: 'EUR', lang: 'de', condition: 'NM' }),
    ).toMatchObject({ lang: 'de', marketCents: 480 });
    expect(
      priceEntry([...prices, de], { currency: 'EUR', lang: 'fr', condition: 'NM' }),
    ).toMatchObject({ lang: 'en', marketCents: 320 });
  });

  it('falls back to normal for a finish without a price, and answers null without prices', () => {
    expect(
      priceEntry(prices, { currency: 'USD', lang: 'en', finish: 'reverse', condition: 'NM' }),
    ).toMatchObject({ source: 'tcgplayer', finish: 'normal', unitCents: 350 });
    expect(priceEntry([], { currency: 'EUR', lang: 'en', condition: 'NM' })).toBeNull();
  });
});

describe('valueOf', () => {
  it('sums quantity × unit price per source and currency, never converting', () => {
    const value = valueOf([
      { quantity: 2, price: price(320) },
      { quantity: 1, price: price(100, { observedAt: '2026-10-08T03:00:00.000Z' }) },
      { quantity: 3, price: price(50, { source: 'tcgplayer', currency: 'USD' }) },
      { quantity: 4, price: null },
    ]);
    expect(value).toEqual({
      cards: 10,
      entries: 4,
      unpriced: 4,
      totals: [
        // The oldest observation in a sum is its "as of".
        {
          source: 'cardmarket',
          currency: 'EUR',
          cents: 740,
          observedAt: '2026-10-08T03:00:00.000Z',
        },
        { source: 'tcgplayer', currency: 'USD', cents: 150, observedAt: at },
      ],
    });
  });

  it('groups per key', () => {
    const groups = valueBy(
      [
        { game: 'mtg', quantity: 1, price: price(100) },
        { game: 'pokemon', quantity: 2, price: price(10) },
        { game: 'mtg', quantity: 1, price: price(5) },
      ],
      (i) => i.game,
    );
    expect(groups.map((g) => [g.key, g.value.cards, g.value.totals[0]?.cents])).toEqual([
      ['mtg', 2, 105],
      ['pokemon', 2, 20],
    ]);
  });
});

describe('inBudget', () => {
  it('compares the unit price with the wish price in the same currency only', () => {
    expect(inBudget({ maxPriceCents: 1000, currency: 'EUR', price: price(990) })).toBe(true);
    expect(inBudget({ maxPriceCents: 1000, currency: 'EUR', price: price(1190) })).toBe(false);
    expect(inBudget({ maxPriceCents: 1000, currency: 'USD', price: price(990) })).toBeNull();
    expect(inBudget({ maxPriceCents: null, currency: null, price: price(990) })).toBeNull();
    expect(inBudget({ maxPriceCents: 1000, currency: null, price: null })).toBeNull();
  });
});
