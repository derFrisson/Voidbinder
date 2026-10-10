import { readdir, readFile } from 'node:fs/promises';
import { SearchSuggestQuerySchema, type SearchSuggestion } from '@voidbinder/shared/api';
import { eq, inArray, sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getPlatformProxy } from 'wrangler';
import { printLocalizations, prints, sets } from '../../db/schema';
import { refreshSearchIndex } from '../../import/search-index';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import { seedSearchCatalog } from '../../test-search-fixtures';
import { codeKey, D1SearchIndex, MAX_INDEX_AGE_MS, numberKey, similarity } from './d1-search-index';
import { DrizzleCardStore } from './drizzle-card-store';

const migrations = new URL('../../../d1/', import.meta.url).pathname;

/** Applies d1/*.sql, one statement per line (comments and blank lines skipped). */
async function migrate(d1: D1Database) {
  for (const file of (await readdir(migrations)).filter((f) => f.endsWith('.sql')).sort()) {
    const statements = (await readFile(`${migrations}${file}`, 'utf8'))
      .split('\n')
      .filter((l) => l.trim() && !l.startsWith('--'));
    await d1.batch(statements.map((s) => d1.prepare(s)));
  }
}

describe('the query side of the Postgres key functions and pg_trgm', () => {
  it.each([
    ['SV01', 'sv1'],
    ['sv03.5', 'sv35'],
    ['LDS3', 'lds3'],
    ['swsh12', 'swsh12'],
    ['a0b00c', 'a0b0c'],
    ['100', '100'],
  ])('codeKey(%j) = %j', (code, key) => expect(codeKey(code)).toBe(key));

  it.each([
    ['EN121', '121'],
    ['001', '1'],
    ['TG01', '1'],
    ['12a', '12a'],
    ['000', null],
    ['en', 'en'],
    ['', null],
  ])('numberKey(%j) = %j', (n, key) => expect(numberKey(n)).toBe(key));

  it('similarity: equal and disjoint names (pg_trgm’s own values in the database test)', () => {
    expect(similarity('word', 'word')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
  });
});

// The same fixture queries against Postgres and the index the refresh wrote into a local D1
// (miniflare through wrangler's getPlatformProxy).
describe.skipIf(!databaseUrl)('search index in D1 (parity with Postgres)', () => {
  let db: NodePgDatabase;
  let drop: () => Promise<void>;
  let d1: D1Database;
  let dispose: () => Promise<void>;
  let store: DrizzleCardStore;
  let index: D1SearchIndex;
  const refresh = (full = false) =>
    refreshSearchIndex({ d1, withDb: (fn) => fn(db) }, (_name, fn) => fn(), {
      full,
      owner: 'test',
    });

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await seedSearchCatalog(db);
    const proxy = await getPlatformProxy<{ SEARCH: D1Database }>({
      configPath: new URL('../../../test/fixtures/search-index.wrangler.jsonc', import.meta.url)
        .pathname,
      persist: false,
      remoteBindings: false,
    });
    d1 = proxy.env.SEARCH;
    dispose = proxy.dispose;
    await migrate(d1);
    store = new DrizzleCardStore(db);
    index = new D1SearchIndex(d1);
  }, 60_000);
  afterAll(async () => {
    await dispose?.();
    await drop?.();
  });

  it('answers nothing before the first refresh', async () => {
    expect(await index.suggest(SearchSuggestQuerySchema.parse({ q: 'lds3' }), 8)).toBeNull();
  });

  it('copies every set on the first refresh, nothing on the next', async () => {
    const first = await refresh();
    expect(first).toMatchObject({ status: 'ok', sets: 9, setsWritten: 9, setsRemoved: 0 });
    expect(first.rowsWritten).toBeGreaterThan(0);
    const counts = await d1
      .prepare(
        `select (select count(*) from sets) as sets, (select count(*) from prints) as prints,
          (select count(*) from names) as names`,
      )
      .first();
    expect(counts).toEqual({ sets: 9, prints: 30, names: 32 });
    expect(await refresh()).toMatchObject({ status: 'ok', setsWritten: 0, setsRemoved: 0 });
  });

  it('computes similarity as pg_trgm does', async () => {
    const pairs = [
      ['Satellite Warrior', 'Satelite'],
      ['Satellite Warrior', 'Satelite Warior'],
      ['Satellitenkrieger', 'Satellitenkriger'],
      ['Ethan’s Pinsir', 'ethans pinsir'],
      ['Tamiyo, Collector of Tales', 'tamiyo collecter'],
      ['ポケモンカード', 'ポケモン'],
      ['Æther Vial', 'aether vial'],
    ];
    for (const [a = '', b = ''] of pairs) {
      const { rows } = await db.execute<{ s: number }>(sql`select similarity(${a}, ${b}) as s`);
      // A real (float4), which the driver prints in its shortest form.
      expect(similarity(a, b), `${a} / ${b}`).toBe(Math.fround(Number(rows[0]?.s)));
    }
  });

  const label = (s: SearchSuggestion) => `${s.kind} ${s.set.code} ${s.number ?? ''} ${s.name}`;

  // Every tier: exact codes, language codes, typed splits, partial numbers, a set named alone,
  // pure numbers, set names, name prefixes in every language and in one, typos.
  it.each([
    ['LDS3-EN121'],
    ['lds3en12'],
    ['blgg de024'],
    ['BLGG-JP024'],
    ['swsh1 25'],
    ['swsh12 5'],
    ['sv1 01'],
    ['sv10 1'],
    ['war 97'],
    ['mid'],
    ['sv1'],
    ['001'],
    ['001/198'],
    ['legendary du'],
    ['satel'],
    ['sat'],
    ['sat', '&game=pokemon'],
    ['Satelite'],
    ['pineco'],
    ['satelliten', '&lang=de'],
    ['satellitenk', '&names=de'],
    ['tannza'],
    ['tannza', '&names=de&lang=de'],
    ['stardust', '&names=de'],
  ])('suggest %j%s: same answer as Postgres', async (q, extra = '') => {
    const query = SearchSuggestQuerySchema.parse({
      q,
      ...Object.fromEntries(new URLSearchParams(extra)),
    });
    const [pg, d1Answer] = await Promise.all([store.suggest(query, 8), index.suggest(query, 8)]);
    expect(d1Answer?.catalogVersion).toBe('0');
    expect(d1Answer?.result.suggestions.map(label)).toEqual(pg.suggestions.map(label));
    expect(d1Answer?.result).toEqual(pg);
  });

  it('rewrites a changed set and deletes a removed one', async () => {
    const [pineco] = await db
      .select({ id: prints.id, setId: prints.setId })
      .from(prints)
      .innerJoin(sets, eq(sets.id, prints.setId))
      .where(eq(sets.code, 'sv01'))
      .limit(1);
    await db
      .update(printLocalizations)
      .set({ name: 'Tannzadeluxe' })
      .where(eq(printLocalizations.name, 'Tannza'));
    const base1 = db.select({ id: sets.id }).from(sets).where(eq(sets.code, 'base1'));
    await db.delete(prints).where(inArray(prints.setId, base1));
    await db.delete(sets).where(eq(sets.code, 'base1'));

    expect(await refresh()).toMatchObject({ setsWritten: 1, setsRemoved: 1 });
    const q = SearchSuggestQuerySchema.parse({ q: 'tannzadel', names: 'de', lang: 'de' });
    expect((await index.suggest(q, 8))?.result.suggestions.map((s) => s.id)).toEqual([pineco?.id]);
    expect(await d1.prepare(`select count(*) as n from sets where code = 'base1'`).first('n')).toBe(
      0,
    );
    // A full rebuild rewrites every set and leaves the same index.
    expect(await refresh(true)).toMatchObject({ setsWritten: 8, setsRemoved: 0 });
  });

  it('is unusable once the last refresh is older than MAX_INDEX_AGE_MS', async () => {
    const syncedAt = Date.parse(
      (await d1.prepare(`select value from meta where key = 'synced_at'`).first('value')) ?? '',
    );
    const q = SearchSuggestQuerySchema.parse({ q: 'lds3' });
    expect(
      await new D1SearchIndex(d1, { now: () => syncedAt + MAX_INDEX_AGE_MS }).suggest(q, 8),
    ).not.toBeNull();
    expect(
      await new D1SearchIndex(d1, { now: () => syncedAt + MAX_INDEX_AGE_MS + 1 }).suggest(q, 8),
    ).toBeNull();
  });

  it('runs one refresh at a time', async () => {
    await d1
      .prepare(`insert into meta (key, value) values ('lock', ?1)`)
      .bind(JSON.stringify({ owner: 'other', at: Date.now() }))
      .run();
    expect(await refresh()).toEqual({ status: 'busy' });
    await d1.prepare(`delete from meta where key = 'lock'`).run();
    expect(await refresh()).toMatchObject({ status: 'ok' });
  });
});
