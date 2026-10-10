import { z } from 'zod';
import { CardFormatSchema, GameSchema } from '../index.js';
import { ImageInfoSchema, LangSchema, SearchNamesSchema } from './catalog.js';

// Search typeahead (VB-79). The full search (`GET /catalog/search`) lives in catalog.ts.

/** Most suggestions `GET /catalog/search/suggest` answers. */
export const SUGGEST_LIMIT = 8;

/** `GET /catalog/search/suggest?q=&game=&lang=&names=` (VB-79): the typeahead of the search box. */
export const SearchSuggestQuerySchema = z.object({
  /** A name, a set code (`lds3`), a set code and number (`LDS3-EN121`, `mid 123`) or `001/128`. */
  q: z.string().trim().min(2).max(64),
  game: GameSchema.optional(),
  /** The user's language: as on `/catalog/search`, the tie-breaker of `SearchSuggestion.lang`. */
  lang: LangSchema.default('en'),
  names: SearchNamesSchema,
});
export type SearchSuggestQuery = z.infer<typeof SearchSuggestQuerySchema>;

/**
 * A print (`id` is the print id) or a set (`id` is the set id; `number`, `variant`, `rarity`,
 * `imageUrl` and `cardId` are absent).
 */
export const SearchSuggestionSchema = z.object({
  kind: z.enum(['print', 'set']),
  id: z.uuid(),
  /** Card name in `lang` for a print, set name for a set, falling back to English. */
  name: z.string(),
  game: GameSchema,
  set: z.object({ code: z.string(), name: z.string() }),
  /** As on SearchHit (VB-102): the language of what matched; `?lang=` for a set. */
  lang: LangSchema,
  number: z.string().optional(),
  /** As on SearchHit: in `lang`. */
  displayNumber: z.string().optional(),
  displayCode: z.string().optional(),
  matchedCode: z.string().optional(),
  cardFormat: CardFormatSchema.optional(),
  variant: z.string().optional(),
  rarity: z.string().nullable().optional(),
  imageUrl: z.url().nullable().optional(),
  ...ImageInfoSchema.shape,
  /** As on SearchHit: a Yu-Gi-Oh! Extended Art print (VB-109); absent otherwise. */
  extendedArt: z.literal(true).optional(),
  cardId: z.uuid().optional(),
});
export type SearchSuggestion = z.infer<typeof SearchSuggestionSchema>;

/**
 * At most `SUGGEST_LIMIT`, ordered: exact set code + number, partial numbers, sets (by code or
 * name prefix) and the first prints of a set named by its code, card names starting with `q`,
 * then names similar to `q` (typos). One print per card for the name matches.
 */
export const SearchSuggestResponseSchema = z.object({
  suggestions: z.array(SearchSuggestionSchema),
});
export type SearchSuggestResponse = z.infer<typeof SearchSuggestResponseSchema>;
