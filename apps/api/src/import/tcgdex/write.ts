import { and, eq, inArray, sql } from 'drizzle-orm';
import {
  cards,
  importRuns,
  printLocalizations,
  prints,
  setLocalizations,
  sets,
} from '../../db/schema';
import { batches, sourceHash } from '../util';
import {
  addStats,
  BATCH_SIZE,
  excluded,
  failRun,
  finishRun,
  touched,
  wasInserted,
  writeStats,
  ZERO,
  type Db,
  type WriteStats,
} from '../scryfall/write';
import {
  mapCard,
  mapLocalization,
  mapPrint,
  type LocalizationRow,
  type PrintRow,
  type SetRow,
} from './map';
import type { TcgdexCard } from './types';

// Database writes of the TCGdex import. Every write is an upsert keyed on a unique constraint that
// leaves the row (and its updated_at) alone when the source hash is unchanged. The run bookkeeping
// (`finishRun` bumps catalog_version) and the write helpers are the Scryfall importer's.

export { BATCH_SIZE, failRun, finishRun, type Db, type WriteStats };

const GAME = 'pokemon';

export async function startRun(db: Db, kind: 'full' | 'delta' | 'images'): Promise<string> {
  const [run] = await db
    .insert(importRuns)
    .values({ source: 'tcgdex', kind })
    .returning({ id: importRuns.id });
  if (!run) throw new Error('import_runs insert returned no row');
  return run.id;
}

export interface SetInput {
  row: SetRow;
  /** The set's name per language TCGdex has it in (English first). */
  names: { lang: string; name: string }[];
}

export async function upsertSets(db: Db, inputs: SetInput[]) {
  let stats = ZERO;
  for (const batch of batches(inputs, BATCH_SIZE)) {
    const values = await Promise.all(
      batch.map(async ({ row }) => ({ ...row, gameId: GAME, sourceHash: await sourceHash(row) })),
    );
    await db.transaction(async (tx) => {
      const returned = await tx
        .insert(sets)
        .values(values)
        .onConflictDoUpdate({
          target: [sets.gameId, sets.code],
          set: {
            name: excluded('name'),
            releasedOn: excluded('released_on'),
            cardCount: excluded('card_count'),
            kind: excluded('kind'),
            // Drops the marks of `markSet` too: the set's details changed, so it is refetched.
            externalIds: excluded('external_ids'),
            sourceHash: excluded('source_hash'),
            ...touched,
          },
          setWhere: sql`${sets.sourceHash} is distinct from excluded.source_hash`,
        })
        .returning(wasInserted);
      stats = addStats(stats, writeStats(returned, values.length));
      const ids = await tx
        .select({ id: sets.id, code: sets.code })
        .from(sets)
        .where(
          and(
            eq(sets.gameId, GAME),
            inArray(
              sets.code,
              batch.map((b) => b.row.code),
            ),
          ),
        );
      const idByCode = new Map(ids.map((s) => [s.code, s.id]));
      const localizations = batch.flatMap(({ row, names }) =>
        names.map(({ lang, name }) => ({ setId: idByCode.get(row.code) as string, lang, name })),
      );
      await tx
        .insert(setLocalizations)
        .values(localizations)
        .onConflictDoUpdate({
          target: [setLocalizations.setId, setLocalizations.lang],
          set: { name: excluded('name') },
          setWhere: sql`${setLocalizations.name} is distinct from excluded.name`,
        });
    });
  }
  return stats;
}

/** Card ids TCGdex lists but answers 404 for, per language. */
export type MissingCards = Record<string, string[]>;

export interface SetState {
  prints: number;
  /** Localization rows per language. */
  localizations: Record<string, number>;
  /** The set-detail hash of the last run that imported every card of the set. */
  detailHash?: string | undefined;
  missingCards?: MissingCards | undefined;
}

/**
 * Records in `sets.external_ids` that every card of the set was imported: the hash of the set
 * details it was imported from (`detail_hash`) and the cards TCGdex could not deliver
 * (`missing_cards`), so neither makes the next incremental run refetch the set.
 */
export async function markSet(
  db: Db,
  code: string,
  marks: { detail_hash: string; missing_cards: MissingCards },
) {
  await db
    .update(sets)
    .set({ externalIds: sql`${sets.externalIds} || ${JSON.stringify(marks)}::jsonb` })
    .where(and(eq(sets.gameId, GAME), eq(sets.code, code)));
}

/** What the catalog holds per set code: the incremental run compares it with TCGdex's lists. */
export async function setStates(db: Db): Promise<Map<string, SetState>> {
  const [printCounts, localizationCounts] = await Promise.all([
    db
      .select({
        code: sets.code,
        n: sql<number>`count(${prints.id})::int`,
        detailHash: sql<string | null>`${sets.externalIds}->>'detail_hash'`,
        missingCards: sql<MissingCards | null>`${sets.externalIds}->'missing_cards'`,
      })
      .from(sets)
      .leftJoin(prints, eq(prints.setId, sets.id))
      .where(eq(sets.gameId, GAME))
      .groupBy(sets.id),
    db
      .select({ code: sets.code, lang: printLocalizations.lang, n: sql<number>`count(*)::int` })
      .from(printLocalizations)
      .innerJoin(prints, eq(prints.id, printLocalizations.printId))
      .innerJoin(sets, eq(sets.id, prints.setId))
      .where(eq(sets.gameId, GAME))
      .groupBy(sets.code, printLocalizations.lang),
  ]);
  const states = new Map<string, SetState>(
    printCounts.map((r) => [
      r.code,
      {
        prints: r.n,
        localizations: {},
        detailHash: r.detailHash ?? undefined,
        missingCards: r.missingCards ?? undefined,
      },
    ]),
  );
  for (const r of localizationCounts) {
    const state = states.get(r.code);
    if (state) state.localizations[r.lang] = r.n;
  }
  return states;
}

export interface CardChunkStats {
  cards: WriteStats;
  prints: WriteStats;
  /** Localization rows inserted or changed. */
  localizations: number;
  /** Cards TCGdex lists but answers 404 for in English: not imported. */
  missing: number;
}

export interface CardChunk {
  setCode: string;
  releaseDate?: string | undefined;
  /** Card ids of the chunk; `en[i]` is null when TCGdex answered 404. */
  en: (TcgdexCard | null)[];
  /** The same cards in other languages by language; null or absent: no such localization. */
  other: Record<string, (TcgdexCard | null)[]>;
}

/** One card, one print (a Pokémon card has one printing): cards, prints, localizations. */
export async function importCardChunk(db: Db, chunk: CardChunk): Promise<CardChunkStats> {
  const [set] = await db
    .select({ id: sets.id })
    .from(sets)
    .where(and(eq(sets.gameId, GAME), eq(sets.code, chunk.setCode)));
  if (!set) throw new Error(`set ${chunk.setCode} is not in the catalog`);

  const items: { card: TcgdexCard; localizations: LocalizationRow[] }[] = [];
  let missing = 0;
  chunk.en.forEach((card, i) => {
    if (!card) return void missing++;
    const localizations = [mapLocalization(card, 'en')];
    for (const [lang, list] of Object.entries(chunk.other)) {
      const other = list[i];
      if (other) localizations.push(mapLocalization(other, lang));
    }
    items.push({ card, localizations });
  });
  const stats: CardChunkStats = { cards: ZERO, prints: ZERO, localizations: 0, missing };
  if (!items.length) return stats;

  const cardValues = await Promise.all(
    items.map(async ({ card }) => {
      const row = mapCard(card);
      return { ...row, gameId: GAME, sourceHash: await sourceHash(row) };
    }),
  );
  await db.transaction(async (tx) => {
    const returnedCards = await tx
      .insert(cards)
      .values(cardValues)
      .onConflictDoUpdate({
        target: [cards.gameId, cards.oracleKey],
        set: {
          name: excluded('name'),
          typeLine: excluded('type_line'),
          text: excluded('text'),
          attributes: excluded('attributes'),
          legalities: excluded('legalities'),
          sourceHash: excluded('source_hash'),
          ...touched,
        },
        setWhere: sql`${cards.sourceHash} is distinct from excluded.source_hash`,
      })
      .returning(wasInserted);
    stats.cards = writeStats(returnedCards, cardValues.length);

    const cardIds = new Map(
      (
        await tx
          .select({ id: cards.id, key: cards.oracleKey })
          .from(cards)
          .where(
            and(
              eq(cards.gameId, GAME),
              inArray(
                cards.oracleKey,
                cardValues.map((c) => c.oracleKey),
              ),
            ),
          )
      ).map((r) => [r.key, r.id]),
    );
    const printValues = await Promise.all(
      items.map(async ({ card }) => {
        const print: PrintRow = mapPrint(card, chunk.releaseDate);
        const cardId = cardIds.get(card.id);
        if (!cardId) throw new Error(`card ${card.id} missing after upsert`);
        return {
          ...print,
          // One Pokémon card is one print: no variants.
          variant: '',
          setId: set.id,
          cardId,
          sourceHash: await sourceHash({ print, oracleKey: card.id }),
        };
      }),
    );
    const returnedPrints = await tx
      .insert(prints)
      .values(printValues)
      .onConflictDoUpdate({
        target: [prints.setId, prints.number, prints.variant],
        set: {
          cardId: excluded('card_id'),
          rarity: excluded('rarity'),
          finishes: excluded('finishes'),
          artist: excluded('artist'),
          externalIds: excluded('external_ids'),
          releasedOn: excluded('released_on'),
          sourceHash: excluded('source_hash'),
          ...touched,
        },
        setWhere: sql`${prints.sourceHash} is distinct from excluded.source_hash`,
      })
      .returning(wasInserted);
    stats.prints = writeStats(returnedPrints, printValues.length);

    const printIds = new Map(
      (
        await tx
          .select({ id: prints.id, number: prints.number })
          .from(prints)
          .where(
            and(
              eq(prints.setId, set.id),
              eq(prints.variant, ''),
              inArray(
                prints.number,
                printValues.map((p) => p.number),
              ),
            ),
          )
      ).map((r) => [r.number, r.id]),
    );
    const localizationValues = items.flatMap(({ card, localizations }) => {
      const printId = printIds.get(card.localId);
      if (!printId) throw new Error(`print ${card.id} missing after upsert`);
      return localizations.map((l) => ({ ...l, printId }));
    });
    const returnedLocalizations = await tx
      .insert(printLocalizations)
      .values(localizationValues)
      .onConflictDoUpdate({
        target: [printLocalizations.printId, printLocalizations.lang],
        set: {
          name: excluded('name'),
          text: excluded('text'),
          externalIds: excluded('external_ids'),
        },
        setWhere: sql`(${printLocalizations.name}, ${printLocalizations.text}, ${printLocalizations.externalIds})
          is distinct from (excluded.name, excluded.text, excluded.external_ids)`,
      })
      .returning({ printId: printLocalizations.printId });
    stats.localizations = returnedLocalizations.length;
  });
  return stats;
}
