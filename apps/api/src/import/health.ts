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

/** The newest run of a source with what the health needs. */
export interface SourceSummary {
  /** `finished_at` of the newest `ok` run. */
  lastSuccessAt: Date | null;
  /** Status of the newest finished (not `running`) run. */
  lastStatus: string | null;
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
      return {
        source,
        cadence,
        lastSuccessAt: last?.toISOString() ?? null,
        lastStatus: s?.lastStatus ?? null,
        missing: !last || now - last.getTime() > PERIOD[cadence] + GRACE,
        failed: s?.lastStatus === 'failed',
      };
    });
  const missing = sources.filter((s) => s.missing).map((s) => s.source);
  const failed = sources.filter((s) => s.failed).map((s) => s.source);
  const problems = [
    missing.length ? `missing: ${missing.join(', ')}` : '',
    failed.length ? `failed: ${failed.join(', ')}` : '',
  ].filter(Boolean);
  return { ok: problems.length === 0, message: problems.join('; ') || 'OK', sources };
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
      });
  }
  return { runs, health: importHealth(summaries, env, now) };
}
