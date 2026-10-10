import type {
  CollectionCondition,
  Condition,
  Currency,
  EntryPrice,
  ValueGroup,
  ValueTotal,
} from '@voidbinder/shared/api';
import {
  conditionEstimate,
  DEFAULT_CONDITION_FACTORS,
  pickDisplayPrice,
  type PriceLike,
} from '../prices/index.js';

// The value of a collection or wish list (VB-31): pure, rows and prices in, sums out. Prices are
// never converted between currencies, so every sum is per source and currency.

/**
 * Mint is above near mint; `condition_multipliers` has no MT row (VB-30), so its factor lives
 * here. An estimate like every factor but NM's.
 */
export const MINT_FACTOR = 1.05;

/** A condition's share of the near-mint price: the game's factors, else the defaults. */
export function conditionFactor(
  condition: CollectionCondition,
  factors: readonly { condition: Condition; factor: number }[] = [],
): number {
  if (condition === 'MT') return MINT_FACTOR;
  return (
    factors.find((f) => f.condition === condition)?.factor ??
    DEFAULT_CONDITION_FACTORS.find((f) => f.condition === condition)?.factor ??
    1
  );
}

/**
 * The price of one copy: the display price of the entry's finish (core's `pickDisplayPrice`:
 * the entry's finish, then the print's listed finish, its other finishes, then unlisted finishes
 * alphabetically; the currency's preferred source) times the
 * condition factor. null when the print has no price.
 */
export function priceEntry(
  prices: readonly (PriceLike & { observedAt: string })[],
  opts: {
    currency: Currency;
    finish?: string | null | undefined;
    finishes?: readonly string[];
    condition: CollectionCondition;
    factors?: readonly { condition: Condition; factor: number }[];
  },
): EntryPrice | null {
  const display = pickDisplayPrice(prices, {
    currency: opts.currency,
    finish: opts.finish ?? undefined,
    finishes: opts.finishes ?? [],
  });
  if (!display) return null;
  const observedAt =
    prices.find(
      (p) =>
        p.source === display.source &&
        p.finish === display.finish &&
        p.currency === display.currency,
    )?.observedAt ?? '';
  const factor = conditionFactor(opts.condition, opts.factors);
  return {
    source: display.source,
    finish: display.finish,
    currency: display.currency,
    marketCents: display.cents,
    factor,
    unitCents: conditionEstimate(display.cents, factor),
    observedAt,
  };
}

export interface ValuedItem {
  quantity: number;
  price: EntryPrice | null;
}

/**
 * Sum of quantity × unit price per source and currency, with the oldest observation in each sum
 * (the "as of" a user reads), the copies and the copies without a price.
 */
export function valueOf(items: readonly ValuedItem[]): ValueGroup {
  const totals = new Map<string, ValueTotal>();
  let cards = 0;
  let unpriced = 0;
  for (const { quantity, price } of items) {
    cards += quantity;
    if (!price) {
      unpriced += quantity;
      continue;
    }
    const key = `${price.source}:${price.currency}`;
    const total = totals.get(key);
    if (!total) {
      totals.set(key, {
        source: price.source,
        currency: price.currency,
        cents: price.unitCents * quantity,
        observedAt: price.observedAt,
      });
    } else {
      total.cents += price.unitCents * quantity;
      if (price.observedAt < total.observedAt) total.observedAt = price.observedAt;
    }
  }
  return {
    cards,
    entries: items.length,
    totals: [...totals.values()].sort((a, b) => b.cents - a.cents),
    unpriced,
  };
}

/** `valueOf` per key (game, binder, …), in the order the keys first appear. */
export function valueBy<T extends ValuedItem, K>(
  items: readonly T[],
  key: (item: T) => K,
): { key: K; value: ValueGroup }[] {
  const groups = new Map<K, T[]>();
  for (const item of items) {
    const k = key(item);
    const group = groups.get(k);
    if (group) group.push(item);
    else groups.set(k, [item]);
  }
  return [...groups].map(([k, group]) => ({ key: k, value: valueOf(group) }));
}

/** A wish is in budget when its current unit price is at or under the wish price, same currency. */
export function inBudget(wish: {
  maxPriceCents: number | null;
  currency: Currency | null;
  price: EntryPrice | null;
}): boolean | null {
  if (wish.maxPriceCents === null || !wish.price) return null;
  if (wish.currency !== null && wish.currency !== wish.price.currency) return null;
  return wish.price.unitCents <= wish.maxPriceCents;
}
