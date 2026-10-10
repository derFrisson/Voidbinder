import { z } from 'zod';
import { GameSchema } from '../index.js';
import { CurrencySchema } from './me.js';
import { DisplayPriceSchema } from './prices.js';

// Catalog read API (`/catalog/**`, VB-26). Every response carries an ETag that includes the
// catalog_version (ADR 0004).

/** Page size of `GET /catalog/sets/:game/:code`. */
export const SET_PAGE_SIZE = 60;

/** A source language code (`en`, `de`, `ja`, `zhs`, …). */
export const LangSchema = z.string().regex(/^[a-z]{2,3}$/);

export const GameSummarySchema = z.object({
  id: GameSchema,
  name: z.string(),
  setCount: z.number().int(),
});
export type GameSummary = z.infer<typeof GameSummarySchema>;

/** `GET /catalog/games`. */
export const GamesResponseSchema = z.object({ games: z.array(GameSummarySchema) });
export type GamesResponse = z.infer<typeof GamesResponseSchema>;

export const SetSummarySchema = z.object({
  code: z.string(),
  /** English name. */
  name: z.string(),
  /** Name in `?lang=`, null when the set has none in that language. */
  localizedName: z.string().nullable(),
  releasedOn: z.iso.date().nullable(),
  cardCount: z.number().int().nullable(),
  /** The source's set type (core, expansion, promo, …). */
  kind: z.string().nullable(),
});
export type SetSummary = z.infer<typeof SetSummarySchema>;

/** `GET /catalog/games/:game/sets?lang=`, newest first. */
export const SetsResponseSchema = z.object({ game: GameSchema, sets: z.array(SetSummarySchema) });
export type SetsResponse = z.infer<typeof SetsResponseSchema>;

export const SetsQuerySchema = z.object({ lang: LangSchema.default('en') });

export const SetPageQuerySchema = z.object({
  lang: LangSchema.default('en'),
  rarity: z.string().max(32).optional(),
  finish: z.string().max(32).optional(),
  /** `price`: the printed `marketPrice` from high to low, prints without one last. */
  sort: z.enum(['number', 'name', 'rarity', 'price']).default('number'),
  /** Picks the source of each print's `marketPrice` (EUR → Cardmarket first, USD → TCGplayer). */
  currency: CurrencySchema.default('EUR'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type SetPageQuery = z.infer<typeof SetPageQuerySchema>;

/**
 * The fields next to every `imageUrl` (VB-86/VB-87): the language the image is in and whose image it
 * is. A print without an image of its own, or without one in the requested language, shows what
 * exists (the requested language, then en, ja, the rest; then another print of the card). Absent
 * without an image, and from servers before VB-86.
 */
export const ImageInfoSchema = z.object({
  imageLang: z.string().optional(),
  imageFrom: z.enum(['print', 'sibling']).optional(),
});
export type ImageInfo = z.infer<typeof ImageInfoSchema>;

export const PrintSummarySchema = z.object({
  id: z.uuid(),
  cardId: z.uuid(),
  number: z.string(),
  /** '' or, where one number exists in several rarities (Yu-Gi-Oh!), the rarity slug. */
  variant: z.string(),
  /** Name in `?lang=`, falling back to English. */
  name: z.string(),
  rarity: z.string().nullable(),
  finishes: z.array(z.string()),
  imageUrl: z.url().nullable(),
  ...ImageInfoSchema.shape,
  /**
   * Market price of the `normal` finish (the first finish without one); a print without a price
   * for it falls back to a finish it has one for (Yu-Gi-Oh!: `first_edition`). null without any.
   */
  marketPrice: DisplayPriceSchema.nullable(),
});
export type PrintSummary = z.infer<typeof PrintSummarySchema>;

/**
 * `GET /catalog/sets/:game/:code?lang=&rarity=&finish=&sort=&page=`. Sorted by number or name,
 * the variants of a number follow each other.
 */
export const SetPageResponseSchema = z.object({
  set: SetSummarySchema.extend({ game: GameSchema }),
  prints: z.array(PrintSummarySchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  /** Prints matching the filters (not the whole set), for the pagination. */
  total: z.number().int(),
  /** What the whole set holds, whatever the filters: the options of the filter rows. */
  facets: z.object({
    /** Rarities with their print counts, Magic's order first (common to mythic), then by count. */
    rarities: z.array(z.object({ rarity: z.string(), count: z.number().int() })),
    finishes: z.array(z.object({ finish: z.string(), count: z.number().int() })),
    /** Languages the set's prints have a name in (`en`, `de`, …). */
    languages: z.array(z.string()),
  }),
});
export type SetPageResponse = z.infer<typeof SetPageResponseSchema>;

export const CardSchema = z.object({
  id: z.uuid(),
  game: GameSchema,
  name: z.string(),
  typeLine: z.string().nullable(),
  text: z.string().nullable(),
  /** Game-specific fields as the source gives them (mana cost, HP, attack, …). */
  attributes: z.record(z.string(), z.unknown()),
  /** Format → legality (`legal`, `not_legal`, `banned`, `restricted`). */
  legalities: z.record(z.string(), z.string()),
});
export type Card = z.infer<typeof CardSchema>;

export const PrintLocalizationSchema = z.object({
  lang: z.string(),
  name: z.string(),
  text: z.string().nullable(),
  imageUrl: z.url().nullable(),
  ...ImageInfoSchema.shape,
});
export type PrintLocalization = z.infer<typeof PrintLocalizationSchema>;

export const PrintDetailSchema = z.object({
  id: z.uuid(),
  cardId: z.uuid(),
  set: z.object({ game: GameSchema, code: z.string(), name: z.string() }),
  number: z.string(),
  /** '' or, where one number exists in several rarities (Yu-Gi-Oh!), the rarity slug. */
  variant: z.string(),
  rarity: z.string().nullable(),
  finishes: z.array(z.string()),
  artist: z.string().nullable(),
  releasedOn: z.iso.date().nullable(),
  imageUrl: z.url().nullable(),
  ...ImageInfoSchema.shape,
  /** Ids at other sources: `scryfall`, `tcgplayer`, `cardmarket`, `mtgo`, `arena`, … */
  externalIds: z.record(z.string(), z.unknown()),
  localizations: z.array(PrintLocalizationSchema),
});
export type PrintDetail = z.infer<typeof PrintDetailSchema>;

/** `GET /catalog/cards/:id?currency=`. */
export const CardQuerySchema = z.object({
  /** Picks the source of each print's `marketPrice`, as on the set page. */
  currency: CurrencySchema.default('EUR'),
});
export type CardQuery = z.infer<typeof CardQuerySchema>;

/** A print of the card page's table: the detail plus its price, as on the set page. */
export const CardPrintSchema = PrintDetailSchema.extend({
  /** Market price of the `normal` finish, else the print's first finish, else any finish it has a price for. */
  marketPrice: DisplayPriceSchema.nullable(),
});
export type CardPrint = z.infer<typeof CardPrintSchema>;

/** `GET /catalog/cards/:id`: the card with all its prints, newest first. */
export const CardResponseSchema = z.object({
  card: CardSchema,
  prints: z.array(CardPrintSchema),
  /** The game's copyright line (`@voidbinder/shared/notices`), shown with a print's `artist`. */
  copyright: z.string(),
});
export type CardResponse = z.infer<typeof CardResponseSchema>;

/** `GET /catalog/prints/:id`. */
export const PrintResponseSchema = z.object({
  print: PrintDetailSchema,
  card: CardSchema,
  copyright: z.string(),
});
export type PrintResponse = z.infer<typeof PrintResponseSchema>;

/** Page size of `GET /catalog/search`. */
export const SEARCH_PAGE_SIZE = 30;

/**
 * Which names `q` matches (VB-79): `all` (every language's name and the English card name) or a
 * language code, whose localized names alone then match (prints without one drop out). Set
 * codes and numbers match either way.
 */
export const SearchNamesSchema = z.union([z.literal('all'), LangSchema]).default('all');

/**
 * `GET /catalog/search?q=&game=&set=&rarity=&lang=&names=&finish=&page=` (VB-35). Filters are
 * exact.
 */
export const SearchQuerySchema = z.object({
  /**
   * websearch syntax (`"exact phrase"`, `-not`, `or`); the last word matches as a prefix. A set
   * code with a number (`LDS3-EN121`, `sv1 001`), a bare set code or a number (`121`, `001/128`)
   * finds those prints first; names similar to `q` answer when no name matches (VB-79).
   */
  q: z.string().trim().min(2).max(80),
  game: GameSchema.optional(),
  /** Set code, lowercase as in `/catalog/sets/:game/:code`. */
  set: z.string().trim().toLowerCase().max(32).optional(),
  rarity: z.string().max(32).optional(),
  /** Language the names are shown in; the app sends the user's. Names fall back to English. */
  lang: LangSchema.default('en'),
  names: SearchNamesSchema,
  finish: z.string().max(32).optional(),
  /** Picks the source of each hit's `marketPrice`, as on the set page. */
  currency: CurrencySchema.default('EUR'),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
});
export type SearchQuery = z.infer<typeof SearchQuerySchema>;

export const SearchHitSchema = PrintSummarySchema.extend({
  game: GameSchema,
  /** The card's English type line (the deck builder puts Extra Deck monsters into the extra). */
  typeLine: z.string().nullable().optional(),
  setCode: z.string(),
  /** Set name in `?lang=`, falling back to English. */
  setName: z.string(),
});
export type SearchHit = z.infer<typeof SearchHitSchema>;

/** Code matches first, then prints whose card or localization matches by `ts_rank`, then by name. */
export const SearchResponseSchema = z.object({
  prints: z.array(SearchHitSchema),
  page: z.number().int(),
  pageSize: z.number().int(),
  total: z.number().int(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

/** `POST /admin/import/scryfall`: 202 once the import Workflow is queued. */
export const ImportStartedResponseSchema = z.object({ status: z.literal('started') });
export type ImportStartedResponse = z.infer<typeof ImportStartedResponseSchema>;
