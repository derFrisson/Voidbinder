import { sql } from 'drizzle-orm';
import {
  customType,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  smallint,
  text,
  timestamp,
  unique,
  uuid,
} from 'drizzle-orm/pg-core';

// The card catalog for every game (VB-26). Importers upsert keyed on the unique constraints and
// touch `updated_at` only when `source_hash` (hash of the normalized source payload) changes.

const tsvector = customType<{ data: string }>({ dataType: () => 'tsvector' });

type Json = Record<string, unknown>;

const timestamps = {
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
};

/** 'mtg' | 'pokemon' | 'yugioh' | 'onepiece', seeded by the migration. */
export const games = pgTable('games', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  sort: smallint('sort').notNull(),
});

export const sets = pgTable(
  'sets',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    code: text('code').notNull(),
    /** English name; other languages in set_localizations. */
    name: text('name').notNull(),
    releasedOn: date('released_on'),
    cardCount: integer('card_count'),
    /** The source's set type (core, expansion, promo, …). */
    kind: text('kind'),
    externalIds: jsonb('external_ids').$type<Json>().notNull().default({}),
    imageKey: text('image_key'),
    sourceHash: text('source_hash'),
    ...timestamps,
  },
  (t) => [
    unique('sets_game_id_code_key').on(t.gameId, t.code),
    index('sets_game_id_idx').on(t.gameId),
    // The search's code lookup (VB-79, catalog_code_key in drizzle/0010_search.sql).
    index('sets_code_key_idx').on(sql`catalog_code_key(${t.code})`),
  ],
);

export const setLocalizations = pgTable(
  'set_localizations',
  {
    setId: uuid('set_id')
      .notNull()
      .references(() => sets.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    name: text('name').notNull(),
  },
  (t) => [primaryKey({ columns: [t.setId, t.lang] })],
);

export const cards = pgTable(
  'cards',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    gameId: text('game_id')
      .notNull()
      .references(() => games.id),
    /** English canonical name. */
    name: text('name').notNull(),
    /** The source's card identity (Scryfall oracle_id for Magic). */
    oracleKey: text('oracle_key').notNull(),
    typeLine: text('type_line'),
    text: text('text'),
    /** Game-specific fields as the source gives them (mana cost, HP, attack, …). */
    attributes: jsonb('attributes').$type<Json>().notNull().default({}),
    /** Format → status (Magic only for now). */
    legalities: jsonb('legalities').$type<Record<string, string>>().notNull().default({}),
    sourceHash: text('source_hash'),
    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(type_line, '') || ' ' || coalesce(text, ''))`,
    ),
    ...timestamps,
  },
  (t) => [
    unique('cards_game_id_oracle_key_key').on(t.gameId, t.oracleKey),
    index('cards_game_id_idx').on(t.gameId),
    index('cards_search_idx').using('gin', t.search),
    // Name prefixes and typos (VB-79, pg_trgm).
    index('cards_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
  ],
);

/**
 * One row per set + collector number + variant; language and finish are dimensions of prices, not
 * prints. `variant` is '' for Magic and Pokémon; Yu-Gi-Oh! prints one code in several rarities,
 * each a card of its own, so its variant is the rarity slug (`secret-rare`).
 */
export const prints = pgTable(
  'prints',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id),
    setId: uuid('set_id')
      .notNull()
      .references(() => sets.id),
    /** Collector number as printed. */
    number: text('number').notNull(),
    variant: text('variant').notNull().default(''),
    rarity: text('rarity'),
    /** 'normal' | 'foil' | 'etched' | 'holo' | 'reverse' | 'first_edition' | … */
    finishes: text('finishes')
      .array()
      .notNull()
      .default(sql`'{}'::text[]`),
    artist: text('artist'),
    /** R2 key of the English image (VB-57); the source URLs sit in external_ids until then. */
    imageKey: text('image_key'),
    externalIds: jsonb('external_ids').$type<Json>().notNull().default({}),
    releasedOn: date('released_on'),
    sourceHash: text('source_hash'),
    ...timestamps,
  },
  (t) => [
    unique('prints_set_id_number_variant_key').on(t.setId, t.number, t.variant),
    index('prints_card_id_idx').on(t.cardId),
    index('prints_set_id_idx').on(t.setId),
    // Price mapping (VB-30) looks prints up by TCGplayer product id.
    index('prints_tcgplayer_idx').on(sql`(${t.externalIds}->>'tcgplayer')`),
    // The search's number lookup (`121`, `001/128`; VB-79, drizzle/0010_search.sql).
    index('prints_number_key_idx').on(sql`catalog_number_key(${t.number})`),
  ],
);

export const printLocalizations = pgTable(
  'print_localizations',
  {
    printId: uuid('print_id')
      .notNull()
      .references(() => prints.id, { onDelete: 'cascade' }),
    lang: text('lang').notNull(),
    name: text('name').notNull(),
    text: text('text'),
    imageKey: text('image_key'),
    externalIds: jsonb('external_ids').$type<Json>().notNull().default({}),
    search: tsvector('search').generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(name, '') || ' ' || coalesce(text, ''))`,
    ),
  },
  (t) => [
    primaryKey({ columns: [t.printId, t.lang] }),
    index('print_localizations_search_idx').using('gin', t.search),
    index('print_localizations_name_trgm_idx').using('gin', t.name.op('gin_trgm_ops')),
  ],
);

/**
 * Every change of a card's legality status in a format (VB-81), written by the trigger
 * `record_legality_changes` (drizzle/0011_legality_changes.sql) on any update of
 * `cards.legalities`, whichever importer writes it; a new card gets no row. A status that
 * appears or disappears has a null on that side.
 */
export const legalityChanges = pgTable(
  'legality_changes',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    cardId: uuid('card_id')
      .notNull()
      .references(() => cards.id, { onDelete: 'cascade' }),
    format: text('format').notNull(),
    fromStatus: text('from_status'),
    toStatus: text('to_status'),
    seenAt: timestamp('seen_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('legality_changes_format_seen_at_idx').on(t.format, t.seenAt.desc())],
);

export const importRuns = pgTable('import_runs', {
  id: uuid('id').primaryKey().defaultRandom(),
  source: text('source').notNull(),
  /** 'full' | 'delta' | 'images' */
  kind: text('kind').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
  /** 'running' | 'ok' | 'failed' */
  status: text('status').notNull().default('running'),
  stats: jsonb('stats').$type<Json>().notNull().default({}),
  error: text('error'),
});
