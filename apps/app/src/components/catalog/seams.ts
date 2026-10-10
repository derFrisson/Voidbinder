import type { Owned } from './model';

// What the set page shows once the collection (VB-31) and the prices (VB-30) exist. Their API
// routes are not there yet, so both hooks answer "nothing" and the screens leave the signed-in
// and price parts out. Filling in a hook (it will take the game and set code) is the only change
// those tickets need here.

/** A print's price: integer minor units, the source and the day it was taken (no fake numbers). */
export interface PriceTag {
  cents: number;
  currency: 'EUR' | 'USD';
  source: string;
  /** ISO date of the quote. */
  asOf: string;
}

/** The signed-in user's copies per print id in a set; undefined while signed out or unavailable. */
export function useOwnedPrints(): Owned | undefined {
  return undefined;
}

/** The latest price per print id of a set; undefined while the price routes are absent. */
export function useSetPrices(): ReadonlyMap<string, PriceTag> | undefined {
  return undefined;
}

export function formatPrice(price: PriceTag, locale: string): string {
  return (price.cents / 100).toLocaleString(locale, {
    style: 'currency',
    currency: price.currency,
  });
}
