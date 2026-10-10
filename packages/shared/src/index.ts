import { z } from 'zod';

export const LocaleSchema = z.enum(['de', 'en']);
export type Locale = z.infer<typeof LocaleSchema>;

export const EmailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254));
export type Email = z.infer<typeof EmailSchema>;

export const GameSchema = z.enum(['pokemon', 'yugioh', 'mtg', 'onepiece']);
export type Game = z.infer<typeof GameSchema>;

/**
 * Languages a copy of a game's card can be printed in, when the catalog keeps one print per set
 * number and the languages as its localizations (Yu-Gi-Oh!: the TCG languages, fixed order). A
 * collection entry may be in any of them even without a localization row. Games not listed
 * offer the print's localizations only.
 */
export const TCG_LANGUAGES_BY_GAME: Partial<Record<Game, readonly string[]>> = {
  yugioh: ['en', 'de', 'fr', 'it', 'es', 'pt', 'ja'],
};

/**
 * The language token of a Yu-Gi-Oh! card number as printed (`BLGG-DE024`), per language (`es`
 * prints SP, `ja` JP). The catalog stores the English number (`EN024`).
 */
export const YUGIOH_LANGUAGE_TOKENS: Readonly<Record<string, string>> = {
  en: 'EN',
  de: 'DE',
  fr: 'FR',
  it: 'IT',
  es: 'SP',
  pt: 'PT',
  ja: 'JP',
};

/**
 * Card formats (VB-97), stored per game in `games.card_format`: `standard` is 63 × 88 mm
 * (Pokémon, Magic, One Piece), `japanese` 59 × 86 mm (Yu-Gi-Oh!). The single source of the image
 * boxes' aspect ratios.
 */
export const CARD_FORMATS = {
  standard: { width: 63, height: 88 },
  japanese: { width: 59, height: 86 },
} as const;

export type CardFormat = keyof typeof CARD_FORMATS;
export const CardFormatSchema = z.enum(Object.keys(CARD_FORMATS) as [CardFormat, ...CardFormat[]]);

/** Width / height of a card in `format` (`standard` when unknown). */
export const cardAspect = (format: CardFormat = 'standard') =>
  CARD_FORMATS[format].width / CARD_FORMATS[format].height;

export * from './yugioh-rarities.js';
