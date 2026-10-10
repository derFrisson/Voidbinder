import type { ImportHealth, ImportRun, ImportsResponse } from '@voidbinder/shared/api';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';

type Cadence = ImportHealth['sources'][number]['cadence'];

/**
 * The scheduled imports and how often each must succeed (VB-83): wrangler.jsonc's crons
 * (CRON_SOURCES in schedule.ts; schedule.test.ts checks both agree) and the VPS timers.
 * `image-mirror` is the VPS timer (scripts/vps/image-mirror.timer): its `images` rows carry
 * `stats.query.sm`, the Workflows' own image steps do not. The catalog modules write no
 * `import_runs` row; scripts/vps/import-health.sh checks their unit instead.
 */
export const IMPORT_CADENCE: Record<string, Cadence> = {
  scryfall: 'daily',
  ygoprodeck: 'daily',
  tcgdex: 'daily',
  tcgcsv: 'daily',
  yugipedia: 'weekly',
  // The weekly Yugipedia Workflow crawls the galleries after the names.
  'yugipedia-galleries': 'weekly',
  // Daily on prod too: the image-mirror.service unit says DBS=dev, but import-health expects the
  // VPS drop-in `Environment="DBS=prod dev"` (docs/guides/database-vps.md section 11) to be
  // active, otherwise prod reports image-mirror as missing.
  'image-mirror': 'daily',
};

/** Sources without a cron in an environment: dev pulls TCGCSV on demand only (wrangler.jsonc). */
const UNSCHEDULED: Record<string, string[]> = { dev: ['tcgcsv'] };

const HOUR = 3_600_000;
const PERIOD: Record<Cadence, number> = { daily: 24 * HOUR, weekly: 7 * 24 * HOUR };
/** Slack on top of the cadence before a source counts as missing: a slow run is not a missing one. */
const GRACE = 2 * HOUR;
/** Runs listed per source. */
const RUNS = 30;

// The freshness of a price run (VB-116), computed in prices/coverage.ts. Here, since the app's
// typecheck reaches this file through the admin routes and must not pull in the importers.

export type FreshnessCounts = {
  prints: number;
  /** Prints with a mapping or a current price of the source. */
  mapped: number;
  unmapped: number;
  /** Mapped prints with a current price. */
  priced: number;
  /** Priced in the last 24 h. */
  fresh: number;
  /** Newest price older than 36 h. */
  stale: number;
};

export interface Freshness extends FreshnessCounts {
  game: string;
  source: string;
  /** `fresh / priced`, rounded to 4 places; null without a priced print. */
  share: number | null;
}

/** The newest run of a source with what the health needs. */
export interface SourceSummary {
  /** `finished_at` of the newest `ok` run. */
  lastSuccessAt: Date | null;
  /** Status of the newest finished (not `running`) run. */
  lastStatus: string | null;
  /** `started_at` of the newest run when it is still `running`. */
  runningSince?: Date | null;
  /**
   * VB-116, price runs: `stats.freshness` of the newest `ok` run that has one, and of the newest
   * such run at least 20 h older (the day before).
   */
  freshness?: { latest: Freshness[]; previous?: Freshness[] | undefined } | undefined;
  /** VB-116, TCGCSV: `stats.failedGroups` of the newest `ok` run, the groups it did not import. */
  failedGroups?: { game: string; groupIds: number[] }[] | undefined;
}

/** Below this share of the priced prints refreshed in 24 h, a price source is stale. */
export const MIN_FRESH_SHARE = 0.95;
/** How much older the run that `freshness.previous` comes from is at least. */
const DAY_BEFORE = 20 * HOUR;
/**
 * Day-over-day growth of the stale prints that stays green: a market price turning null or a
 * mapping moving to another print adds a few every day, so only real growth alarms.
 */
export const staleGrowthTolerance = (priced: number) => Math.max(25, Math.ceil(0.005 * priced));

/**
 * The stale prices of one run's freshness (VB-116), one entry per game and source: fewer than 95 %
 * of the priced prints refreshed in 24 h, or more stale prints than the day before by more than
 * `staleGrowthTolerance`.
 */
export function freshnessProblems(latest: Freshness[], previous: Freshness[] = []): string[] {
  return latest.flatMap((f) => {
    const name = `${f.source}/${f.game}`;
    const before = previous.find((p) => p.source === f.source && p.game === f.game);
    return [
      f.share !== null && f.share < MIN_FRESH_SHARE
        ? `${name} ${(f.share * 100).toFixed(1)}% refreshed in 24 h`
        : '',
      before && f.stale - before.stale > staleGrowthTolerance(f.priced)
        ? `${name} ${f.stale} stale (was ${before.stale})`
        : '',
    ].filter(Boolean);
  });
}

/**
 * The groups the newest `ok` run did not import, one entry per game with their ids. Only TCGCSV
 * runs list failed groups, and its prices are `tcgplayer`'s.
 */
function failedGroupProblems(s: SourceSummary | undefined): string[] {
  const groups = new Map<string, number[]>();
  for (const f of s?.failedGroups ?? [])
    groups.set(f.game, [...(groups.get(f.game) ?? []), ...f.groupIds]);
  return [...groups].map(([game, ids]) => `tcgplayer/${game} ${ids.join(' ')}`);
}

/** The health of the scheduled sources of `env` at `now`, from each source's summary. */
export function importHealth(
  summaries: Map<string, SourceSummary>,
  env: string,
  now: number,
): ImportHealth {
  const sources = Object.entries(IMPORT_CADENCE)
    .filter(([source]) => !UNSCHEDULED[env]?.includes(source))
    .map(([source, cadence]) => {
      const s = summaries.get(source);
      const last = s?.lastSuccessAt ?? null;
      // A run in progress younger than the cadence is not missing yet (a weekly crawl takes hours).
      const running = !!s?.runningSince && now - s.runningSince.getTime() < PERIOD[cadence];
      const stale = s?.freshness ? freshnessProblems(s.freshness.latest, s.freshness.previous) : [];
      return {
        source,
        cadence,
        lastSuccessAt: last?.toISOString() ?? null,
        lastStatus: s?.lastStatus ?? null,
        missing: !running && (!last || now - last.getTime() > PERIOD[cadence] + GRACE),
        failed: s?.lastStatus === 'failed',
        stale,
      };
    });
  const missing = sources.filter((s) => s.missing).map((s) => s.source);
  const failed = sources.filter((s) => s.failed).map((s) => s.source);
  const stale = sources.flatMap((s) => s.stale);
  const failedGroups = sources.flatMap((s) => failedGroupProblems(summaries.get(s.source)));
  const problems = [
    missing.length ? `missing: ${missing.join(', ')}` : '',
    failed.length ? `failed: ${failed.join(', ')}` : '',
    stale.length ? `stale: ${stale.join(', ')}` : '',
    failedGroups.length ? `failed groups: ${failedGroups.join(', ')}` : '',
  ].filter(Boolean);
  return {
    ok: problems.length === 0,
    message: problems.join('; ') || 'OK',
    sources: sources.map(({ stale, ...s }) => ({ ...s, stale: stale.length > 0 })),
  };
}

const toDate = (v: Date | string | null) => (v === null ? null : new Date(v));

/** `GET /admin/imports`: the last runs per source and the health of the scheduled ones. */
export async function importOverview(
  db: NodePgDatabase,
  env: string,
  now = Date.now(),
): Promise<ImportsResponse> {
  // ponytail: import_runs grows by a few rows a day; the windows scan it whole. Add an index on
  // (source, started_at) when it holds hundreds of thousands.
  const { rows } = await db.execute<{
    source: string;
    id: string;
    kind: string;
    status: string;
    started_at: Date | string;
    finished_at: Date | string | null;
    stats: Record<string, unknown>;
    error: string | null;
    last_ok: Date | string | null;
    last_status: string | null;
  }>(sql`
    select * from (
      select *,
        row_number() over (partition by source order by started_at desc) as n,
        max(finished_at) filter (where status = 'ok') over (partition by source) as last_ok,
        first_value(status) over (
          partition by source order by (status = 'running'), started_at desc
          rows between unbounded preceding and unbounded following
        ) as last_status
      from (
        select id, kind, status, started_at, finished_at, stats, error,
          case when source = 'images' and stats #>> '{query,sm}' = 'true'
            then 'image-mirror' else source end as source
        from import_runs
      ) r
    ) w
    where n <= ${RUNS}
    order by source, started_at desc
  `);
  const runs: Record<string, ImportRun[]> = {};
  const summaries = new Map<string, SourceSummary>();
  const freshAt = new Map<string, number>();
  const seenOk = new Set<string>();
  for (const r of rows) {
    const startedAt = new Date(r.started_at);
    const finishedAt = toDate(r.finished_at);
    (runs[r.source] ??= []).push({
      id: r.id,
      kind: r.kind,
      status: r.status,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt?.toISOString() ?? null,
      durationSeconds: finishedAt ? (finishedAt.getTime() - startedAt.getTime()) / 1000 : null,
      stats: r.stats,
      error: r.error,
    });
    if (!summaries.has(r.source))
      summaries.set(r.source, {
        lastSuccessAt: toDate(r.last_ok),
        lastStatus: r.last_status === 'running' ? null : r.last_status,
        runningSince: r.status === 'running' ? startedAt : null,
      });
    if (r.status !== 'ok') continue;
    const s = summaries.get(r.source);
    if (!s) continue;
    // The newest `ok` run's failed groups: the health stays red while they keep failing.
    if (!seenOk.has(r.source)) {
      seenOk.add(r.source);
      if (Array.isArray(r.stats.failedGroups))
        s.failedGroups = r.stats.failedGroups as SourceSummary['failedGroups'];
    }
    const freshness = r.stats.freshness;
    if (!Array.isArray(freshness)) continue;
    // Rows come newest first: the first is `latest`, the first a day older `previous`.
    const latestAt = freshAt.get(r.source);
    if (latestAt === undefined) {
      s.freshness = { latest: freshness as Freshness[] };
      freshAt.set(r.source, startedAt.getTime());
    } else if (!s.freshness?.previous && latestAt - startedAt.getTime() >= DAY_BEFORE)
      s.freshness = { latest: s.freshness?.latest ?? [], previous: freshness as Freshness[] };
  }
  return { runs, health: importHealth(summaries, env, now) };
}
