import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { and, eq, sql } from 'drizzle-orm';
import { priceMappings, pricesDaily } from '../../db/schema';
import { batches } from '../util';
import type { Db } from '../scryfall/write';
import { CATEGORIES, cents, finishOf, results, type PricedGame, type TcgPrice } from './tcgcsv';
import { dayOf, type PriceRow } from './write';

// History backfill from TCGCSV's daily price archive (VB-63, scripts/backfill-prices.ts). Per the
// FAQ (https://tcgcsv.com/faq) one 7z (PPMd) per day holds `<day>/<category>/<group>/prices`, each
// the same JSON as the live `/tcgplayer/<category>/<group>/prices`; prices only, no products. So
// the archive is read through `price_mappings` alone: products the daily import never mapped are
// skipped, and only `prices_daily` is written (an old day is never the current price).

export const ARCHIVE_START = '2024-02-08';
const SOURCE = 'tcgplayer';

export const archiveUrl = (day: string) =>
  `https://tcgcsv.com/archive/tcgplayer/prices-${day}.ppmd.7z`;

/** Every UTC day from `from` to `to`, both included (`YYYY-MM-DD`). */
export function days(from: string, to: string): string[] {
  const out: string[] = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += 864e5)
    out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** The `tcgplayer` mappings keyed `${externalId}|${finish}`, manual ones included. */
export async function loadMappings(db: Db): Promise<Map<string, string>> {
  const rows = await db
    .select({
      printId: priceMappings.printId,
      externalId: priceMappings.externalId,
      finish: priceMappings.finish,
    })
    .from(priceMappings)
    .where(eq(priceMappings.source, SOURCE));
  return new Map(rows.map((r) => [`${r.externalId}|${r.finish}`, r.printId]));
}

/**
 * One archived prices file through the mappings. The finish is the printing's, except for a
 * product mapped as `etched` (Scryfall's etched product, whatever TCGplayer calls its printing),
 * as in the daily import. Rows without a market price are counted, never written.
 */
export function mapPrices(prices: readonly TcgPrice[], mappings: ReadonlyMap<string, string>) {
  const rows: PriceRow[] = [];
  let unmapped = 0;
  let noMarket = 0;
  for (const p of prices) {
    // `etched` first: the daily import uses the matched finish before the printing's own.
    let finish = 'etched';
    let printId = mappings.get(`${p.productId}|etched`);
    if (!printId) {
      finish = finishOf(p.subTypeName);
      printId = mappings.get(`${p.productId}|${finish}`);
    }
    if (!printId) {
      unmapped++;
      continue;
    }
    const market = cents(p.marketPrice);
    if (market === null) {
      noMarket++;
      continue;
    }
    rows.push({
      printId,
      finish,
      source: SOURCE,
      lang: 'en',
      currency: 'USD',
      market,
      low: cents(p.lowPrice),
      high: cents(p.highPrice),
    });
  }
  // The last of a print and finish wins, as in the daily import's writePrices.
  const unique = [...new Map(rows.map((r) => [`${r.printId}|${r.finish}`, r])).values()];
  return { rows: unique, unmapped, noMarket };
}

/** The mapped rows of one extracted day (`<dir>/<day>/<category>/<group>/prices`) per game. */
export async function readDay(
  dir: string,
  day: string,
  mappings: ReadonlyMap<string, string>,
  games: readonly PricedGame[],
) {
  const out: Partial<Record<PricedGame, ReturnType<typeof mapPrices> & { groups: number }>> = {};
  for (const game of games) {
    const root = join(dir, day, String(CATEGORIES[game]));
    const groups = await readdir(root).catch(() => []);
    const g = { rows: [] as PriceRow[], unmapped: 0, noMarket: 0, groups: groups.length };
    for (const group of groups) {
      const text = await readFile(join(root, group, 'prices'), 'utf8').catch(() => null);
      if (text === null) continue;
      const r = mapPrices(results<TcgPrice>(text, `prices ${day}/${group}`), mappings);
      g.rows.push(...r.rows);
      g.unmapped += r.unmapped;
      g.noMarket += r.noMarket;
    }
    out[game] = g;
  }
  return out;
}

/** The games of a read day that unpacked no group at all: the archive's layout is not as assumed. */
export const emptyGames = (perGame: Partial<Record<PricedGame, { groups: number }>>) =>
  Object.entries(perGame).flatMap(([game, g]) => (g.groups === 0 ? [game] : []));

/** Whether `prices_daily` has any `tcgplayer` row of that day (the daily import or a backfill). */
export async function hasDay(db: Db, day: string): Promise<boolean> {
  // ponytail: one probe per day; with chunk exclusion it only reads that day's month.
  const rows = await db
    .select({ one: sql`1` })
    .from(pricesDaily)
    .where(and(eq(pricesDaily.source, SOURCE), eq(pricesDaily.observedAt, new Date(dayOf(day)))))
    .limit(1);
  return rows.length > 0;
}

/**
 * Inserts one day's rows in one transaction (a day is all there or not at all) and never
 * overwrites: a row the daily import or an earlier run wrote stays. Returns the rows inserted.
 */
export async function writeDay(db: Db, day: string, rows: readonly PriceRow[]): Promise<number> {
  const at = new Date(dayOf(day));
  let inserted = 0;
  await db.transaction(async (tx) => {
    // 8 columns × 5000 rows stays under Postgres' 65,535 parameters.
    for (const batch of batches(rows, 5000)) {
      const r = await tx
        .insert(pricesDaily)
        .values(
          batch.map((p) => ({
            observedAt: at,
            printId: p.printId,
            finish: p.finish,
            source: p.source,
            lang: p.lang,
            currency: p.currency,
            centsMarket: p.market,
            centsLow: p.low ?? null,
            centsHigh: p.high ?? null,
          })),
        )
        .onConflictDoNothing();
      inserted += r.rowCount ?? 0;
    }
  });
  return inserted;
}
