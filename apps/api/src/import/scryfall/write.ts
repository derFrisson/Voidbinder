import { and, eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import {
  appMeta,
  cards,
  importRuns,
  printLocalizations,
  prints,
  setLocalizations,
  sets,
} from '../../db/schema';
import { batches, sourceHash } from '../util';
import {
  mapCard,
  mapLocalization,
  mapPrint,
  mapSet,
  skipReason,
  type CardRow,
  type LocalizationRow,
  type PrintRow,
} from './map';
import type { ScryfallCard, ScryfallSet } from './types';

// Database writes of the Scryfall import. Every write is an upsert keyed on a unique constraint
// that leaves the row (and its updated_at) alone when the source hash is unchanged.

export type Db = NodePgDatabase;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

const GAME = 'mtg';
/** Rows per upsert and per transaction. */
export const BATCH_SIZE = 500;

export interface WriteStats {
  inserted: number;
  updated: number;
  unchanged: number;
}

// The helpers below are shared by every importer's write module.

export const excluded = (column: string) => sql.raw(`excluded."${column}"`);
/** Set on insert and on a real change only (the setWhere of every upsert below). */
export const touched = { updatedAt: sql`now()` };

export function writeStats(returned: { inserted: boolean }[], total: number): WriteStats {
  const inserted = returned.filter((r) => r.inserted).length;
  return { inserted, updated: returned.length - inserted, unchanged: total - returned.length };
}

export function addStats(a: WriteStats, b: WriteStats): WriteStats {
  return {
    inserted: a.inserted + b.inserted,
    updated: a.updated + b.updated,
    unchanged: a.unchanged + b.unchanged,
  };
}

export const ZERO: WriteStats = { inserted: 0, updated: 0, unchanged: 0 };
/** `xmax = 0` holds for a row this statement inserted, not for one it updated. */
export const wasInserted = { inserted: sql<boolean>`(xmax = 0)` };

/** The English `set_localizations` row of each set code of `game`, from the set's current name. */
export async function upsertSetNames(tx: Tx, game: string, codes: string[]) {
  if (!codes.length) return;
  const ids = await tx
    .select({ id: sets.id, name: sets.name })
    .from(sets)
    .where(and(eq(sets.gameId, game), inArray(sets.code, codes)));
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

export async function startRun(db: Db, kind: 'full' | 'delta' | 'images'): Promise<string> {
  const [run] = await db
    .insert(importRuns)
    .values({ source: 'scryfall', kind })
    .returning({ id: importRuns.id });
  if (!run) throw new Error('import_runs insert returned no row');
  return run.id;
}

/**
 * Marks the run ok and bumps `catalog_version` in one transaction (ADR 0004; `bump: false` for a
 * run that changed nothing). Idempotent: a
 * retried step finds the run no longer `running` and bumps nothing.
 */
export async function finishRun(
  db: Db,
  runId: string,
  stats: Record<string, unknown>,
  { bump = true }: { bump?: boolean } = {},
) {
  await db.transaction(async (tx) => {
    const finished = await tx
      .update(importRuns)
      .set({ status: 'ok', finishedAt: sql`now()`, stats })
      .where(and(eq(importRuns.id, runId), eq(importRuns.status, 'running')))
      .returning({ id: importRuns.id });
    if (!finished.length || !bump) return;
    await tx
      .update(appMeta)
      .set({ value: sql`(${appMeta.value}::bigint + 1)::text`, updatedAt: sql`now()` })
      .where(eq(appMeta.key, 'catalog_version'));
  });
}

/** Marks a still running run failed; a finished run stays as it is. */
export async function failRun(db: Db, runId: string, error: string) {
  await db
    .update(importRuns)
    .set({ status: 'failed', finishedAt: sql`now()`, error: error.slice(0, 4000) })
    .where(and(eq(importRuns.id, runId), eq(importRuns.status, 'running')));
}

export async function upsertSets(db: Db, source: ScryfallSet[]) {
  const rows = source.map(mapSet).filter((r) => r !== null);
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
        GAME,
        values.map((v) => v.code),
      );
    });
  }
  return { ...stats, skipped: source.length - rows.length };
}

async function setIdsByCode(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: sets.id, code: sets.code })
    .from(sets)
    .where(eq(sets.gameId, GAME));
  return new Map(rows.map((r) => [r.code, r.id]));
}

/** Print ids keyed `${setId}|${number}`. */
async function printIds(tx: Tx | Db, keys: { setId: string; number: string }[]) {
  if (!keys.length) return new Map<string, string>();
  const rows = await tx
    .select({ id: prints.id, setId: prints.setId, number: prints.number })
    .from(prints)
    .where(
      and(
        inArray(prints.setId, [...new Set(keys.map((k) => k.setId))]),
        inArray(prints.number, [...new Set(keys.map((k) => k.number))]),
      ),
    );
  return new Map(rows.map((r) => [`${r.setId}|${r.number}`, r.id]));
}

async function upsertLocalizations(tx: Tx, rows: (LocalizationRow & { printId: string })[]) {
  if (!rows.length) return 0;
  const returned = await tx
    .insert(printLocalizations)
    .values(rows)
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
  return returned.length;
}

export interface CardChunkStats {
  cards: WriteStats;
  prints: WriteStats;
  /** Localization rows inserted or changed. */
  localizations: number;
  skipped: { layout: number; digital: number; noSet: number };
}

const faceCount = (card: CardRow) =>
  (card.attributes.card_faces as unknown[] | undefined)?.length ?? 0;

interface MappedPrint {
  setId: string;
  print: PrintRow;
  oracleKey: string;
  localization: LocalizationRow;
}

/**
 * Imports `default_cards` lines: cards, prints and the print's own-language localization, in
 * transactions of BATCH_SIZE objects.
 */
export async function importCardLines(db: Db, lines: string[]): Promise<CardChunkStats> {
  const setIds = await setIdsByCode(db);
  const stats: CardChunkStats = {
    cards: ZERO,
    prints: ZERO,
    localizations: 0,
    skipped: { layout: 0, digital: 0, noSet: 0 },
  };
  for (const batch of batches(lines, BATCH_SIZE)) {
    const cardRows = new Map<string, ReturnType<typeof mapCard>>();
    const printRows = new Map<string, MappedPrint>();
    for (const line of batch) {
      const source = JSON.parse(line) as ScryfallCard;
      const reason = skipReason(source);
      if (reason) {
        stats.skipped[reason]++;
        continue;
      }
      const setId = setIds.get(source.set);
      if (!setId) {
        stats.skipped.noSet++;
        continue;
      }
      const card = mapCard(source);
      // Every print repeats its card, some without the faces (Omen cards): the one with the most
      // faces writes it, the first of those on a tie, so the print order does not matter.
      const known = cardRows.get(card.oracleKey);
      if (!known || faceCount(card) > faceCount(known)) cardRows.set(card.oracleKey, card);
      printRows.set(`${setId}|${source.collector_number}`, {
        setId,
        print: mapPrint(source),
        oracleKey: card.oracleKey,
        localization: mapLocalization(source),
      });
    }
    if (!printRows.size) continue;

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
          // A batch with only face-less prints of a card never overwrites its faces.
          setWhere: sql`${cards.sourceHash} is distinct from excluded.source_hash
            and jsonb_array_length(coalesce(excluded.attributes -> 'card_faces', '[]'::jsonb))
              >= jsonb_array_length(coalesce(${cards.attributes} -> 'card_faces', '[]'::jsonb))`,
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

      const mapped = [...printRows.values()];
      const printValues = await Promise.all(
        mapped.map(async ({ setId, print, oracleKey }) => {
          const cardId = cardIds.get(oracleKey);
          if (!cardId) throw new Error(`card ${oracleKey} missing after upsert`);
          return { ...print, setId, cardId, sourceHash: await sourceHash({ print, oracleKey }) };
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
      stats.prints = addStats(stats.prints, writeStats(returnedPrints, printValues.length));

      const ids = await printIds(
        tx,
        mapped.map((m) => ({ setId: m.setId, number: m.print.number })),
      );
      stats.localizations += await upsertLocalizations(
        tx,
        mapped.map((m) => {
          const printId = ids.get(`${m.setId}|${m.print.number}`);
          if (!printId) throw new Error(`print ${m.setId} ${m.print.number} missing after upsert`);
          return { ...m.localization, printId };
        }),
      );
    });
  }
  return stats;
}

export interface LocalizationChunkStats {
  /** Localization rows inserted or changed. */
  written: number;
  /** Objects whose print is not in the catalog (skipped layouts, digital, unknown sets). */
  noPrint: number;
}

/** Imports `all_cards` lines in other languages as print_localizations of existing prints. */
export async function importLocalizationLines(
  db: Db,
  lines: string[],
): Promise<LocalizationChunkStats> {
  const setIds = await setIdsByCode(db);
  const stats: LocalizationChunkStats = { written: 0, noPrint: 0 };
  for (const batch of batches(lines, BATCH_SIZE)) {
    const rows: { setId: string; number: string; localization: LocalizationRow }[] = [];
    for (const line of batch) {
      const source = JSON.parse(line) as ScryfallCard;
      const setId = setIds.get(source.set);
      if (skipReason(source) || !setId) {
        stats.noPrint++;
        continue;
      }
      rows.push({ setId, number: source.collector_number, localization: mapLocalization(source) });
    }
    await db.transaction(async (tx) => {
      const ids = await printIds(tx, rows);
      // One row per print and language (the primary key), so a duplicate cannot hit twice.
      const values = new Map<string, LocalizationRow & { printId: string }>();
      for (const r of rows) {
        const printId = ids.get(`${r.setId}|${r.number}`);
        if (printId)
          values.set(`${printId}|${r.localization.lang}`, { ...r.localization, printId });
        else stats.noPrint++;
      }
      stats.written += await upsertLocalizations(tx, [...values.values()]);
    });
  }
  return stats;
}
