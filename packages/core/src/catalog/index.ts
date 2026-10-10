import { YUGIOH_LANGUAGE_TOKENS, type Game } from '@voidbinder/shared';

// Card numbers as printed in a language (VB-97). The catalog keeps one Yu-Gi-Oh! print per set
// number, stored with the English token (`EN024`); its German copy reads `DE024`. Pokémon and
// Magic copies in another language are prints of their own with the same number.

/** A Yu-Gi-Oh! number with the English language token (`EN024`). */
const ENGLISH = /^EN(?=[A-Z0-9])/;

/** A language token as typed (`de`, `sp`, `es`, `jp`, `ja`, …) → language. */
const TYPED: Record<string, string> = Object.fromEntries(
  Object.entries(YUGIOH_LANGUAGE_TOKENS).flatMap(([lang, token]) => [
    [token.toLowerCase(), lang],
    [lang, lang],
  ]),
);

/**
 * `number` as printed in `lang`: a Yu-Gi-Oh! print with a localization in `lang`
 * (`localizationLangs`) swaps its language token (`EN024` → `DE024`, `es` → `SP024`, `ja` →
 * `JP024`); everything else stays as stored.
 */
export function displayNumber(
  game: Game,
  number: string,
  lang: string,
  localizationLangs: readonly string[],
): string {
  const token = YUGIOH_LANGUAGE_TOKENS[lang];
  // ponytail: VB-94 stores verified localized codes on print_localizations.external_ids; prefer
  // them here once they exist.
  return game === 'yugioh' && token && localizationLangs.includes(lang)
    ? number.replace(ENGLISH, token)
    : number;
}

/**
 * Set code and number as printed on the card: `BLGG-DE024` (Yu-Gi-Oh!, a code without a dash
 * as stored), `053/128` (Pokémon, the number over the set's printed size), `MID 123` (others).
 */
export function displayCode(
  game: Game,
  setCode: string,
  number: string,
  cardCount: number | null,
): string {
  const set = setCode.toUpperCase();
  if (game === 'yugioh') return number.toUpperCase() === set ? number : `${set}-${number}`;
  if (game === 'pokemon')
    return cardCount && /^\d+$/.test(number) ? `${number}/${cardCount}` : number;
  return `${set} ${number}`;
}

/**
 * The language whose token a code search names for a Yu-Gi-Oh! print stored with the English one
 * (`blggde024` for BLGG `EN024` → `de`), null for anything else. `code` is the query as the
 * search normalizes it: lower case, letters and digits only.
 */
export function typedLanguage(
  game: Game,
  code: string | null,
  setCode: string,
  number: string,
): string | null {
  if (game !== 'yugioh' || !code || !ENGLISH.test(number)) return null;
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  // Without leading zeros, like catalog_number_key: `de24` names EN024 as `de024` does.
  const digits = (s: string) => key(s).replace(/^0+/, '');
  const set = key(setCode);
  const rest = code.slice(set.length);
  // A typed tail is required: `lobde` alone must not claim LOB-EN000.
  return code.startsWith(set) &&
    rest.length > 2 &&
    digits(rest.slice(2)) === digits(number.slice(2))
    ? (TYPED[rest.slice(0, 2)] ?? null)
    : null;
}

/**
 * `displayNumber` and `displayCode` of a print in `lang` (VB-97); `localized` says whether it has a
 * localization in `lang`. `code` (a search's query as `parseCodeQuery` normalizes it) wins when it names the print
 * with a Yu-Gi-Oh! language token, and the hit then carries it as `matchedCode`.
 */
export function printNumbers(
  print: { game: Game; setCode: string; number: string; cardCount: number | null },
  lang: string,
  localized: boolean,
  code: string | null = null,
): { displayNumber: string; displayCode: string; matchedCode?: string } {
  const typed = typedLanguage(print.game, code, print.setCode, print.number);
  const shown = typed
    ? displayNumber(print.game, print.number, typed, [typed])
    : displayNumber(print.game, print.number, lang, localized ? [lang] : []);
  const printed = displayCode(print.game, print.setCode, shown, print.cardCount);
  return {
    displayNumber: shown,
    displayCode: printed,
    ...(typed ? { matchedCode: printed } : {}),
  };
}

/**
 * Which of the languages whose name matched (`matched`, '' for the English card name) a hit is
 * shown in (VB-102): `requested` when it is one of them, else English, else the first; `requested`
 * when no name matched.
 */
export function nameLanguage(matched: readonly string[], requested: string): string {
  const langs = matched.map((l) => l || 'en');
  if (!langs.length || langs.includes(requested)) return requested;
  return langs.includes('en') ? 'en' : ([...langs].sort()[0] ?? requested);
}

/**
 * The language a search hit or suggestion is shown in (VB-102): the language of what matched,
 * never a fixed one. A Yu-Gi-Oh! code with a language token (`typedLanguage`) names it; else the
 * names that matched (`nameLanguage`). A match without either (a code without a token, a set)
 * leaves `requested`, the user's language, as the only signal.
 */
export function matchLanguage(
  print: { game: Game; setCode: string; number: string },
  matched: readonly string[],
  requested: string,
  code: string | null = null,
): string {
  return (
    typedLanguage(print.game, code, print.setCode, print.number) ?? nameLanguage(matched, requested)
  );
}
