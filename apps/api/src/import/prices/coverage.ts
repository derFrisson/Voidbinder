import type { BlobStore } from '@voidbinder/core';
import { and, desc, eq, sql } from 'drizzle-orm';
import { importRuns, priceMappings, pricesCurrent, prints, sets } from '../../db/schema';
import type { Db } from '../scryfall/write';
import { matchGroups } from './match';
import { CATEGORIES, results, type PricedGame, type TcgGroup } from './tcgcsv';
import { log } from '../../middleware/log';
import type { Freshness, FreshnessCounts } from '../health';
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
  /** Mapped prints whose newest `tcgplayer` price is older than 36 h (VB-116). */
  stale: number;
}

export interface PriceCoverage {
  game: PricedGame;
  sets: SetCoverage[];
  /** TCGplayer groups that match no set. */
  unmatchedGroups: TcgGroup[];
  /** Sets that have a group and prints, none of them priced. */
  unpricedSets: { code: string; name: string; prints: number }[];
  /** The game's totals per price source (VB-116). */
  freshness: Freshness[];
  /** Groups whose step still failed after the Workflow's retries in the last run (VB-116). */
  failedGroups: number[];
}

// Freshness (VB-116): whether every mapped print got today's price. A print counts as mapped for
// a source when it has a mapping or a current price of it (Scryfall's USD prices come without a
// mapping; a print that lost its mapping keeps its old price and goes stale). `fresh`: its newest
// price is younger than 24 h, `stale`: older than 36 h. A mapped print never priced (no market
// price yet) is coverage (`priced`), not freshness, so the share is `fresh / priced`.

export const FRESH_HOURS = 24;
export const STALE_HOURS = 36;

/** The games each price source prices. */
export const SOURCE_GAMES: Record<string, readonly string[]> = {
  tcgplayer: ['mtg', 'yugioh', 'pokemon'],
  cardmarket: ['mtg'],
  tcgplayer_scryfall: ['mtg'],
};

/** One SQL per source: the freshness counts per set of the source's games at `now`. */
export async function setFreshness(db: Db, source: string, now: Date, games?: readonly string[]) {
  const hours = (h: number) => new Date(now.getTime() - h * 3_600_000).toISOString();
  const { rows } = await db.execute<FreshnessCounts & { game: string; setId: string }>(sql`
    with p as (
      select print_id, max(observed_at) as at from ${pricesCurrent}
      where source = ${source} group by print_id
    ), m as (
      select distinct print_id from ${priceMappings} where source = ${source}
    )
    select s.game_id as "game", s.id as "setId",
      count(*)::int as "prints",
      (count(*) filter (where m.print_id is not null or p.at is not null))::int as "mapped",
      (count(*) filter (where m.print_id is null and p.at is null))::int as "unmapped",
      count(p.at)::int as "priced",
      (count(*) filter (where p.at >= ${hours(FRESH_HOURS)}::timestamptz))::int as "fresh",
      (count(*) filter (where p.at < ${hours(STALE_HOURS)}::timestamptz))::int as "stale"
    from ${sets} s
    join ${prints} pr on pr.set_id = s.id
    left join p on p.print_id = pr.id
    left join m on m.print_id = pr.id
    where s.game_id in (${sql.join(
      (games ?? SOURCE_GAMES[source] ?? []).map((g) => sql`${g}`),
      sql`, `,
    )})
    group by s.id
  `);
  return rows;
}

const COUNTS = ['prints', 'mapped', 'unmapped', 'priced', 'fresh', 'stale'] as const;

/** The source's totals per game (every game of `SOURCE_GAMES`, a game without prints too). */
export async function priceFreshness(
  db: Db,
  source: string,
  now: Date,
  games: readonly string[] = SOURCE_GAMES[source] ?? [],
): Promise<Freshness[]> {
  const rows = games.length ? await setFreshness(db, source, now, games) : [];
  return games.map((game) => {
    const c: FreshnessCounts = { prints: 0, mapped: 0, unmapped: 0, priced: 0, fresh: 0, stale: 0 };
    for (const r of rows) if (r.game === game) for (const k of COUNTS) c[k] += r[k];
    const share = c.priced ? Math.round((c.fresh / c.priced) * 10_000) / 10_000 : null;
    return { game, source, ...c, share };
  });
}

/**
 * The freshness a price run keeps in its stats and logs as one line `price freshness`. Never
 * fatal (the prices are written by then): a failure is a WARN and null.
 */
export async function runFreshness(
  db: Db,
  run: { source: string; runId: string },
  sources: readonly string[],
  now = new Date(),
): Promise<Freshness[] | null> {
  try {
    const freshness = (
      await Promise.all(sources.map((source) => priceFreshness(db, source, now)))
    ).flat();
    log('info', { message: 'price freshness', ...run, freshness });
    return freshness;
  } catch (err) {
    log('warn', { message: 'price freshness failed', ...run, error: String(err) });
    return null;
  }
}

const SOURCE = 'tcgplayer';

export const groupsKey = (raw: string, game: PricedGame) =>
  `${raw}/${CATEGORIES[game]}/groups.json.gz`;

export async function priceCoverage(
  db: Db,
  game: PricedGame,
  groups: readonly TcgGroup[],
  { now = new Date(), failedGroups = [] }: { now?: Date; failedGroups?: number[] } = {},
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
  const stale = new Map(
    (await setFreshness(db, SOURCE, now, [game])).map((r) => [r.setId, r.stale]),
  );
  const table = rows.map(({ id, ...r }) => ({
    ...r,
    groups: groupsOf.get(id) ?? [],
    stale: stale.get(id) ?? 0,
  }));
  const sources = Object.keys(SOURCE_GAMES).filter((s) => SOURCE_GAMES[s]?.includes(game));
  const freshness = (
    await Promise.all(sources.map((source) => priceFreshness(db, source, now, [game])))
  ).flat();
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
    freshness,
    failedGroups,
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
  stale: c.sets.reduce((n, s) => n + s.stale, 0),
});

/** A gzip-compressed TCGCSV group list from `RAW`; null when it is missing. */
export async function readGroups(blobs: BlobStore, key: string): Promise<TcgGroup[] | null> {
  const blob = await blobs.get(key);
  if (!blob) return null;
  const gz = await new Response(blob.body as ReadableStream<Uint8Array>).arrayBuffer();
  const body = new Blob([gz]).stream().pipeThrough(new DecompressionStream('gzip'));
  return results<TcgGroup>(await new Response(body).text(), key);
}

/** Groups whose step still failed after the Workflow's retries, kept in a run's stats. */
export interface FailedGroups {
  game: PricedGame;
  groupIds: number[];
  error: string;
}

/**
 * The `RAW` prefix of the last TCGCSV run that pulled a build (`raw/<env>/tcgcsv/<date>`) and the
 * groups that failed in it.
 */
export async function lastRawRun(
  db: Db,
): Promise<{ raw: string; failedGroups: FailedGroups[] } | null> {
  const [run] = await db
    .select({
      raw: sql<string>`${importRuns.stats} ->> 'raw'`,
      failedGroups: sql<FailedGroups[] | null>`${importRuns.stats} -> 'failedGroups'`,
    })
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
  return run ? { raw: run.raw, failedGroups: run.failedGroups ?? [] } : null;
}

/** The coverage of `game` from the group list of the last run; null without one. */
export async function lastCoverage(
  db: Db,
  raw: BlobStore,
  game: PricedGame,
): Promise<PriceCoverage | null> {
  const run = await lastRawRun(db);
  const groups = run ? await readGroups(raw, groupsKey(run.raw, game)) : null;
  if (!run || !groups) return null;
  const failedGroups = run.failedGroups.filter((f) => f.game === game).flatMap((f) => f.groupIds);
  return priceCoverage(db, game, groups, { failedGroups });
}
