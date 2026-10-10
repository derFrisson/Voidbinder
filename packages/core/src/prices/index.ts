import type {
  Condition,
  Currency,
  DisplayPrice,
  PricePoint,
  PriceSource,
} from '@voidbinder/shared/api';

// Price domain logic (VB-30), free of any platform: which price to show, condition estimates,
// the value of a collection and the history the chart draws. Formatting is the app's job.

/** Sources in the order a user with that currency sees them: their own currency first. */
export const SOURCE_PREFERENCE: Record<Currency, readonly PriceSource[]> = {
  EUR: ['cardmarket', 'tcgplayer', 'tcgplayer_scryfall'],
  USD: ['tcgplayer', 'tcgplayer_scryfall', 'cardmarket'],
};

export interface PriceLike {
  source: PriceSource;
  finish: string;
  currency: Currency;
  market: number;
  observedAt: string;
}

/**
 * The price to show: the finish first, then within it the source the currency prefers. Finish
 * order, the same as the API's SQL `finishRank`: `finish` if asked, the listed finish (`normal`
 * if the print lists it, else its first), the print's other finishes in order, then finishes it
 * does not list, alphabetically. No conversion: the result keeps its source's currency.
 */
export function pickDisplayPrice(
  prices: readonly PriceLike[],
  opts: { currency: Currency; finish?: string | undefined; finishes?: readonly string[] },
): DisplayPrice | null {
  // ponytail: a caller without the print's finishes (collection value) assumes it lists normal.
  const finishes = opts.finishes?.length ? opts.finishes : ['normal'];
  const listed = finishes.includes('normal') ? 'normal' : finishes[0];
  const present = [...new Set(prices.map((p) => p.finish))].sort();
  const finish = [opts.finish, listed, ...finishes, ...present].find(
    (f) => f !== undefined && present.includes(f),
  );
  const order = SOURCE_PREFERENCE[opts.currency];
  const best = prices
    .filter((p) => p.finish === finish)
    .sort((a, b) => order.indexOf(a.source) - order.indexOf(b.source))[0];
  return best
    ? {
        source: best.source,
        finish: best.finish,
        currency: best.currency,
        cents: best.market,
        observedAt: best.observedAt,
      }
    : null;
}

/**
 * The factors migration 0004 seeds into `condition_multipliers`, for a game without rows there.
 * Estimates, not observed prices.
 */
export const DEFAULT_CONDITION_FACTORS: readonly { condition: Condition; factor: number }[] = [
  { condition: 'NM', factor: 1 },
  { condition: 'EX', factor: 0.85 },
  { condition: 'GD', factor: 0.7 },
  { condition: 'LP', factor: 0.6 },
  { condition: 'PL', factor: 0.45 },
  { condition: 'PO', factor: 0.3 },
];

/** A condition's estimated price from the near-mint cents and the condition's factor. */
export const conditionEstimate = (cents: number, factor: number): number =>
  Math.round(cents * factor);

/** Sum of a collection per currency (never converted) and how many entries had no price. */
export function collectionValue(
  items: readonly { quantity: number; price: { cents: number; currency: Currency } | null }[],
): { totals: Partial<Record<Currency, number>>; unpriced: number } {
  const totals: Partial<Record<Currency, number>> = {};
  let unpriced = 0;
  for (const { quantity, price } of items) {
    if (!price) unpriced += quantity;
    else totals[price.currency] = (totals[price.currency] ?? 0) + price.cents * quantity;
  }
  return { totals, unpriced };
}

const DAY_MS = 86_400_000;
const dayNumber = (date: string) => Date.parse(`${date}T00:00:00Z`) / DAY_MS;

/**
 * Daily points (oldest first, at most one per day) for the chart: kept daily for the last
 * `dailyDays` days before `today`, older ones thinned to the last point of each ISO week.
 */
export function downsampleHistory(
  points: readonly PricePoint[],
  today: string,
  dailyDays = 180,
): PricePoint[] {
  const cutoff = dayNumber(today) - dailyDays;
  const out: PricePoint[] = [];
  let week: number | undefined;
  for (const p of points) {
    const day = dayNumber(p.date);
    if (day >= cutoff) {
      out.push(p);
      continue;
    }
    // Day 0 (1970-01-01) was a Thursday: +3 makes Monday the first day of each week number.
    const w = Math.floor((day + 3) / 7);
    if (w === week) out[out.length - 1] = p;
    else out.push(p);
    week = w;
  }
  return out;
}
