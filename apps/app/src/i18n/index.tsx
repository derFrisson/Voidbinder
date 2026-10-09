import type { Locale } from '@voidbinder/shared';
import { getLocales } from 'expo-localization';
import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { Platform } from 'react-native';
import { useSession } from '../api/queries/me';
import { de, type Dict } from './de';
import { en } from './en';

export const dicts: Record<Locale, Dict> = { de, en };

/** The first of the device's (browser's) languages the app speaks, German otherwise. */
export function deviceLocale(): Locale {
  for (const { languageCode } of getLocales()) {
    if (languageCode === 'de' || languageCode === 'en') return languageCode;
  }
  return 'de';
}

/** Fills `{name}` placeholders. */
export function fmt(text: string, values: Record<string, string | number>): string {
  return text.replace(/\{(\w+)\}/g, (whole, key: string) => String(values[key] ?? whole));
}

const LocaleContext = createContext<Locale>('de');

/** The language of the profile when signed in, the device's otherwise. */
export function I18nProvider({ children }: { children: ReactNode }) {
  const { data: me } = useSession();
  const locale = me?.language ?? deviceLocale();
  useEffect(() => {
    if (Platform.OS === 'web') document.documentElement.lang = locale;
  }, [locale]);
  return <LocaleContext.Provider value={locale}>{children}</LocaleContext.Provider>;
}

export const useLocale = () => useContext(LocaleContext);
export const useT = () => dicts[useLocale()];
