import { z } from 'zod';
import type { Game } from '../index.js';
import { EntryPriceSchema, ValueGroupSchema } from './collection.js';
import { CurrencySchema } from './me.js';
import { PriceSourceSchema } from './prices.js';

// Decks (`/decks/**`, VB-34) of the signed-in user. A deck carries a client-generated `id` like
// the collection (VB-31); its entries are replaced as a whole. The rules
// (`packages/core/src/decks`) run on the server for every read.

const Timestamp = z.iso.datetime({ offset: true });

/** Formats per game; the first is the default of a new deck. One Piece has no deck rules yet. */
export const DECK_FORMATS = {
  mtg: ['standard', 'pioneer', 'modern', 'legacy', 'vintage', 'commander', 'pauper'],
  pokemon: ['standard', 'expanded'],
  yugioh: ['advanced'],
} as const satisfies Partial<Record<Game, readonly string[]>>;

export type DeckGame = keyof typeof DECK_FORMATS;
export const DeckGameSchema = z.enum(['mtg', 'pokemon', 'yugioh']);

/** The zones a game's deck has (Magic's `commander` only counts in the commander format). */
export const DECK_ZONES = {
  mtg: ['commander', 'main', 'side'],
  pokemon: ['main'],
  yugioh: ['main', 'extra', 'side'],
} as const satisfies Record<DeckGame, readonly string[]>;

export const DeckZoneSchema = z.enum(['main', 'extra', 'side', 'commander']);
export type DeckZone = z.infer<typeof DeckZoneSchema>;

/**
 * A rule broken. `code` is the message key the app translates (`decks.problems.<code>`), `params`
 * fill its placeholders (`name`, `count`, `limit`, `zone`, …).
 */
export const DeckProblemSchema = z.object({
  code: z.enum([
    'unknown_format',
    'too_few',
    'too_many',
    'wrong_size',
    'too_many_copies',
    'banned',
    'not_legal',
    'wrong_zone',
    'commander_missing',
    'commander_invalid',
    'colour_identity',
    'no_basic_pokemon',
    'too_many_ace_spec',
    'too_many_radiant',
  ]),
  cardId: z.uuid().optional(),
  params: z.record(z.string(), z.union([z.string(), z.number()])),
});
export type DeckProblem = z.infer<typeof DeckProblemSchema>;
export type DeckProblemCode = DeckProblem['code'];

/** A zone's size limits; absent bounds are open. */
export const ZoneLimitSchema = z.object({
  min: z.number().int().optional(),
  max: z.number().int().optional(),
});

/** Something per zone, the zones a deck has only. */
const perZone = <T extends z.ZodType>(value: T) =>
  z.object({
    main: value.optional(),
    extra: value.optional(),
    side: value.optional(),
    commander: value.optional(),
  });

/** The rules of a game and format, for the rule cards. */
export const DeckRulesSchema = z.object({
  zones: perZone(ZoneLimitSchema),
  /** Copies of one card (by name), basic lands and basic energy aside. */
  copies: z.number().int(),
});
export type DeckRules = z.infer<typeof DeckRulesSchema>;

/** One missing card: the deck needs more copies (by name, any print) than the collection holds. */
export const MissingCardSchema = z.object({
  cardId: z.uuid(),
  /** Name in the user's language, else English. */
  name: z.string(),
  /** The English name, for the text export (Cardmarket's wants import reads English). */
  englishName: z.string(),
  /** The print the price is from (the cheapest), else the preferred print, else the first. */
  printId: z.uuid().nullable(),
  setCode: z.string().nullable(),
  number: z.string().nullable(),
  /** Copies the deck needs (every zone) and copies the collection holds; missing = the difference. */
  needed: z.number().int(),
  owned: z.number().int(),
  unitPriceCents: z.number().int().nullable(),
  currency: CurrencySchema.nullable(),
  source: PriceSourceSchema.nullable(),
  observedAt: Timestamp.nullable(),
});
export type MissingCard = z.infer<typeof MissingCardSchema>;

/** The rules' verdict and the comparison with the collection. */
export const DeckAnalysisSchema = z.object({
  valid: z.boolean(),
  problems: z.array(DeckProblemSchema),
  rules: DeckRulesSchema,
  /** Copies per zone. */
  counts: perZone(z.number().int()),
  /** Mana value (Magic), cheapest attack in energy (Pokémon) or level (Yu-Gi-Oh!) of the main deck. */
  curve: z.object({
    kind: z.enum(['mana', 'energy', 'level']),
    buckets: z.array(z.object({ label: z.string(), count: z.number().int() })),
  }),
  missing: z.array(MissingCardSchema),
  /**
   * What the missing copies cost, per source and currency (never converted, so there is no single
   * sum when sources differ), with the oldest observation; `unpriced` copies have no price.
   */
  missingValue: ValueGroupSchema,
  /** The whole deck's value, the same way. */
  value: ValueGroupSchema,
  /** Copies in the collection (all binders, all games): the "compared with n cards" line. */
  collectionCards: z.number().int(),
});
export type DeckAnalysis = z.infer<typeof DeckAnalysisSchema>;

export const DeckEntrySchema = z.object({
  cardId: z.uuid(),
  /** The preferred print; null: any. */
  printId: z.uuid().nullable(),
  zone: DeckZoneSchema,
  quantity: z.number().int().min(1),
  /** Name in the user's language, else English. */
  name: z.string(),
  typeLine: z.string().nullable(),
  /** List group: `monster`, `spell`, `trap`; `creature`, `land`, …; `pokemon`, `trainer`, `energy`. */
  group: z.string(),
  /** Level, rank, link rating (Yu-Gi-Oh!), mana value (Magic) or HP (Pokémon). */
  stat: z
    .object({ kind: z.enum(['level', 'rank', 'link', 'mana', 'hp']), value: z.number() })
    .nullable(),
  /** The print shown: the preferred one, else the cheapest. */
  print: z
    .object({ id: z.uuid(), setCode: z.string(), number: z.string(), imageUrl: z.url().nullable() })
    .nullable(),
  /** Copies of this card's name in the collection (any print). */
  owned: z.number().int(),
  /** Copies of this card's name the format allows (0: banned); null: any number. */
  limit: z.number().int().nullable(),
  /** One copy, from the print shown; null without a price. */
  price: EntryPriceSchema.nullable(),
});
export type DeckEntry = z.infer<typeof DeckEntrySchema>;

export const DeckSchema = z.object({
  id: z.uuid(),
  game: DeckGameSchema,
  name: z.string(),
  format: z.string(),
  description: z.string().nullable(),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type Deck = z.infer<typeof DeckSchema>;

/** `GET /decks/:id` and every write's answer: the deck, its entries and the analysis. */
export const DeckDetailSchema = DeckSchema.extend({
  entries: z.array(DeckEntrySchema),
  analysis: DeckAnalysisSchema,
});
export type DeckDetail = z.infer<typeof DeckDetailSchema>;

/** `GET /decks`: newest change first, with the verdict and the value. */
export const DecksResponseSchema = z.object({
  decks: z.array(
    DeckSchema.extend({
      valid: z.boolean(),
      problems: z.number().int(),
      /** Copies in the main deck. */
      cards: z.number().int(),
      /** Copies the collection lacks. */
      missing: z.number().int(),
      value: ValueGroupSchema,
    }),
  ),
});
export type DecksResponse = z.infer<typeof DecksResponseSchema>;
export type DeckSummary = DecksResponse['decks'][number];

const NameSchema = z.string().trim().min(1).max(80);
const DescriptionSchema = z.string().trim().max(2000);

/** `POST /decks`; `id` is the client's (generated when absent). The format must be the game's. */
export const CreateDeckRequestSchema = z
  .strictObject({
    id: z.uuid().optional(),
    game: DeckGameSchema,
    name: NameSchema,
    format: z.string().optional(),
    description: DescriptionSchema.nullable().optional(),
  })
  .transform((d) => ({ ...d, format: d.format ?? DECK_FORMATS[d.game][0] }))
  .refine((d) => (DECK_FORMATS[d.game] as readonly string[]).includes(d.format), {
    message: 'Unknown format for this game',
    path: ['format'],
  });
export type CreateDeckRequest = z.input<typeof CreateDeckRequestSchema>;
export type CreateDeckData = z.output<typeof CreateDeckRequestSchema>;

/** `PATCH /decks/:id`; a format is checked against the deck's game by the store. */
export const UpdateDeckRequestSchema = z
  .strictObject({
    name: NameSchema,
    format: z.string().max(32),
    description: DescriptionSchema.nullable(),
  })
  .partial();
export type UpdateDeckRequest = z.infer<typeof UpdateDeckRequestSchema>;

/** One line of `PUT /decks/:id/entries`; a card appears once per zone. */
export const DeckEntryInputSchema = z.strictObject({
  cardId: z.uuid(),
  printId: z.uuid().nullable().optional(),
  zone: DeckZoneSchema,
  quantity: z.number().int().min(1).max(99),
});
export type DeckEntryInput = z.input<typeof DeckEntryInputSchema>;

/** `PUT /decks/:id/entries`: the whole list (replaces the old one). */
export const PutDeckEntriesRequestSchema = z.strictObject({
  entries: z
    .array(DeckEntryInputSchema)
    .max(500)
    .refine(
      (list) => new Set(list.map((e) => `${e.cardId}:${e.zone}`)).size === list.length,
      'A card appears once per zone',
    ),
});
export type PutDeckEntriesRequest = z.input<typeof PutDeckEntriesRequestSchema>;

/** `?currency=` of the deck reads: picks the price source; the user's currency by default. */
export const DeckQuerySchema = z.object({ currency: CurrencySchema.optional() });
