import type { Game } from '@voidbinder/shared';
import { useMemo } from 'react';
import { useOwnedInSet } from '../../api/queries/collection';
import { useSession } from '../../api/queries/me';
import type { Owned } from './model';

// What the set page shows from the collection (VB-31) and the prices (VB-30). The prices hook
// still answers "nothing": the set page's `marketPrice` carries no observation date, and a price
// is never shown without one.

/** A print's price: integer minor units, the source and the day it was taken (no fake numbers). */
export interface PriceTag {
  cents: number;
  currency: 'EUR' | 'USD';
  source: string;
  /** ISO date of the quote. */
  asOf: string;
}

/** The signed-in user's copies per print id in a set; undefined while signed out or unavailable. */
export function useOwnedPrints(game: Game, code: string): Owned | undefined {
  const { data: me } = useSession();
  const { data } = useOwnedInSet(game, code, !!me);
  return useMemo(
    () =>
      me && data
        ? new Map(
            Object.entries(data.owned).map(([id, count]) => [
              id,
              { count, byFinish: data.byFinish[id] ?? {} },
            ]),
          )
        : undefined,
    [me, data],
  );
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
