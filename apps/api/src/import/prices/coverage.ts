import type { BlobStore } from '@voidbinder/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { importRuns, pricesCurrent, prints, sets } from '../../db/schema';
import type { Db } from '../scryfall/write';
import { matchGroups, type GroupRule } from './match';
import { CATEGORIES, results, type PricedGame, type TcgGroup } from './tcgcsv';
import { gameSets } from './write';

// Price coverage (VB-111, VB-114): how many prints of each set have a current price, from any
// source and per source, which TCGplayer groups matched no set, and which sets have a group but no
// TCGplayer price at all. Computed from `prices_current` and the group list of the last TCGCSV run
// (kept in `RAW`), after every run (logged) and on `GET /admin/prices/coverage`.

/** The sources of `prices_current`: TCGCSV, and Scryfall's Cardmarket EUR and TCGplayer USD. */
export const PRICE_SOURCES = ['tcgplayer', 'cardmarket', 'tcgplayer_scryfall'] as const;
export type PriceSource = (typeof PRICE_SOURCES)[number];

export interface SetCoverage {
  code: string;
  name: string;
  prints: number;
  /** Prints with a current price from any source. */
  priced: number;
  /** Prints with a current price, per source. */
  sources: Record<PriceSource, number>;
  /** Prints without a current price from any source. */
  unpriced: number;
  /** The TCGplayer groups that match the set. */
  groups: number[];
  groupMatched: boolean;
  /** The rule that matched each group, in the order of `groups`. */
  rules: GroupRule[];
}

export interface PriceCoverage {
  game: PricedGame;
  sets: SetCoverage[];
  /** TCGplayer groups that match no set. */
  unmatchedGroups: TcgGroup[];
  /** Sets that have a group and prints, none of them with a TCGplayer (TCGCSV) price. */
  unpricedSets: { code: string; name: string; prints: number }[];
  /** The game's counts (`coverageCounts`). */
  totals: CoverageCounts;
}

export const groupsKey = (raw: string, game: PricedGame) =>
  `${raw}/${CATEGORIES[game]}/groups.json.gz`;

export async function priceCoverage(
  db: Db,
  game: PricedGame,
  groups: readonly TcgGroup[],
): Promise<PriceCoverage> {
  const matched = matchGroups(groups, await gameSets(db, game), { regional: game === 'yugioh' });
  const groupsOf = new Map<string, typeof matched>();
  for (const m of matched) groupsOf.set(m.setId, [...(groupsOf.get(m.setId) ?? []), m]);
  // Whether the print has a current price (of `source`): an index lookup on the primary key.
  const has = (source?: PriceSource) =>
    sql`exists (select 1 from ${pricesCurrent} where ${pricesCurrent.printId} = ${prints.id}${
      source ? sql` and ${pricesCurrent.source} = ${source}` : sql``
    })`;
  const count = (source?: PriceSource) =>
    sql<number>`(count(${prints.id}) filter (where ${has(source)}))::int`;
  const rows = await db
    .select({
      id: sets.id,
      code: sets.code,
      name: sets.name,
      prints: sql<number>`count(${prints.id})::int`,
      priced: count(),
      tcgplayer: count('tcgplayer'),
      cardmarket: count('cardmarket'),
      tcgplayer_scryfall: count('tcgplayer_scryfall'),
    })
    .from(sets)
    .leftJoin(prints, eq(prints.setId, sets.id))
    .where(eq(sets.gameId, game))
    .groupBy(sets.id)
    .orderBy(sets.code);
  const table: SetCoverage[] = rows.map(({ id, code, name, prints, priced, ...sources }) => {
    const own = groupsOf.get(id) ?? [];
    return {
      code,
      name,
      prints,
      priced,
      sources,
      unpriced: prints - priced,
      groups: own.map((m) => m.groupId),
      groupMatched: own.length > 0,
      rules: own.map((m) => m.rule),
    };
  });
  const hit = new Set(matched.map((m) => m.groupId));
  const coverage = {
    game,
    sets: table,
    unmatchedGroups: groups
      .filter((g) => !hit.has(g.groupId))
      .map(({ groupId, name, abbreviation }) => ({ groupId, name, abbreviation })),
    unpricedSets: table
      .filter((s) => s.groupMatched && s.prints && !s.sources.tcgplayer)
      .map(({ code, name, prints }) => ({ code, name, prints })),
  };
  return { ...coverage, totals: coverageCounts(coverage) };
}

type Counted = Pick<PriceCoverage, 'sets' | 'unmatchedGroups' | 'unpricedSets'>;
export type CoverageCounts = ReturnType<typeof coverageCounts>;

const sum = (c: Counted, count: (s: SetCoverage) => number) =>
  c.sets.reduce((n, s) => n + count(s), 0);

/** The counts of one game's coverage: its `totals`, the line `price coverage` logs. */
export const coverageCounts = (c: Counted) => ({
  sets: c.sets.length,
  setsWithGroup: c.sets.filter((s) => s.groupMatched).length,
  setsPriced: c.sets.filter((s) => s.priced).length,
  prints: sum(c, (s) => s.prints),
  priced: sum(c, (s) => s.priced),
  sources: Object.fromEntries(
    PRICE_SOURCES.map((source) => [source, sum(c, (s) => s.sources[source])]),
  ) as Record<PriceSource, number>,
  unpriced: sum(c, (s) => s.unpriced),
  unmatchedGroups: c.unmatchedGroups.length,
  unpricedSets: c.unpricedSets.length,
});

/** A gzip-compressed TCGCSV group list from `RAW`; null when it is missing. */
export async function readGroups(blobs: BlobStore, key: string): Promise<TcgGroup[] | null> {
  const blob = await blobs.get(key);
  if (!blob) return null;
  const gz = await new Response(blob.body as ReadableStream<Uint8Array>).arrayBuffer();
  const body = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return results<TcgGroup>(await new Response(body).text(), key);
}

/** The `RAW` prefix of the last TCGCSV run that pulled a build (`raw/<env>/tcgcsv/<date>`). */
export async function lastRawPrefix(db: Db): Promise<string | null> {
  const [run] = await db
    .select({ raw: sql<string | null>`${importRuns.stats} ->> 'raw'` })
    .from(importRuns)
    .where(
      and(
        eq(importRuns.source, 'tcgcsv'),
        eq(importRuns.status, 'ok'),
        sql`${importRuns.stats} ? 'raw'`,
      ),
    )
    .orderBy(desc(importRuns.startedAt))
    .limit(1);
  return run?.raw ?? null;
}

/** The coverage of `game` from the group list of the last run; null without one. */
export async function lastCoverage(
  db: Db,
  raw: BlobStore,
  game: PricedGame,
): Promise<PriceCoverage | null> {
  const prefix = await lastRawPrefix(db);
  const groups = prefix ? await readGroups(raw, groupsKey(prefix, game)) : null;
  return groups ? priceCoverage(db, game, groups) : null;
}
