import type { BlobStore } from '@voidbinder/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { importRuns, pricesCurrent, prints, sets } from '../../db/schema';
import type { Db } from '../scryfall/write';
import { matchGroups } from './match';
import { CATEGORIES, results, type PricedGame, type TcgGroup } from './tcgcsv';
import { gameSets } from './write';

// Price coverage (VB-111): how many prints of each set have a current TCGplayer price, which
// TCGplayer groups matched no set, and which sets have a group but no price at all. Computed from
// `prices_current` and the group list of the last TCGCSV run (kept in `RAW`), after every run
// (logged) and on `GET /admin/prices/coverage`.

export interface SetCoverage {
  code: string;
  name: string;
  prints: number;
  /** Prints with a current `tcgplayer` price. */
  priced: number;
  /** The TCGplayer groups that match the set. */
  groups: number[];
}

export interface PriceCoverage {
  game: PricedGame;
  sets: SetCoverage[];
  /** TCGplayer groups that match no set. */
  unmatchedGroups: TcgGroup[];
  /** Sets that have a group and prints, none of them priced. */
  unpricedSets: { code: string; name: string; prints: number }[];
}

const SOURCE = 'tcgplayer';

export const groupsKey = (raw: string, game: PricedGame) =>
  `${raw}/${CATEGORIES[game]}/groups.json.gz`;

export async function priceCoverage(
  db: Db,
  game: PricedGame,
  groups: readonly TcgGroup[],
): Promise<PriceCoverage> {
  const matched = matchGroups(groups, await gameSets(db, game), { regional: game === 'yugioh' });
  const groupsOf = new Map<string, number[]>();
  for (const m of matched) groupsOf.set(m.setId, [...(groupsOf.get(m.setId) ?? []), m.groupId]);
  const rows = await db
    .select({
      id: sets.id,
      code: sets.code,
      name: sets.name,
      prints: sql<number>`count(${prints.id})::int`,
      priced: sql<number>`(count(${prints.id}) filter (where exists (
        select 1 from ${pricesCurrent}
        where ${pricesCurrent.printId} = ${prints.id} and ${pricesCurrent.source} = ${SOURCE})))::int`,
    })
    .from(sets)
    .leftJoin(prints, eq(prints.setId, sets.id))
    .where(eq(sets.gameId, game))
    .groupBy(sets.id)
    .orderBy(sets.code);
  const table = rows.map(({ id, ...r }) => ({ ...r, groups: groupsOf.get(id) ?? [] }));
  const hit = new Set(matched.map((m) => m.groupId));
  return {
    game,
    sets: table,
    unmatchedGroups: groups
      .filter((g) => !hit.has(g.groupId))
      .map(({ groupId, name, abbreviation }) => ({ groupId, name, abbreviation })),
    unpricedSets: table
      .filter((s) => s.groups.length && s.prints && !s.priced)
      .map(({ code, name, prints }) => ({ code, name, prints })),
  };
}

/** The counts of one game's coverage, the line `price coverage` logs. */
export const coverageCounts = (c: PriceCoverage) => ({
  sets: c.sets.length,
  setsWithGroup: c.sets.filter((s) => s.groups.length).length,
  setsPriced: c.sets.filter((s) => s.priced).length,
  prints: c.sets.reduce((n, s) => n + s.prints, 0),
  priced: c.sets.reduce((n, s) => n + s.priced, 0),
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
