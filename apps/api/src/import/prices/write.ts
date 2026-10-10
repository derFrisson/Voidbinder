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

/**
 * `stats.lastUpdated` of the last TCGCSV run that imported a build in full, null before the
 * first: a failed run, one still `running` and one that lists failed groups (VB-116) never count,
 * so the next run pulls their build again.
 */
export async function lastImportedUpdate(db: Db): Promise<string | null> {
  const [run] = await db
    .select({ lastUpdated: sql<string | null>`${importRuns.stats} ->> 'lastUpdated'` })
    .from(importRuns)
    .where(
      and(
        eq(importRuns.source, 'tcgcsv'),
        eq(importRuns.status, 'ok'),
        sql`not (${importRuns.stats} ? 'skipped')`,
        sql`not (${importRuns.stats} ? 'failedGroups')`,
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

/** The ids of a game's sets with these (lowercase) codes. */
export async function setIdsByCode(db: Db, game: string, codes: string[]): Promise<string[]> {
  if (!codes.length) return [];
  const rows = await db
    .select({ id: sets.id })
    .from(sets)
    .where(and(eq(sets.gameId, game), inArray(sets.code, codes)));
  return rows.map((r) => r.id);
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
      setId: prints.setId,
      setCode: sets.code,
      number: prints.number,
      variant: prints.variant,
      name: cards.name,
      tcgplayer,
      tcgplayerEtched: sql<string | null>`${prints.externalIds} ->> 'tcgplayer_etched'`,
      finishes: prints.finishes,
      artwork: sql<string | null>`${prints.externalIds} -> 'artwork' ->> 'alt'`,
    })
    .from(prints)
    .innerJoin(cards, eq(cards.id, prints.cardId))
    .innerJoin(sets, eq(sets.id, prints.setId))
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

/** The artwork a Yu-Gi-Oh! print's TCGplayer product names (VB-119, `artworkFlag`). */
export interface ArtworkFlag {
  printId: string;
  /** Yugipedia's alt code: `EA`, `AA`. */
  alt: string;
  productId: number;
  /** The product image, null when it has none. */
  url: string | null;
}

/**
 * Writes TCGplayer's artwork codes into `external_ids.artwork` (VB-119): `alt` with `alt_source:
 * 'tcgplayer'` and `tcgplayer_product`, on prints without an alt code of the gallery's; plus the
 * product image as `url` where the gallery gave no scan (`file`, its own or a sibling's), so the
 * image mirror shows it (`showsScan`). The galleries' writes replace it, keeping a code theirs
 * lacks (`writeArtworks`); the importers keep it (`keepArtwork`). A flag of `setId`'s prints that
 * this run's rows no longer give (its product now prices another print) is removed in the same
 * transaction: `alt`, `alt_source`, `tcgplayer_product` and, without a `file`, `url`. Returns the
 * prints changed.
 */
export async function writeArtworkFlags(
  db: Db,
  rows: ArtworkFlag[],
  setId: string | null,
): Promise<number> {
  // One per print: the first product's.
  const unique = [...new Map(rows.map((r) => [r.printId, r])).values()];
  const artwork = sql`(${prints.externalIds} -> 'artwork')`;
  // What a stale flag leaves: the gallery's keys (its `url` only with its `file`).
  const left = sql`${artwork} - (array['alt', 'alt_source', 'tcgplayer_product']
    || case when ${artwork} ? 'file' then '{}'::text[] else array['url'] end)`;
  const next = sql`coalesce(${artwork}, '{}'::jsonb)
    || jsonb_build_object('alt', v.alt, 'alt_source', 'tcgplayer', 'tcgplayer_product', v.product)
    || case when v.url is null or coalesce(${artwork} ? 'file', false) then '{}'::jsonb
      else jsonb_build_object('url', v.url) end`;
  return db.transaction(async (tx) => {
    const stripped = setId
      ? await tx.execute(sql`
          update ${prints} set external_ids = case when ${left} = '{}'::jsonb
            then ${prints.externalIds} - 'artwork'
            else ${prints.externalIds} || jsonb_build_object('artwork', ${left}) end
          where ${prints.setId} = ${setId}
            and ${artwork} ->> 'alt_source' = 'tcgplayer'
            and ${prints.id}::text not in (
              select jsonb_array_elements_text(${JSON.stringify(unique.map((r) => r.printId))}::jsonb))`)
      : null;
    const done = unique.length
      ? await tx.execute(sql`
          update ${prints} set external_ids = ${prints.externalIds} || jsonb_build_object('artwork', ${next})
          from jsonb_to_recordset(${JSON.stringify(
            unique.map((r) => ({ id: r.printId, alt: r.alt, product: r.productId, url: r.url })),
          )}::jsonb) as v(id uuid, alt text, product bigint, url text)
          where ${prints.id} = v.id
            and (coalesce(${artwork} ->> 'alt', '') = '' or ${artwork} ->> 'alt_source' = 'tcgplayer')
            and ${artwork} is distinct from ${next}`)
      : null;
    return (stripped?.rowCount ?? 0) + (done?.rowCount ?? 0);
  });
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
