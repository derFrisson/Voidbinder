import type { PriceHistoryResponse, PrintPricesResponse } from '@voidbinder/shared/api';

// The prices of Adeline, Resplendent Cathar (MID 1) as the dev API answered them on 2026-10-10
// (`GET /catalog/prints/:id/prices` and `…/prices/history`), trimmed to what the tests read.
export const PRINT = '59fab2d4-9883-4683-ad59-075a5bce6120';

const price = (
  source: PrintPricesResponse['prices'][number]['source'],
  sourceLabel: string,
  finish: string,
  currency: 'EUR' | 'USD',
  market: number,
  low: number | null,
  observedAt: string,
) => ({
  source,
  sourceLabel,
  finish,
  lang: 'en',
  currency,
  market,
  low,
  mid: null,
  high: null,
  observedAt,
});

export const printPrices: PrintPricesResponse = {
  printId: PRINT,
  prices: [
    price(
      'cardmarket',
      'Cardmarket (via Scryfall)',
      'foil',
      'EUR',
      523,
      null,
      '2026-10-10T03:44:08.135Z',
    ),
    price(
      'cardmarket',
      'Cardmarket (via Scryfall)',
      'normal',
      'EUR',
      334,
      null,
      '2026-10-10T03:44:08.135Z',
    ),
    price(
      'tcgplayer',
      'TCGplayer (via TCGCSV)',
      'foil',
      'USD',
      429,
      300,
      '2026-10-09T20:05:19.000Z',
    ),
    price(
      'tcgplayer',
      'TCGplayer (via TCGCSV)',
      'normal',
      'USD',
      402,
      250,
      '2026-10-09T20:05:19.000Z',
    ),
    price(
      'tcgplayer_scryfall',
      'TCGplayer (via Scryfall)',
      'normal',
      'USD',
      402,
      null,
      '2026-10-10T03:44:08.135Z',
    ),
  ],
  display: {
    source: 'cardmarket',
    finish: 'normal',
    lang: 'en',
    currency: 'EUR',
    cents: 334,
    observedAt: '2026-10-10T03:44:08.135Z',
  },
  conditions: [
    { condition: 'NM', factor: 1, cents: 334 },
    { condition: 'EX', factor: 0.85, cents: 284 },
    { condition: 'GD', factor: 0.7, cents: 234 },
    { condition: 'LP', factor: 0.6, cents: 200 },
  ],
  conditionsAreEstimates: true,
};

/** The same print without a price row: the API answers 200 with an empty list. */
export const noPrices: PrintPricesResponse = {
  printId: PRINT,
  prices: [],
  display: null,
  conditions: [],
  conditionsAreEstimates: true,
};

const points = (...cents: number[]) =>
  cents.map((c, i) => ({ date: `2026-10-0${i + 1}`, cents: c, lang: 'en' }));

export const history: PriceHistoryResponse = {
  printId: PRINT,
  days: 90,
  series: [
    { source: 'cardmarket', finish: 'foil', currency: 'EUR', points: points(500, 523) },
    { source: 'cardmarket', finish: 'normal', currency: 'EUR', points: points(320, 330, 334) },
    { source: 'tcgplayer', finish: 'normal', currency: 'USD', points: points(390, 402) },
    { source: 'tcgplayer_scryfall', finish: 'normal', currency: 'USD', points: points(395, 402) },
  ],
};
