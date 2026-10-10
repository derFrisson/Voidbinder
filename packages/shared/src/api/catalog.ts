import { z } from 'zod';
import { CardFormatSchema, GameSchema } from '../index.js';
import { CurrencySchema, LangSchema } from './me.js';
import { DisplayPriceSchema } from './prices.js';

export { LangSchema };

// Catalog read API (`/catalog/**`, VB-26). Every response carries an ETag that includes the
// catalog_version (ADR 0004).

/** Page size of `GET /catalog/sets/:game/:code`. */
export const SET_PAGE_SIZE = 60;

export const GameSummarySchema = z.object({
  id: GameSchema,
  name: z.string(),
  setCount: z.number().int(),
  /** The game's card format (`CARD_FORMATS`), for the image box. */
  cardFormat: CardFormatSchema,
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

/**
 * `GET /catalog/sets/new?days=30&lang=`: sets released in the last `days` days (not the upcoming
 * ones), or without a release date and first imported in that time, after the game's first
 * import (VB-83).
 */
export const NewSetsQuerySchema = SetsQuerySchema.extend({
  days: z.coerce.number().int().min(1).max(90).default(30),
});

/** Every game's new sets, in the games' order, newest first within a game. */
export const NewSetsResponseSchema = z.object({
  sets: z.array(SetSummarySchema.extend({ game: GameSchema })),
});
export type NewSetsResponse = z.infer<typeof NewSetsResponseSchema>;

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
  /**
   * The number in the language shown (VB-97): a Yu-Gi-Oh! print with a localization in that
   * language takes its language token (`EN024` → `DE024`); otherwise `number`.
   */
  displayNumber: z.string(),
  /** Set code and `displayNumber` as printed: `BLGG-DE024`, `053/128` (Pokémon), `MID 123`. */
  displayCode: z.string(),
  /** The game's card format (`CARD_FORMATS`), for the image box. */
  cardFormat: CardFormatSchema,
  /** '' or, where one number exists in several rarities (Yu-Gi-Oh!), the rarity slug. */
  variant: z.string(),
  /** Name in `?lang=`, falling back to English. */
  name: z.string(),
  rarity: z.string().nullable(),
  finishes: z.array(z.string()),
  imageUrl: z.url().nullable(),
  ...ImageInfoSchema.shape,
  /** A Yu-Gi-Oh! Extended Art print (VB-106, Yugipedia's set gallery); absent otherwise. */
  extendedArt: z.literal(true).optional(),
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
  /** The print's number and code in this language (as on PrintDetail). */
  displayNumber: z.string(),
  displayCode: z.string(),
  ...ImageInfoSchema.shape,
});
export type PrintLocalization = z.infer<typeof PrintLocalizationSchema>;

export const PrintDetailSchema = z.object({
  id: z.uuid(),
  cardId: z.uuid(),
  set: z.object({ game: GameSchema, code: z.string(), name: z.string() }),
  number: z.string(),
  /** The number and code as stored (English); each localization has its own. */
  displayNumber: z.string(),
  displayCode: z.string(),
  /** The game's card format (`CARD_FORMATS`), for the image box. */
  cardFormat: CardFormatSchema,
  /** '' or, where one number exists in several rarities (Yu-Gi-Oh!), the rarity slug. */
  variant: z.string(),
  rarity: z.string().nullable(),
  finishes: z.array(z.string()),
  artist: z.string().nullable(),
  releasedOn: z.iso.date().nullable(),
  imageUrl: z.url().nullable(),
  ...ImageInfoSchema.shape,
  /** A Yu-Gi-Oh! Extended Art print (VB-106, Yugipedia's set gallery); absent otherwise. */
  extendedArt: z.literal(true).optional(),
  /** Ids at other sources: `scryfall`, `tcgplayer`, `cardmarket`, `mtgo`, `arena`, … */
  externalIds: z.record(z.string(), z.unknown()),
  localizations: z.array(PrintLocalizationSchema),
});
export type PrintDetail = z.infer<typeof PrintDetailSchema>;

/** `GET /catalog/cards/:id?currency=`. */
export const CardQuerySchema = z.object({
  /** Picks the source of each print's `marketPrice`, as on the set page. */
  currency: CurrencySchema.default('EUR'),
  /** The language the page shows: each print's `marketPrice` prefers a price in it (VB-103). */
  lang: LangSchema.default('en'),
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
  /**
   * The user's language (the app sends it): the language of a hit whose match names none, and the
   * pick among several matched languages (`SearchHit.lang`).
   */
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
  /** Set name in `lang`, falling back to English. */
  setName: z.string(),
  /**
   * The language the hit is shown in (VB-102): the language of what matched (a localized name,
   * `en` for the English card name, the token of a code such as `BLGG-DE024`); `?lang=` only
   * when nothing else names one (a code without a token, a set) or as the tie-breaker of a name
   * equal in several languages. `name`, `displayNumber`, `displayCode`, `setName` and the image
   * are in it, falling back as everywhere.
   */
  lang: LangSchema,
  /**
   * The code `q` named with a language token, as printed (`BLGG-DE024` for a search of
   * `blgg de024`); `lang` is then that token's language. Absent otherwise.
   */
  matchedCode: z.string().optional(),
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

/** One `import_runs` row in `GET /admin/imports` (VB-83). */
export const ImportRunSchema = z.object({
  id: z.string(),
  kind: z.string(),
  /** `running` | `ok` | `failed` */
  status: z.string(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
  durationSeconds: z.number().nullable(),
  /** The importer's counts. */
  stats: z.record(z.string(), z.unknown()),
  error: z.string().nullable(),
});
export type ImportRun = z.infer<typeof ImportRunSchema>;

/** `GET /admin/imports/health`: the scheduled imports against their cadence (VB-83). */
export const ImportHealthSchema = z.object({
  /** No source missing or failed, no stale prices. */
  ok: z.boolean(),
  /**
   * One line: `OK`, or the missing and the failed sources and the stale prices per source and game
   * (the Uptime Kuma push message).
   */
  message: z.string(),
  sources: z.array(
    z.object({
      source: z.string(),
      cadence: z.enum(['daily', 'weekly']),
      /** `finished_at` of the newest `ok` run, null when none. */
      lastSuccessAt: z.string().nullable(),
      /** Status of the newest finished run, null when none. */
      lastStatus: z.string().nullable(),
      /** No `ok` run within the cadence plus 2 hours. */
      missing: z.boolean(),
      /** The newest finished run failed. */
      failed: z.boolean(),
      /**
       * Price runs (VB-116): fewer than 95 % of a game's priced prints refreshed in 24 h, or more
       * stale prints (newest price older than 36 h) than the day before; the message names them.
       */
      stale: z.boolean(),
    }),
  ),
});
export type ImportHealth = z.infer<typeof ImportHealthSchema>;

/** `GET /admin/imports`: the last 30 runs per source, newest first, and the health block. */
export const ImportsResponseSchema = z.object({
  runs: z.record(z.string(), z.array(ImportRunSchema)),
  health: ImportHealthSchema,
});
export type ImportsResponse = z.infer<typeof ImportsResponseSchema>;
