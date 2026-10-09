import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { importRuns } from '../db/schema';
import { startRun, type Db } from '../import/scryfall/write';
import { DrizzleCardStore } from '../platform/cloudflare/drizzle-card-store';
import { databaseUrl, freshDatabase, testApp } from '../test-helpers';

describe.skipIf(!databaseUrl)('POST /admin/import/scryfall (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshDatabase()));
  afterAll(() => drop());

  it('answers 409 while a run started less than 6 h ago is running', async () => {
    // The fake queue does what the Workflow's first step does: a `running` row.
    const jobQueue = { send: async () => void (await startRun(db, 'full')) };
    const app = testApp({ adminToken: 't', jobQueue, cardStore: new DrizzleCardStore(db) });
    const post = () =>
      app.request('/admin/import/scryfall', {
        method: 'POST',
        headers: { Authorization: 'Bearer t' },
      });

    expect((await post()).status).toBe(202);
    const second = await post();
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: { code: 'import_running' } });

    // A run stuck for longer counts as dead.
    await db.update(importRuns).set({ startedAt: sql`now() - interval '7 hours'` });
    expect((await post()).status).toBe(202);
  });
});
