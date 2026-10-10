import { Text } from 'react-native';
import { fmt, useT } from '../../i18n';

/**
 * `EN` next to a price that is for copies in another language than the card shown (VB-103), read
 * out as "Price of EN copies"; nothing when the languages match or the price has none.
 */
export function PriceLang({ lang, shown }: { lang: string | undefined; shown: string }) {
  const t = useT();
  if (!lang || lang === shown) return null;
  const code = lang.toUpperCase();
  return (
    <Text
      aria-label={fmt(t.prices.langNote, { lang: code })}
      className="rounded border border-line px-1 font-mono text-[10.5px] font-semibold text-ink-2"
    >
      {code}
    </Text>
  );
}
