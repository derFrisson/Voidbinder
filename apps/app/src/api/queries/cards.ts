// Prices of a print on the card page (VB-35). The card itself comes from `useCard` (./catalog).
//
// VB-30: the price routes `GET /catalog/prints/:id/prices` and `…/prices/history?days=` are not
// merged yet. The types below follow their planned shape (VB-30's `PrintPricesResponse` and
// `PriceHistoryResponse`, amounts in cents); once they merge, import those from
// `@voidbinder/shared/api` and turn the two hooks into queries on the typed client
// (`api.catalog.prints[':id'].prices.$get`). Until then no print has a price: the hooks answer
// null and the card page says so, it never shows a made-up number.

import type { Locale } from '@voidbinder/shared';

export type PriceSource = 'cardmarket' | 'tcgplayer' | 'tcgplayer_scryfall';

export type Price = {
  source: PriceSource;
  lang: Locale;
  finish: string;
  currency: 'EUR' | 'USD';
  /** Cardmarket's trend, TCGplayer's market price. */
  market: number;
  low: number | null;
  observedAt: string;
};

export type PrintPrices = {
  prices: Price[];
  /** The near-mint price per condition, in `currency`; EX and below are estimates. */
  conditions: { condition: 'NM' | 'EX' | 'GD'; cents: number }[];
  currency: 'EUR' | 'USD';
};

export type PricePoint = { date: string; cents: number };

/** The current prices of a print; null while there are none (VB-30). */
export function usePrintPrices(printId: string | undefined): PrintPrices | null {
  void printId;
  return null;
}

/** Cardmarket trend points of the last `days`, oldest first; null while there are none (VB-30). */
export function usePriceHistory(printId: string | undefined, days: number): PricePoint[] | null {
  void printId;
  void days;
  return null;
}
