import { de, type Dict } from './de';
import { en } from './en';

export const locales = ['de', 'en'] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = 'de';

const dicts: Record<Locale, Dict> = { de, en };

export function t(locale: Locale): Dict {
  return dicts[locale];
}

export function isLocale(value: string | undefined): value is Locale {
  return locales.some((l) => l === value);
}

/** Legal pages (VB-18): the slug differs per locale, the page key does not. */
export const legalPages = ['imprint', 'privacy'] as const;
export type LegalPage = (typeof legalPages)[number];
export const legalSlugs: Record<Locale, Record<LegalPage, string>> = {
  de: { imprint: 'impressum', privacy: 'datenschutz' },
  en: { imprint: 'imprint', privacy: 'privacy' },
};

/** `/<locale>/<slug>/` of a legal page. */
export function legalPath(locale: Locale, page: LegalPage): string {
  return `/${locale}/${legalSlugs[locale][page]}/`;
}

/**
 * The same page in another locale: swaps the leading `/de/` or `/en/` segment and, on a legal
 * page, the slug (`/de/impressum/` is `/en/imprint/`).
 */
export function localePath(pathname: string, to: Locale): string {
  return pathname
    .replace(/^\/(de|en)(?=\/|$)/, `/${to}`)
    .replace(/^(\/(?:de|en)\/)([^/]+)/, (whole, prefix: string, slug: string) => {
      const page = legalPages.find((p) => locales.some((l) => legalSlugs[l][p] === slug));
      return page ? `${prefix}${legalSlugs[to][page]}` : whole;
    });
}

export const links = {
  github: 'https://github.com/derFrisson/Voidbinder',
  twitch: 'https://www.twitch.tv/derFrisson',
  voidcom: 'https://voidcom.app',
};

/**
 * Picks the site locale from an `Accept-Language` header: tags are taken in order of their q
 * value and matched on the language subtag only, so `en-US` and `en-GB` both mean `en`. Astro's
 * `preferredLocale` matches full tags and would send a bare `en-US` to the default locale.
 */
export function negotiateLocale(acceptLanguage: string | null | undefined): Locale {
  if (!acceptLanguage) return defaultLocale;
  const tags = acceptLanguage
    .split(',')
    .map((part, index) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      const weight = q ? Number(q.slice(2)) : 1;
      return { tag: tag.trim().toLowerCase(), weight: Number.isFinite(weight) ? weight : 0, index };
    })
    .filter((entry) => entry.tag && entry.weight > 0)
    .sort((a, b) => b.weight - a.weight || a.index - b.index);
  for (const { tag } of tags) {
    const language = tag.split('-')[0];
    if (isLocale(language)) return language;
  }
  return defaultLocale;
}

const numberLocales: Record<Locale, string> = { de: 'de-DE', en: 'en-US' };

/** A price in the locale's format: `3,20 €` / `€3.20`, `3,60 $` / `$3.60`. */
export function money(locale: Locale, amount: number, currency: 'EUR' | 'USD' = 'EUR'): string {
  return new Intl.NumberFormat(numberLocales[locale], { style: 'currency', currency }).format(
    amount,
  );
}

/** A bare amount with two decimals for price columns: `12,80` / `12.80`. */
export function amount(locale: Locale, value: number): string {
  return new Intl.NumberFormat(numberLocales[locale], { minimumFractionDigits: 2 }).format(value);
}
