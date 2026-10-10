import { and, eq, inArray, sql } from 'drizzle-orm';
import { cards, importRuns, printLocalizations, prints, sets } from '../../db/schema';
import { batches, sourceHash } from '../util';
import {
  addStats,
  BATCH_SIZE,
  excluded,
  failRun,
  finishRun,
  touched,
  upsertSetNames,
  wasInserted,
  writeStats,
  ZERO,
  type Db,
  type Tx,
  type WriteStats,
} from '../scryfall/write';
import type { LocalizationRow } from '../scryfall/map';
import {
  mapCard,
  mapLocalization,
  mapPrints,
  mapSets,
  printKey,
  setKey,
  type MappedPrint,
} from './map';
import type { YgoCard, YgoSet } from './types';

// Database writes of the YGOPRODeck import. Every write is an upsert keyed on a unique constraint
// that leaves the row (and its updated_at) alone when the source hash is unchanged. The run
// bookkeeping and the write helpers are the Scryfall importer's (`finishRun` bumps
// catalog_version).

export { BATCH_SIZE, failRun, finishRun, type Db, type WriteStats };

const GAME = 'yugioh';
/** Conflicting codes kept per run in `import_runs.stats.codeConflicts`. */
export const CONFLICTS_KEPT = 50;

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
        GAME,
        values.map((v) => v.code),
      );
    });
  }
  return { ...stats, entries: source.length };
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
  /** The first CONFLICTS_KEPT skipped prints: `<code> <rarity>: <card id that lost it>`. */
  codeConflicts: string[];
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
    codeConflicts: [],
  };
  const conflict = (p: MappedPrint, oracleKey: string) => {
    stats.skipped.codeConflicts++;
    if (stats.codeConflicts.length < CONFLICTS_KEPT)
      stats.codeConflicts.push(
        `${String(p.print.externalIds.set_code ?? `${p.setCode}-${p.print.number}`)} ${p.print.rarity ?? ''}: ${oracleKey}`,
      );
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
        const key = printKey(mapped.setCode, mapped.print.number, mapped.print.variant);
        // Two cards under one code and rarity (the source's data): the first keeps it.
        if (printRows.has(key)) conflict(mapped, card.oracleKey);
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
        GAME,
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
        mapped.map(async (m) => {
          const { setCode, print, oracleKey } = m;
          const setId = setIds.get(setKey(setCode));
          const cardId = cardIds.get(oracleKey);
          if (!setId || !cardId) throw new Error(`set ${setCode} or card ${oracleKey} missing`);
          const value = {
            ...print,
            setId,
            cardId,
            sourceHash: await sourceHash({ print, oracleKey }),
          };
          return { value, oracleKey, m };
        }),
      );
      const values = printValues.map((p) => p.value);
      let printStats = ZERO;
      for (const slice of batches(values, BATCH_SIZE)) {
        const returned = await tx
          .insert(prints)
          .values(slice)
          .onConflictDoUpdate({
            target: [prints.setId, prints.number, prints.variant],
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
          variant: prints.variant,
          cardId: prints.cardId,
        })
        .from(prints)
        .where(
          and(
            inArray(prints.setId, [...new Set(values.map((p) => p.setId))]),
            inArray(prints.number, [...new Set(values.map((p) => p.number))]),
          ),
        );
      const byKey = new Map(stored.map((r) => [`${r.setId}|${r.number}|${r.variant}`, r]));
      const localizations: (LocalizationRow & { printId: string })[] = [];
      let heldByOther = 0;
      for (const { value: p, oracleKey, m } of printValues) {
        const row = byKey.get(`${p.setId}|${p.number}|${p.variant}`);
        if (!row) throw new Error(`print ${p.setId} ${p.number} ${p.variant} missing after upsert`);
        if (row.cardId !== p.cardId) {
          heldByOther++;
          conflict(m, oracleKey);
          continue;
        }
        const loc = english.get(oracleKey);
        if (loc) localizations.push({ ...loc, printId: row.id });
      }
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
 * The catalog card each `cardinfo?language=` entry translates. The English list keys some cards
 * by an alternate artwork's passcode (Dark Magician is 46986420 there, 46986414 in the German
 * list, VB-93), so an entry whose own id is no card falls back to its artworks' ids, and only
 * when that card's English name is the entry's `name_en` (a Skill Card shares a regular card's
 * artwork id but not its name). A card matched by its own id never takes another entry of the
 * same `source`; importLocalizationLines calls this per batch of BATCH_SIZE lines, so an own-id
 * entry and a fallback to the same card in two batches would both be written, the later winning
 * (none in the 2026-10-10 dumps: 14 fallbacks, no conflict).
 */
export function matchLocalizedCards(
  source: YgoCard[],
  found: { id: string; key: string; name: string }[],
): Map<string, YgoCard> {
  const byKey = new Map(found.map((c) => [c.key, c]));
  const matched = new Map<string, YgoCard>();
  for (const entry of source) {
    const own = byKey.get(String(entry.id));
    if (own) matched.set(own.id, entry);
  }
  for (const entry of source) {
    if (byKey.has(String(entry.id))) continue;
    const card = (entry.card_images ?? [])
      .map((i) => byKey.get(String(i.id)))
      .find((c) => c && !matched.has(c.id) && c.name === entry.name_en);
    if (card) matched.set(card.id, entry);
  }
  return matched;
}

/**
 * Imports `cardinfo?language=<lang>` lines: the card's name and text in that language, as a
 * localization of every print of the card (the translation is the card's, not the print's). Every
 * run upserts the rows of every print, so a print added later gets its translation the next day.
 */
export async function importLocalizationLines(
  db: Db,
  lines: string[],
  lang: string,
): Promise<LocalizationChunkStats> {
  const stats: LocalizationChunkStats = { written: 0, noCard: 0 };
  for (const batch of batches(lines, BATCH_SIZE)) {
    const source = batch.map((l) => JSON.parse(l) as YgoCard);
    const keys = new Set(
      source.flatMap((c) => [String(c.id), ...(c.card_images ?? []).map((i) => String(i.id))]),
    );
    await db.transaction(async (tx) => {
      const found = await tx
        .select({ id: cards.id, key: cards.oracleKey, name: cards.name })
        .from(cards)
        .where(and(eq(cards.gameId, GAME), inArray(cards.oracleKey, [...keys])));
      const matched = matchLocalizedCards(source, found);
      stats.noCard += source.length - new Set(matched.values()).size;
      const owned = matched.size
        ? await tx
            .select({ id: prints.id, cardId: prints.cardId })
            .from(prints)
            .where(inArray(prints.cardId, [...matched.keys()]))
        : [];
      const rows = owned.map((p) => {
        const card = matched.get(p.cardId);
        if (!card) throw new Error(`card of print ${p.id} missing`);
        return { ...mapLocalization(card, lang), printId: p.id };
      });
      stats.written += await upsertLocalizations(tx, rows);
    });
  }
  return stats;
}
