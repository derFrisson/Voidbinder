import { ImportHealthSchema, ImportsResponseSchema } from '@voidbinder/shared/api';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importRuns } from '../db/schema';
import { databaseUrl, freshDatabase, testApp } from '../test-helpers';
import { importHealth, IMPORT_CADENCE, type SourceSummary } from './health';

const now = Date.parse('2026-10-10T07:30:00Z');
const hoursAgo = (h: number) => new Date(now - h * 3_600_000);
const all = (summary: SourceSummary) =>
  new Map(Object.keys(IMPORT_CADENCE).map((s) => [s, summary]));

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
});
