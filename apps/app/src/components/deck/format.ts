import type { DeckEntry, DeckGame, DeckProblem, ValueTotal } from '@voidbinder/shared/api';
import { Platform } from 'react-native';
import { fmt, type useT } from '../../i18n';

// Words and text of the deck screens: problems and stats in the user's language, the text export.

type Dict = ReturnType<typeof useT>;

/**
 * A rule broken, as a sentence; the zone and format codes in its params become words. Yu-Gi-Oh!'s
 * copy limits come from the TCG ban list and say so ("max. 1 laut TCG-Liste", VB-81).
 */
export function problemText(t: Dict, p: DeckProblem, game?: DeckGame): string {
  const zone = p.params.zone as keyof Dict['decks']['zones'] | undefined;
  const banlist = t.decks.problemsBanlist as Record<string, string>;
  const text = (game === 'yugioh' && banlist[p.code]) || t.decks.problems[p.code];
  return fmt(text, {
    ...p.params,
    ...(zone && { zone: t.decks.zones[zone] ?? zone }),
  });
}

export const statText = (t: Dict, stat: DeckEntry['stat']) =>
  stat ? fmt(t.decks.stat[stat.kind], { value: stat.value }) : null;

/** The largest sum (one source, one currency) and the others. */
export const headline = (totals: readonly ValueTotal[]) => {
  const [main, ...rest] = totals;
  return main ? { main, rest } : null;
};

/** "3 Name" per line, the list format Cardmarket and most deck sites take. */
export const deckText = (lines: readonly { quantity: number; name: string }[]) =>
  lines.map((l) => `${l.quantity} ${l.name}`).join('\n');

/** Copies `text` on the web; false where there is no clipboard (native until Sprint 3). */
export async function copyText(text: string): Promise<boolean> {
  if (Platform.OS !== 'web' || !globalThis.navigator?.clipboard) return false;
  await navigator.clipboard.writeText(text);
  return true;
}
