import type { Game } from '@voidbinder/shared';
import type { DisplayPrice, PrintSummary } from '@voidbinder/shared/api';
import { useMemo } from 'react';
import { SOURCE_NAME } from '../../api/queries/cards';
import { useOwnedInSet } from '../../api/queries/collection';
import { useSession } from '../../api/queries/me';
import type { Owned } from './model';

// What the set page shows of the collection (VB-31) and of the prices (VB-64).

/** A print's price: integer minor units, the source and, once the API sends it, the day it was taken. */
export interface PriceTag {
  cents: number;
  currency: 'EUR' | 'USD';
  /** Display name of the source (`SOURCE_NAME`). */
  source: string;
  /** ISO date of the quote. `marketPrice` carries none yet, so the set page shows the source only. */
  asOf?: string | undefined;
}

/** A set page or search `marketPrice` as a tag; undefined for a print without a price. */
export function priceTag(price: DisplayPrice | null | undefined): PriceTag | undefined {
  return price
    ? { cents: price.cents, currency: price.currency, source: SOURCE_NAME[price.source] }
    : undefined;
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

/**
 * The market price per print id of the set page's prints (`marketPrice` of the response, in the
 * profile's currency, EUR when signed out). It covers the page on screen, not the whole set:
 * a set value needs every print's price, which no route sends yet.
 */
export function useSetPrices(
  prints: readonly Pick<PrintSummary, 'id' | 'marketPrice'>[] | undefined,
): ReadonlyMap<string, PriceTag> | undefined {
  return useMemo(() => {
    const entries = (prints ?? []).flatMap((p) => {
      const tag = priceTag(p.marketPrice);
      return tag ? [[p.id, tag] as const] : [];
    });
    return entries.length ? new Map(entries) : undefined;
  }, [prints]);
}

export function formatPrice(price: PriceTag, locale: string): string {
  return (price.cents / 100).toLocaleString(locale, {
    style: 'currency',
    currency: price.currency,
  });
}
