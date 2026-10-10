import { useLocalSearchParams } from 'expo-router';
import { useLocale } from '../i18n';

/**
 * The language the user browses in: the page's `?lang=` (the set page's DE/EN chip, or a search
 * hit opened in the language it matched, VB-102), else the UI language.
 */
export function useBrowsingLanguage() {
  const { lang } = useLocalSearchParams<{ lang?: string }>();
  const locale = useLocale();
  return typeof lang === 'string' && /^[a-z]{2,3}$/.test(lang) ? lang : locale;
}

/**
 * The card page of a search hit or suggestion (VB-102): its print, and `?lang=` with the language
 * the hit is shown in (what matched) unless that is the user's, the card page's default. A server
 * before VB-102 sends no `lang`.
 */
export function hitHref(
  hit: { cardId: string; id: string; lang?: string | undefined },
  locale: string,
) {
  const lang = hit.lang && hit.lang !== locale ? `&lang=${hit.lang}` : '';
  return `/cards/${hit.cardId}?print=${hit.id}${lang}`;
}
