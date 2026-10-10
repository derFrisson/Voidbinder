import { YUGIOH_LANGUAGE_TOKENS, type Game } from '@voidbinder/shared';
import type { PrintDetail } from '@voidbinder/shared/api';
import { fmt } from '../../i18n';
import type { usePalette } from '../palette';

// The game's colour field (docs/app/design.md): the soft tint behind a card, the full colour as a
// shape (fill or edge), never as text.
export const fieldClass: Record<Game, { soft: string; solid: string; edge: string }> = {
  pokemon: { soft: 'bg-pk-soft', solid: 'bg-pk', edge: 'border-l-pk' },
  yugioh: { soft: 'bg-yg-soft', solid: 'bg-yg', edge: 'border-l-yg' },
  mtg: { soft: 'bg-mg-soft', solid: 'bg-mg', edge: 'border-l-mg' },
  onepiece: { soft: 'bg-op-soft', solid: 'bg-op', edge: 'border-l-op' },
};

const key = { pokemon: 'pk', yugioh: 'yg', mtg: 'mg', onepiece: 'op' } as const;

/** The game's colour as a value, for SVG fills. */
export const fieldColor = (game: Game, palette: ReturnType<typeof usePalette>) =>
  palette[key[game]];

/**
 * A print's shown number for a label, with "Nummer in DE" when it is not the stored one (a
 * Yu-Gi-Oh! language token, VB-97): `DE024 (Nummer in DE)`.
 */
export function numberLabel(numberIn: string, p: { number: string; displayNumber: string }) {
  const lang =
    p.displayNumber !== p.number &&
    Object.keys(YUGIOH_LANGUAGE_TOKENS).find((l) =>
      p.displayNumber.startsWith(YUGIOH_LANGUAGE_TOKENS[l] ?? ''),
    );
  return lang
    ? `${p.displayNumber} (${fmt(numberIn, { lang: lang.toUpperCase() })})`
    : p.displayNumber;
}

/** A print's number and code in `lang`: its localization's, else as stored (VB-97). */
export const inLanguage = (print: PrintDetail, lang: string) =>
  print.localizations.find((l) => l.lang === lang) ?? print;
