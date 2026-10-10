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
