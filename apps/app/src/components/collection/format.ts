import type { Locale } from '@voidbinder/shared';
import type { CollectionCondition, Currency, PriceSource } from '@voidbinder/shared/api';

// Formatting for the collection screens: amounts in their own currency (never converted), the
// day a price was observed, the source's name.

export const CONDITIONS: CollectionCondition[] = ['MT', 'NM', 'EX', 'GD', 'LP', 'PL', 'PO'];

/** Languages an entry can have: the catalog's two first, then the other printed ones. */
export const LANGUAGES = ['de', 'en', 'fr', 'it', 'es', 'pt', 'ja', 'ko', 'zhs', 'ru'] as const;

export const money = (cents: number, currency: Currency | string, locale: Locale) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency }).format(cents / 100);

/** A signed amount ("+1,40 €"), for a gain since purchase. */
export const signedMoney = (cents: number, currency: Currency | string, locale: Locale) =>
  new Intl.NumberFormat(locale, { style: 'currency', currency, signDisplay: 'always' }).format(
    cents / 100,
  );

export const day = (iso: string, locale: Locale) =>
  new Intl.DateTimeFormat(locale, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    timeZone: 'UTC',
  }).format(new Date(iso));

export const SOURCE_NAMES: Record<PriceSource, string> = {
  cardmarket: 'Cardmarket',
  tcgplayer: 'TCGplayer',
  tcgplayer_scryfall: 'TCGplayer',
};

/** A price typed by the user ("2,50", "2.50 €") as cents; null when empty or not a number. */
export function parseCents(text: string): number | null {
  const clean = text.replace(/[^\d,.]/g, '');
  if (!/\d/.test(clean)) return null;
  // The last separator followed by one or two digits is the decimal one ("1.234,50", "1,234.5").
  const decimal = /^(.*)[.,](\d{1,2})$/.exec(clean);
  const whole = Number((decimal?.[1] ?? clean).replace(/[.,]/g, '') || '0');
  const fraction = Number((decimal?.[2] ?? '0').padEnd(2, '0'));
  return whole * 100 + fraction;
}

/** Cents as the user types them back in ("2,50"), empty for none. */
export const centsText = (cents: number | null, locale: Locale) =>
  cents === null
    ? ''
    : (cents / 100).toLocaleString(locale, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
