import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import {
  cards,
  importRuns,
  priceMappings,
  pricesCurrent,
  pricesDaily,
  prints,
  sets,
} from '../../db/schema';
import { batches } from '../util';
import { BATCH_SIZE, excluded, type Db } from '../scryfall/write';
import type { CandidatePrint, CatalogSet, MatchMethod } from './match';

// Database writes of the price pipeline. Timestamps come from the caller (`observedAt`), never
// from `now()`, so a price row says when the source saw it, not when it was written.

export async function startRun(db: Db, source: string): Promise<string> {
  const [run] = await db
    .insert(importRuns)
    .values({ source, kind: 'prices' })
    .returning({ id: importRuns.id });
  if (!run) throw new Error('import_runs insert returned no row');
  return run.id;
}

/** `stats.lastUpdated` of the last TCGCSV run that wrote prices, null before the first. */
export async function lastImportedUpdate(db: Db): Promise<string | null> {
  const [run] = await db
    .select({ lastUpdated: sql<string | null>`${importRuns.stats} ->> 'lastUpdated'` })
    .from(importRuns)
    .where(
      and(
        eq(importRuns.source, 'tcgcsv'),
        eq(importRuns.status, 'ok'),
        sql`not (${importRuns.stats} ? 'skipped')`,
      ),
    )
    .orderBy(desc(importRuns.startedAt))
    .limit(1);
  return run?.lastUpdated ?? null;
}

export async function gameSets(db: Db, game: string): Promise<CatalogSet[]> {
  const rows = await db
    .select({
      id: sets.id,
      code: sets.code,
      name: sets.name,
      group: sql<string | null>`${sets.externalIds} ->> 'tcgplayer_id'`,
      // TCGdex's (Pokémon): `abbreviation.official` and `serie.name`, kept by its importer.
      abbreviation: sql<string | null>`${sets.externalIds} -> 'abbreviation' ->> 'official'`,
      series: sql<string | null>`${sets.externalIds} -> 'serie' ->> 'name'`,
    })
    .from(sets)
    .where(eq(sets.gameId, game));
  return rows.map(({ group, ...s }) => ({ ...s, tcgplayerGroupId: group ? Number(group) : null }));
}

/**
 * The prints a group's products may be: the prints of its sets, and with `productIds` (Magic)
 * every print that carries one of those TCGplayer ids, whichever set it is in.
 */
export async function candidatePrints(
  db: Db,
  setIds: string[],
  productIds: string[] = [],
): Promise<CandidatePrint[]> {
  const tcgplayer = sql<string | null>`${prints.externalIds} ->> 'tcgplayer'`;
  const where = productIds.length
    ? sql`(${inArray(prints.setId, setIds)} or ${tcgplayer} in (${sql.join(
        productIds.map((id) => sql`${id}`),
        sql`, `,
      )}))`
    : inArray(prints.setId, setIds);
  return db
    .select({
      id: prints.id,
      number: prints.number,
      variant: prints.variant,
      name: cards.name,
      tcgplayer,
      tcgplayerEtched: sql<string | null>`${prints.externalIds} ->> 'tcgplayer_etched'`,
    })
    .from(prints)
    .innerJoin(cards, eq(cards.id, prints.cardId))
    .where(where);
}

export interface MappingRow {
  printId: string;
  source: string;
  externalId: string;
  finish: string;
  /** The language of the copies the product is (VB-103); 'en' for TCGplayer. */
  lang: string;
  method: MatchMethod;
  confidence: number;
}

/**
 * Writes automatic mappings. A manual one is never touched: neither its print's row nor its
 * external id is taken over. One product and finish may map to several prints (VB-110: the
 * Yu-Gi-Oh! regional prints); an automatic mapping of it to a print today's rows no longer name
 * (yesterday's guess) is dropped.
 */
export async function upsertMappings(db: Db, rows: MappingRow[]): Promise<number> {
  // One row per primary key, or the INSERT conflicts with itself.
  const unique = [
    ...new Map(rows.map((r) => [`${r.printId}|${r.source}|${r.finish}|${r.lang}`, r])).values(),
  ];
  if (!unique.length) return 0;
  const key = (r: { externalId: string; finish: string; lang: string }) =>
    `${r.externalId}|${r.finish}|${r.lang}`;
  // The prints of each external id, finish and language today, whichever batch they fall in.
  const wanted = new Map<string, Set<string>>();
  for (const r of unique) wanted.set(key(r), (wanted.get(key(r)) ?? new Set()).add(r.printId));
  let written = 0;
  for (const batch of batches(unique, BATCH_SIZE)) {
    await db.transaction(async (tx) => {
      // ponytail: every caller passes one source per call.
      const source = batch[0]?.source ?? '';
      const held = await tx
        .select()
        .from(priceMappings)
        .where(
          and(
            eq(priceMappings.source, source),
            inArray(
              priceMappings.externalId,
              batch.map((r) => r.externalId),
            ),
          ),
        );
      // An external id an admin gave a print stays that print's alone.
      const manual = new Map(
        held.flatMap((h) => (h.method === 'manual' ? [[key(h), h.printId] as const] : [])),
      );
      for (const h of held) {
        const today = wanted.get(key(h));
        if (h.method === 'manual' || !today || today.has(h.printId)) continue;
        await tx
          .delete(priceMappings)
          .where(
            and(
              eq(priceMappings.printId, h.printId),
              eq(priceMappings.source, h.source),
              eq(priceMappings.finish, h.finish),
              eq(priceMappings.lang, h.lang),
            ),
          );
      }
      const values = batch.filter((r) => (manual.get(key(r)) ?? r.printId) === r.printId);
      if (!values.length) return;
      const returned = await tx
        .insert(priceMappings)
        .values(values)
        .onConflictDoUpdate({
          target: [
            priceMappings.printId,
            priceMappings.source,
            priceMappings.finish,
            priceMappings.lang,
          ],
          set: {
            externalId: excluded('external_id'),
            confidence: excluded('confidence'),
            method: excluded('method'),
            updatedAt: sql`now()`,
          },
          setWhere: sql`${priceMappings.method} <> 'manual' and
            (${priceMappings.externalId}, ${priceMappings.confidence}, ${priceMappings.method})
              is distinct from (excluded.external_id, excluded.confidence, excluded.method)`,
        })
        .returning({ printId: priceMappings.printId });
      written += returned.length;
    });
  }
  return written;
}

/** Mapped prints of `source` keyed `${externalId}|${finish}`, manual ones included. */
export async function resolveMappings(
  db: Db,
  source: string,
  externalIds: string[],
): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  for (const batch of batches([...new Set(externalIds)], 5000)) {
    const rows = await db
      .select({
        printId: priceMappings.printId,
        externalId: priceMappings.externalId,
        finish: priceMappings.finish,
      })
      .from(priceMappings)
      .where(and(eq(priceMappings.source, source), inArray(priceMappings.externalId, batch)));
    for (const r of rows) {
      const k = `${r.externalId}|${r.finish}`;
      out.set(k, [...(out.get(k) ?? []), r.printId]);
    }
  }
  return out;
}

export interface PriceRow {
  printId: string;
  finish: string;
  source: string;
  /** The language of the copies the price is for (VB-103); 'en' for TCGplayer. */
  lang: string;
  currency: string;
  market: number;
  low?: number | null;
  mid?: number | null;
  high?: number | null;
}

/** Midnight UTC of the day of `observedAt`: the key of one `prices_daily` row per day. */
export const dayOf = (observedAt: string) => `${observedAt.slice(0, 10)}T00:00:00.000Z`;

/**
 * Upserts `prices_current` (an older observation never replaces a newer one) and the day's
 * `prices_daily` row. Idempotent: the same rows again change nothing.
 */
export async function writePrices(db: Db, rows: PriceRow[], observedAt: string): Promise<number> {
  const unique = [
    ...new Map(rows.map((r) => [`${r.printId}|${r.finish}|${r.source}|${r.lang}`, r])).values(),
  ];
  const day = new Date(dayOf(observedAt));
  const at = new Date(observedAt);
  for (const batch of batches(unique, BATCH_SIZE)) {
    await db.transaction(async (tx) => {
      await tx
        .insert(pricesCurrent)
        .values(
          batch.map((r) => ({
            printId: r.printId,
            finish: r.finish,
            source: r.source,
            lang: r.lang,
            currency: r.currency,
            centsMarket: r.market,
            centsLow: r.low ?? null,
            centsMid: r.mid ?? null,
            centsHigh: r.high ?? null,
            observedAt: at,
          })),
        )
        .onConflictDoUpdate({
          target: [
            pricesCurrent.printId,
            pricesCurrent.finish,
            pricesCurrent.source,
            pricesCurrent.lang,
          ],
          set: {
            currency: excluded('currency'),
            centsMarket: excluded('cents_market'),
            centsLow: excluded('cents_low'),
            centsMid: excluded('cents_mid'),
            centsHigh: excluded('cents_high'),
            observedAt: excluded('observed_at'),
          },
          setWhere: sql`excluded.observed_at >= ${pricesCurrent.observedAt}`,
        });
      await tx
        .insert(pricesDaily)
        .values(
          batch.map((r) => ({
            observedAt: day,
            printId: r.printId,
            finish: r.finish,
            source: r.source,
            lang: r.lang,
            currency: r.currency,
            centsMarket: r.market,
            centsLow: r.low ?? null,
            centsHigh: r.high ?? null,
          })),
        )
        .onConflictDoUpdate({
          target: [
            pricesDaily.printId,
            pricesDaily.finish,
            pricesDaily.source,
            pricesDaily.lang,
            pricesDaily.observedAt,
          ],
          set: {
            currency: excluded('currency'),
            centsMarket: excluded('cents_market'),
            centsLow: excluded('cents_low'),
            centsHigh: excluded('cents_high'),
          },
        });
    });
  }
  return unique.length;
}
