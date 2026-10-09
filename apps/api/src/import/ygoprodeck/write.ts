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
import { BATCH_SIZE, failRun, finishRun, type Db, type WriteStats } from '../scryfall/write';
import type { LocalizationRow } from '../scryfall/map';
import { mapCard, mapLocalization, mapPrints, mapSets, setKey, type MappedPrint } from './map';
import type { YgoCard, YgoSet } from './types';

// Database writes of the YGOPRODeck import. Every write is an upsert keyed on a unique constraint
// that leaves the row (and its updated_at) alone when the source hash is unchanged. The run
// bookkeeping is the Scryfall importer's (`finishRun` bumps catalog_version).

export { BATCH_SIZE, failRun, finishRun, type Db, type WriteStats };
type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const GAME = 'yugioh';

const excluded = (column: string) => sql.raw(`excluded."${column}"`);
const touched = { updatedAt: sql`now()` };
/** `xmax = 0` holds for a row this statement inserted, not for one it updated. */
const wasInserted = { inserted: sql<boolean>`(xmax = 0)` };
const ZERO: WriteStats = { inserted: 0, updated: 0, unchanged: 0 };

const addStats = (a: WriteStats, b: WriteStats): WriteStats => ({
  inserted: a.inserted + b.inserted,
  updated: a.updated + b.updated,
  unchanged: a.unchanged + b.unchanged,
});

function writeStats(returned: { inserted: boolean }[], total: number): WriteStats {
  const inserted = returned.filter((r) => r.inserted).length;
  return { inserted, updated: returned.length - inserted, unchanged: total - returned.length };
}

export async function startRun(db: Db): Promise<string> {
  const [run] = await db
    .insert(importRuns)
    .values({ source: 'ygoprodeck', kind: 'full' })
    .returning({ id: importRuns.id });
  if (!run) throw new Error('import_runs insert returned no row');
  return run.id;
}

export async function upsertSets(db: Db, source: YgoSet[]) {
  const rows = mapSets(source);
  let stats = ZERO;
  for (const batch of batches(rows, BATCH_SIZE)) {
    const values = await Promise.all(
      batch.map(async (r) => ({ ...r, gameId: GAME, sourceHash: await sourceHash(r) })),
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
            externalIds: excluded('external_ids'),
            sourceHash: excluded('source_hash'),
            ...touched,
          },
          setWhere: sql`${sets.sourceHash} is distinct from excluded.source_hash`,
        })
        .returning(wasInserted);
      stats = addStats(stats, writeStats(returned, values.length));
      await upsertSetNames(
        tx,
        values.map((v) => v.code),
      );
    });
  }
  return { ...stats, entries: source.length };
}

/** The English `set_localizations` row of each set code, from the set's current name. */
async function upsertSetNames(tx: Tx, codes: string[]) {
  const ids = await tx
    .select({ id: sets.id, name: sets.name })
    .from(sets)
    .where(and(eq(sets.gameId, GAME), inArray(sets.code, codes)));
  if (!ids.length) return;
  await tx
    .insert(setLocalizations)
    .values(ids.map((s) => ({ setId: s.id, lang: 'en', name: s.name })))
    .onConflictDoUpdate({
      target: [setLocalizations.setId, setLocalizations.lang],
      set: { name: excluded('name') },
      setWhere: sql`${setLocalizations.name} is distinct from excluded.name`,
    });
}

async function upsertLocalizations(tx: Tx, rows: (LocalizationRow & { printId: string })[]) {
  let written = 0;
  for (const batch of batches(rows, BATCH_SIZE)) {
    const returned = await tx
      .insert(printLocalizations)
      .values(batch)
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
    written += returned.length;
  }
  return written;
}

export interface CardChunkStats {
  cards: WriteStats;
  prints: WriteStats;
  /** Localization rows inserted or changed. */
  localizations: number;
  /** Sets the sets list lacks, created from a card's own `set_name`. */
  setsCreated: number;
  skipped: {
    /** Cards in no set (tokens, Skill Cards, OCG-only cards): not collectible, not imported. */
    noSets: number;
    /** Prints whose set and number another card already holds (the source lists a code twice). */
    codeConflicts: number;
  };
}

interface PendingPrint extends MappedPrint {
  oracleKey: string;
}

/**
 * Imports `cardinfo` (English) lines: cards, prints and the English localization of each print, in
 * transactions of BATCH_SIZE cards.
 */
export async function importCardLines(db: Db, lines: string[]): Promise<CardChunkStats> {
  const stats: CardChunkStats = {
    cards: ZERO,
    prints: ZERO,
    localizations: 0,
    setsCreated: 0,
    skipped: { noSets: 0, codeConflicts: 0 },
  };
  for (const batch of batches(lines, BATCH_SIZE)) {
    const cardRows = new Map<string, ReturnType<typeof mapCard>>();
    const printRows = new Map<string, PendingPrint>();
    const english = new Map<string, LocalizationRow>();
    for (const line of batch) {
      const source = JSON.parse(line) as YgoCard;
      if (!source.card_sets?.length) {
        stats.skipped.noSets++;
        continue;
      }
      const card = mapCard(source);
      cardRows.set(card.oracleKey, card);
      english.set(card.oracleKey, mapLocalization(source, 'en'));
      for (const mapped of mapPrints(source)) {
        const key = `${mapped.setCode}|${mapped.print.number}`;
        // Two cards under one code (the source's data): the first keeps it.
        if (printRows.has(key)) stats.skipped.codeConflicts++;
        else printRows.set(key, { ...mapped, oracleKey: card.oracleKey });
      }
    }
    if (!cardRows.size) continue;

    const cardValues = await Promise.all(
      [...cardRows.values()].map(async (c) => ({
        ...c,
        gameId: GAME,
        sourceHash: await sourceHash(c),
      })),
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
      stats.cards = addStats(stats.cards, writeStats(returnedCards, cardValues.length));

      const cardIds = new Map(
        (
          await tx
            .select({ id: cards.id, key: cards.oracleKey })
            .from(cards)
            .where(and(eq(cards.gameId, GAME), inArray(cards.oracleKey, [...cardRows.keys()])))
        ).map((r) => [r.key, r.id]),
      );

      // A set the sets list lacks is created from the card's `set_name` (never overwritten).
      const wanted = new Map(
        [...printRows.values()].map((p) => [
          setKey(p.setCode),
          { code: p.setCode, name: p.setName },
        ]),
      );
      const created = await tx
        .insert(sets)
        .values(
          [...wanted].map(([key, { code, name }]) => ({
            gameId: GAME,
            code: key,
            name,
            externalIds: { set_code: code },
          })),
        )
        .onConflictDoNothing({ target: [sets.gameId, sets.code] })
        .returning({ code: sets.code });
      stats.setsCreated += created.length;
      await upsertSetNames(
        tx,
        created.map((c) => c.code),
      );
      const setIds = new Map(
        (
          await tx
            .select({ id: sets.id, code: sets.code })
            .from(sets)
            .where(and(eq(sets.gameId, GAME), inArray(sets.code, [...wanted.keys()])))
        ).map((r) => [r.code, r.id]),
      );

      const mapped = [...printRows.values()];
      const printValues = await Promise.all(
        mapped.map(async ({ setCode, print, oracleKey }) => {
          const setId = setIds.get(setKey(setCode));
          const cardId = cardIds.get(oracleKey);
          if (!setId || !cardId) throw new Error(`set ${setCode} or card ${oracleKey} missing`);
          const value = {
            ...print,
            setId,
            cardId,
            sourceHash: await sourceHash({ print, oracleKey }),
          };
          return { value, oracleKey };
        }),
      );
      const values = printValues.map((p) => p.value);
      let printStats = ZERO;
      for (const slice of batches(values, BATCH_SIZE)) {
        const returned = await tx
          .insert(prints)
          .values(slice)
          .onConflictDoUpdate({
            target: [prints.setId, prints.number],
            set: {
              rarity: excluded('rarity'),
              finishes: excluded('finishes'),
              externalIds: excluded('external_ids'),
              sourceHash: excluded('source_hash'),
              ...touched,
            },
            // The card of a print never changes: a code another card holds stays with it.
            setWhere: sql`${prints.sourceHash} is distinct from excluded.source_hash
              and ${prints.cardId} = excluded.card_id`,
          })
          .returning(wasInserted);
        printStats = addStats(printStats, writeStats(returned, slice.length));
      }

      const stored = await tx
        .select({
          id: prints.id,
          setId: prints.setId,
          number: prints.number,
          cardId: prints.cardId,
        })
        .from(prints)
        .where(
          and(
            inArray(prints.setId, [...new Set(values.map((p) => p.setId))]),
            inArray(prints.number, [...new Set(values.map((p) => p.number))]),
          ),
        );
      const byKey = new Map(stored.map((r) => [`${r.setId}|${r.number}`, r]));
      const localizations: (LocalizationRow & { printId: string })[] = [];
      let heldByOther = 0;
      for (const { value: p, oracleKey } of printValues) {
        const row = byKey.get(`${p.setId}|${p.number}`);
        if (!row) throw new Error(`print ${p.setId} ${p.number} missing after upsert`);
        if (row.cardId !== p.cardId) {
          heldByOther++;
          continue;
        }
        const loc = english.get(oracleKey);
        if (loc) localizations.push({ ...loc, printId: row.id });
      }
      stats.skipped.codeConflicts += heldByOther;
      // A print another card holds is neither written nor "unchanged".
      stats.prints = addStats(stats.prints, {
        ...printStats,
        unchanged: printStats.unchanged - heldByOther,
      });
      stats.localizations += await upsertLocalizations(tx, localizations);
    });
  }
  return stats;
}

export interface LocalizationChunkStats {
  /** Localization rows inserted or changed. */
  written: number;
  /** Cards that are not in the catalog (no sets, or not in the English list). */
  noCard: number;
}

/**
 * Imports `cardinfo?language=<lang>` lines: the card's name and text in that language, as a
 * localization of every print of the card (the translation is the card's, not the print's).
 */
export async function importLocalizationLines(
  db: Db,
  lines: string[],
  lang: string,
): Promise<LocalizationChunkStats> {
  const stats: LocalizationChunkStats = { written: 0, noCard: 0 };
  for (const batch of batches(lines, BATCH_SIZE)) {
    const source = new Map(
      batch.map((l) => {
        const card = JSON.parse(l) as YgoCard;
        return [String(card.id), card] as const;
      }),
    );
    await db.transaction(async (tx) => {
      const found = await tx
        .select({ id: cards.id, key: cards.oracleKey })
        .from(cards)
        .where(and(eq(cards.gameId, GAME), inArray(cards.oracleKey, [...source.keys()])));
      stats.noCard += source.size - found.length;
      const keyById = new Map(found.map((c) => [c.id, c.key]));
      const owned = found.length
        ? await tx
            .select({ id: prints.id, cardId: prints.cardId })
            .from(prints)
            .where(inArray(prints.cardId, [...keyById.keys()]))
        : [];
      const rows = owned.map((p) => {
        const card = source.get(keyById.get(p.cardId) ?? '');
        if (!card) throw new Error(`card of print ${p.id} missing`);
        return { ...mapLocalization(card, lang), printId: p.id };
      });
      stats.written += await upsertLocalizations(tx, rows);
    });
  }
  return stats;
}
