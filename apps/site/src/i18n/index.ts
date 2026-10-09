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
