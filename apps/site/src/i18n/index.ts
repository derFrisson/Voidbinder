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

/** The same page in another locale: swaps the leading `/de/` or `/en/` segment. */
export function localePath(pathname: string, to: Locale): string {
  return pathname.replace(/^\/(de|en)(?=\/|$)/, `/${to}`);
}

export const links = {
  github: 'https://github.com/derFrisson/Voidbinder',
  twitch: 'https://www.twitch.tv/derFrisson',
  voidcom: 'https://voidcom.app',
};
