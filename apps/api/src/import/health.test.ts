import { ImportHealthSchema, ImportsResponseSchema } from '@voidbinder/shared/api';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importRuns } from '../db/schema';
import { databaseUrl, freshDatabase, testApp } from '../test-helpers';
import {
  freshnessProblems,
  importHealth,
  IMPORT_CADENCE,
  type Freshness,
  type SourceSummary,
} from './health';

const now = Date.parse('2026-10-10T07:30:00Z');
const hoursAgo = (h: number) => new Date(now - h * 3_600_000);
const all = (summary: SourceSummary) =>
  new Map(Object.keys(IMPORT_CADENCE).map((s) => [s, summary]));
/** One game's freshness of `tcgplayer`: `priced` prints, `fresh` of them refreshed in 24 h. */
const fresh = (game: string, priced: number, freshCount: number, stale = 0): Freshness => ({
  game,
  source: 'tcgplayer',
  prints: priced + 10,
  mapped: priced,
  unmapped: 10,
  priced,
  fresh: freshCount,
  stale,
  share: priced ? freshCount / priced : null,
});

describe('importHealth', () => {
  it('is ok when every source succeeded within its cadence plus 2 h', () => {
    const health = importHealth(
      all({ lastSuccessAt: hoursAgo(25.9), lastStatus: 'ok' }),
      'prod',
      now,
    );
    expect(health).toMatchObject({ ok: true, message: 'OK' });
    expect(health.sources.map((s) => s.source)).toContain('tcgcsv');
  });

  it('names the missing and the failed sources in one line', () => {
    const summaries = all({ lastSuccessAt: hoursAgo(3), lastStatus: 'ok' });
    summaries.set('scryfall', { lastSuccessAt: hoursAgo(26.1), lastStatus: 'failed' });
    summaries.set('tcgdex', { lastSuccessAt: hoursAgo(1), lastStatus: 'failed' });
    // Weekly: six days old is fine, more than a week and 2 h is not.
    summaries.set('yugipedia', { lastSuccessAt: hoursAgo(6 * 24), lastStatus: 'ok' });
    summaries.set('yugipedia-galleries', {
      lastSuccessAt: hoursAgo(7 * 24 + 2.1),
      lastStatus: 'ok',
    });
    summaries.delete('image-mirror');
    const health = importHealth(summaries, 'prod', now);
    expect(health.ok).toBe(false);
    expect(health.message).toBe(
      'missing: scryfall, yugipedia-galleries, image-mirror; failed: scryfall, tcgdex',
    );
    expect(health.sources.find((s) => s.source === 'image-mirror')).toMatchObject({
      lastSuccessAt: null,
      lastStatus: null,
      missing: true,
      failed: false,
    });
  });

  it('does not count a source as missing while its run is in progress within the cadence', () => {
    const summaries = all({ lastSuccessAt: hoursAgo(3), lastStatus: 'ok' });
    summaries.set('yugipedia', {
      lastSuccessAt: hoursAgo(7 * 24 + 5),
      lastStatus: 'ok',
      runningSince: hoursAgo(4),
    });
    // Stuck longer than the cadence: missing again.
    summaries.set('scryfall', {
      lastSuccessAt: hoursAgo(30),
      lastStatus: 'ok',
      runningSince: hoursAgo(25),
    });
    const health = importHealth(summaries, 'prod', now);
    expect(health.message).toBe('missing: scryfall');
  });

  it('names the price sources whose prints were not refreshed (VB-116)', () => {
    // 95 % refreshed is fine, 94.9 % is not; a game without a priced print says nothing.
    expect(freshnessProblems([fresh('mtg', 1000, 950), fresh('yugioh', 0, 0)])).toEqual([]);
    expect(freshnessProblems([fresh('mtg', 1000, 949)])).toEqual([
      'tcgplayer/mtg 94.9% refreshed in 24 h',
    ]);
    // More stale prints than the day before, though the share is fine: a few more each day stay
    // green (at least 25, or 0.5 % of the priced prints), 1 % more is real growth.
    const before = [fresh('mtg', 100_000, 99_000, 300)];
    expect(freshnessProblems([fresh('mtg', 100_000, 99_000, 302)], before)).toEqual([]);
    expect(freshnessProblems([fresh('mtg', 100_000, 99_000, 800)], before)).toEqual([]);
    expect(freshnessProblems([fresh('mtg', 100_000, 99_000, 1300)], before)).toEqual([
      'tcgplayer/mtg 1300 stale (was 300)',
    ]);
    expect(freshnessProblems([fresh('mtg', 1000, 990, 36)], [fresh('mtg', 1000, 990, 10)])).toEqual(
      ['tcgplayer/mtg 36 stale (was 10)'],
    );
    expect(freshnessProblems([fresh('mtg', 1000, 990, 35)], [fresh('mtg', 1000, 990, 10)])).toEqual(
      [],
    );

    const summaries = all({ lastSuccessAt: hoursAgo(3), lastStatus: 'ok' });
    summaries.set('tcgcsv', {
      lastSuccessAt: hoursAgo(3),
      lastStatus: 'ok',
      freshness: {
        latest: [fresh('mtg', 1000, 990, 40), fresh('pokemon', 100, 80)],
        previous: [fresh('mtg', 1000, 990, 10), fresh('pokemon', 100, 100)],
      },
    });
    const health = importHealth(summaries, 'prod', now);
    expect(health).toMatchObject({
      ok: false,
      message: 'stale: tcgplayer/mtg 40 stale (was 10), tcgplayer/pokemon 80.0% refreshed in 24 h',
    });
    expect(health.sources.find((s) => s.source === 'tcgcsv')).toMatchObject({
      missing: false,
      failed: false,
      stale: true,
    });
    expect(health.sources.find((s) => s.source === 'scryfall')).toMatchObject({ stale: false });
  });

  it('leaves out what dev does not schedule (TCGCSV)', () => {
    const health = importHealth(new Map(), 'dev', now);
    expect(health.sources.map((s) => s.source)).not.toContain('tcgcsv');
    expect(health.message).not.toContain('tcgcsv');
  });
});

describe.skipIf(!databaseUrl)('GET /admin/imports (Postgres)', () => {
  let db: NodePgDatabase;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshDatabase()));
  afterAll(() => drop());

  it('lists the last 30 runs per source and the health of the scheduled ones', async () => {
    const at = (h: number) => sql`now() - make_interval(secs => ${h * 3600})`;
    await db.insert(importRuns).values([
      // 32 Scryfall runs, the newest failed: listed 30, the last success 1 day ago.
      ...Array.from({ length: 32 }, (_, i) => ({
        source: 'scryfall',
        kind: 'full',
        status: i === 0 ? 'failed' : 'ok',
        startedAt: at(i * 24 + 1),
        finishedAt: at(i * 24 + 0.5),
        error: i === 0 ? 'HTTP 429' : null,
        stats: { cards: i },
      })),
      // A running TCGdex run after a successful one: not failed.
      { source: 'tcgdex', kind: 'delta', status: 'running', startedAt: at(0.1) },
      { source: 'tcgdex', kind: 'delta', status: 'ok', startedAt: at(25), finishedAt: at(24.5) },
      // The VPS mirror (`sm`) and a Workflow's image step are told apart.
      {
        source: 'images',
        kind: 'images',
        status: 'ok',
        startedAt: at(2),
        finishedAt: at(1),
        stats: { query: { sm: true }, failed: 14 },
      },
      {
        source: 'images',
        kind: 'images',
        status: 'ok',
        startedAt: at(3),
        finishedAt: at(2.9),
        stats: { query: { game: 'mtg', limit: 2000 } },
      },
    ]);
    const app = testApp({ adminToken: 't', db });
    const get = (path: string, token = 't') =>
      app.request(path, { headers: { Authorization: `Bearer ${token}` } });

    const res = await get('/admin/imports');
    expect(res.status).toBe(200);
    const body = ImportsResponseSchema.parse(await res.json());
    expect(body.runs.scryfall).toHaveLength(30);
    expect(body.runs.scryfall?.[0]).toMatchObject({
      status: 'failed',
      error: 'HTTP 429',
      durationSeconds: 1800,
    });
    expect(body.runs['image-mirror']?.[0]?.stats).toMatchObject({ failed: 14 });
    expect(body.runs.images).toHaveLength(1);
    const health = Object.fromEntries(body.health.sources.map((s) => [s.source, s]));
    expect(health.scryfall).toMatchObject({ missing: false, failed: true, lastStatus: 'failed' });
    expect(health.tcgdex).toMatchObject({ missing: false, failed: false, lastStatus: 'ok' });
    expect(health['image-mirror']).toMatchObject({ missing: false, failed: false });
    expect(health.ygoprodeck).toMatchObject({ missing: true, lastSuccessAt: null });

    const only = ImportHealthSchema.parse(await (await get('/admin/imports/health')).json());
    expect(only).toEqual(body.health);
    expect(only.ok).toBe(false);
    expect(only.message).toMatch(/^missing: ygoprodeck, tcgcsv, yugipedia, .*; failed: scryfall$/);

    expect((await get('/admin/imports/health', 'wrong')).status).toBe(401);
    expect((await testApp({ db }).request('/admin/imports/health')).status).toBe(404);
  });

  it('compares the freshness of the newest price run with the day before (VB-116)', async () => {
    const at = (h: number) => sql`now() - make_interval(secs => ${h * 3600})`;
    const run = (h: number, stale: number | null, status = 'ok') => ({
      source: 'tcgcsv',
      kind: 'prices',
      status,
      startedAt: at(h),
      finishedAt: at(h - 0.2),
      stats: stale === null ? {} : { freshness: [fresh('mtg', 1000, 1000, stale)] },
    });
    await db.insert(importRuns).values([
      // Newest first: a failed run (never compared), the latest ok one, one of the same evening
      // (too recent to be the day before), the day before, and the day before that.
      run(0.5, 50, 'failed'),
      run(1, 40),
      run(3, 1),
      run(23, 10),
      run(47, 99),
      // A run from before VB-116 without freshness.
      run(70, null),
    ]);
    const health = ImportHealthSchema.parse(
      await (
        await testApp({ adminToken: 't', db }).request('/admin/imports/health', {
          headers: { Authorization: 'Bearer t' },
        })
      ).json(),
    );
    expect(health.message).toContain('stale: tcgplayer/mtg 40 stale (was 10)');
    expect(health.sources.find((s) => s.source === 'tcgcsv')).toMatchObject({ stale: true });
  });
});
