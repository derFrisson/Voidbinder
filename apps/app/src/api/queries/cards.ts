import type {
  Currency,
  PriceSource,
  PricePoint,
  PrintPricesResponse,
} from '@voidbinder/shared/api';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api } from '../client';
import { ApiError, read, retry } from './http';
import { useSession } from './me';

// Prices of a print on the card page (VB-64). The card itself comes from `useCard` (./catalog).
// The routes are `GET /catalog/prints/:id/prices` and `…/prices/history?days=` (VB-30): amounts are
// integer cents in the source's own currency, never converted.

export type { PricePoint, PrintPricesResponse };
export type Price = PrintPricesResponse['prices'][number];

/** Where a source's prices come from, as the user knows it (TCGplayer via TCGCSV or Scryfall). */
export const SOURCE_NAME: Record<PriceSource, string> = {
  cardmarket: 'Cardmarket',
  tcgplayer: 'TCGplayer',
  tcgplayer_scryfall: 'TCGplayer',
};

/** The sources of a currency, most preferred first (the API's `SOURCE_PREFERENCE`). */
const PREFERRED: Record<Currency, PriceSource[]> = {
  EUR: ['cardmarket', 'tcgplayer', 'tcgplayer_scryfall'],
  USD: ['tcgplayer', 'tcgplayer_scryfall', 'cardmarket'],
};

/**
 * The profile's currency, EUR when signed out. `ready` is false until the session is known, so a
 * USD user's first read is not sent in EUR and then again in USD.
 */
export function useCurrency(): { currency: Currency; ready: boolean } {
  const session = useSession();
  return { currency: session.data?.currency ?? 'EUR', ready: !session.isPending };
}

const staleTime = 5 * 60_000;

export interface PrintPrices {
  /** Null while loading, for a print without any price row and for an unknown print (404). */
  prices: PrintPricesResponse | null;
  /** The read failed (a 5xx or the network, after the retries): not the same as "no prices yet". */
  failed: boolean;
  /** Asks again after a failure. */
  retry: () => void;
}

/**
 * The current prices of a print of a card shown in `lang` (each price in that language, else
 * `en`, else another; VB-103); `finish` picks the finish of the display price and the condition
 * estimates (the API's default, usually `normal`, without it).
 */
export function usePrintPrices(
  printId: string | undefined,
  lang: string,
  finish?: string,
): PrintPrices {
  const { currency, ready } = useCurrency();
  const query = useQuery({
    queryKey: ['catalog', 'prices', printId, currency, lang, finish],
    queryFn: () =>
      read(
        api.catalog.prints[':id'].prices.$get({
          param: { id: printId ?? '' },
          query: { currency, lang, ...(finish ? { finish } : {}) },
        }),
      ),
    enabled: !!printId && ready,
    staleTime,
    retry,
    // A finish change keeps the panel on screen until the new estimates arrive.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[2] === printId ? previous : undefined,
  });
  // A 4xx (an unknown print) does not get better by asking again and counts as "no prices".
  const failed = query.isError && !(query.error instanceof ApiError && query.error.status < 500);
  return {
    prices: query.data?.prices.length ? query.data : null,
    failed,
    retry: () => void query.refetch(),
  };
}

export type PriceSeries = {
  source: PriceSource;
  currency: Currency;
  points: PricePoint[];
};

/**
 * The daily market prices of the last `days`, oldest first: the series of `finish` from the
 * source the profile's currency prefers, per day in `lang` (else `en`). Null while loading, on
 * failure and without any series.
 */
export function usePriceHistory(
  printId: string | undefined,
  days: number,
  finish: string,
  lang: string,
): PriceSeries | null {
  const { currency } = useCurrency();
  const query = useQuery({
    queryKey: ['catalog', 'price-history', printId, days, lang],
    queryFn: () =>
      read(
        api.catalog.prints[':id'].prices.history.$get({
          param: { id: printId ?? '' },
          query: { days: String(days), lang },
        }),
      ),
    enabled: !!printId,
    staleTime,
    retry,
    placeholderData: keepPreviousData,
  });
  const ofFinish = query.data?.series.filter((s) => s.finish === finish) ?? [];
  const series = PREFERRED[currency]
    .map((source) => ofFinish.find((s) => s.source === source))
    .find((s) => s?.points.length);
  return series ?? null;
}
