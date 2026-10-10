import { createHash } from 'node:crypto';
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { ModuleManifestSchema } from '@voidbinder/shared/api';
import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import type { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { writeScryfallPrices } from '../src/import/prices/scryfall';
import { runScryfallImport } from '../src/import/scryfall/pipeline';
import { fakeScryfall, fixture, MemoryBlobStore } from '../src/import/scryfall/test-fixtures';
import { databaseUrl, freshDatabase } from '../src/test-helpers';
import {
  buildModule,
  diffModules,
  MAX_DELTAS,
  nextManifest,
  SCHEMA_VERSION,
  TABLES,
} from './build-catalog-module';

const BUILT_AT = '2026-10-10T06:30:00.000Z';
const sha = (path: string) => createHash('sha256').update(readFileSync(path)).digest('hex');

/** Every table's rows in key order; print_localizations without its local `id`. */
function dump(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return Object.fromEntries(
      Object.entries(TABLES).map(([table, { key, columns }]) => [
        table,
        db.prepare(`SELECT ${columns.join(', ')} FROM ${table} ORDER BY ${key.join(', ')}`).all(),
      ]),
    );
  } finally {
    db.close();
  }
}

/** print_id and name of every localization whose name matches the FTS query. */
function search(path: string, query: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return db
      .prepare(
        `SELECT l.print_id, l.lang, l.name FROM names_fts f
         JOIN print_localizations l ON l.id = f.rowid
         WHERE names_fts MATCH ? ORDER BY l.print_id, l.lang`,
      )
      .all(query);
  } finally {
    db.close();
  }
}

describe('nextManifest', () => {
  const base = {
    game: 'mtg' as const,
    schemaVersion: SCHEMA_VERSION,
    minAppSchemaVersion: 1,
    builtAt: BUILT_AT,
    module: {
      url: 'https://img.example.test/modules/dev/mtg/catalog-mtg-v2.sqlite.gz',
      size: 10,
      sha256: 'a'.repeat(64),
      rawSize: 20,
      rawSha256: 'b'.repeat(64),
    },
  };
  const delta = (from: number, to: number) => ({
    from,
    to,
    url: `https://img.example.test/modules/dev/mtg/catalog-mtg-v${from}-v${to}.sql.gz`,
    size: 1,
    sha256: 'c'.repeat(64),
  });

  it('appends to the chain that ends at the delta, drops a broken chain', () => {
    const v2 = nextManifest(null, { ...base, version: 2 }, delta(1, 2));
    expect(ModuleManifestSchema.parse(v2)).toEqual(v2);
    expect(v2.deltas).toEqual([delta(1, 2)]);
    const v5 = nextManifest(v2, { ...base, version: 5 }, delta(2, 5));
    expect(v5.deltas.map((d) => [d.from, d.to])).toEqual([
      [1, 2],
      [2, 5],
    ]);
    // No delta, or a delta from a version the manifest never had: the old chain is useless.
    expect(nextManifest(v5, { ...base, version: 6 }, null).deltas).toEqual([]);
    expect(nextManifest(v5, { ...base, version: 7 }, delta(6, 7)).deltas).toEqual([delta(6, 7)]);
  });

  it(`keeps the last ${MAX_DELTAS} deltas`, () => {
    let m = nextManifest(null, { ...base, version: 1 }, null);
    for (let v = 2; v <= MAX_DELTAS + 5; v++)
      m = nextManifest(m, { ...base, version: v }, delta(v - 1, v));
    expect(m.deltas).toHaveLength(MAX_DELTAS);
    expect(m.deltas[0]?.from).toBe(5);
    expect(m.deltas.at(-1)?.to).toBe(MAX_DELTAS + 5);
  });
});

describe.skipIf(!databaseUrl)('build-catalog-module (Postgres)', () => {
  let db: NodePgDatabase;
  let drop: () => Promise<void>;
  let pool: Pool;
  let dir: string;
  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await runScryfallImport(
      { fetch: fakeScryfall(), raw: new MemoryBlobStore(), withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-09', languages: ['en', 'de'] },
    );
    await writeScryfallPrices(
      db,
      fixture('default_cards.jsonl').trim().split('\n'),
      '2026-10-09T00:00:00Z',
    );
    // drizzle's node-postgres client is the test database's pool.
    pool = (db as unknown as { $client: Pool }).$client;
    dir = mkdtempSync(join(tmpdir(), 'catalog-module-'));
  });
  afterAll(async () => {
    await drop();
    rmSync(dir, { recursive: true, force: true });
  });

  const v1 = () => join(dir, 'v1.sqlite');

  it('builds the tables, the meta row and the name index', async () => {
    const { version, rows } = await buildModule(pool, 'mtg', v1(), BUILT_AT);
    // 28 prints in 2 sets, 27 cards; en for each print plus 2 German (ja and fr are not kept).
    expect(rows).toEqual({
      meta: 4,
      sets: 2,
      cards: 27,
      prints: 28,
      print_localizations: 29,
      prices: expect.any(Number),
    });
    const tables = dump(v1());
    expect(tables.meta).toEqual([
      { key: 'built_at', value: BUILT_AT },
      { key: 'game', value: 'mtg' },
      { key: 'schema_version', value: String(SCHEMA_VERSION) },
      { key: 'version', value: String(version) },
    ]);
    // One display price per print, finish and currency: Adeline has normal + foil in EUR + USD.
    const adeline = search(v1(), 'adeline')[0] as { print_id: string };
    expect(
      (tables.prices as { print_id: string }[]).filter((p) => p.print_id === adeline.print_id),
    ).toEqual([
      expect.objectContaining({
        finish: 'foil',
        currency: 'EUR',
        cents: 523,
        source: 'cardmarket',
      }),
      expect.objectContaining({ finish: 'foil', currency: 'USD', cents: 433 }),
      expect.objectContaining({ finish: 'normal', currency: 'EUR', cents: 334 }),
      expect.objectContaining({
        finish: 'normal',
        currency: 'USD',
        cents: 402,
        source: 'tcgplayer_scryfall',
        observed_at: '2026-10-09T00:00:00Z',
      }),
    ]);
    expect(rows.prices).toBe((tables.prices as unknown[]).length);
  });

  it('finds a card by its German name, umlauts folded', () => {
    expect(search(v1(), 'strahlende katharerin')).toEqual([
      expect.objectContaining({ lang: 'de', name: 'Adeline, strahlende Katharerin' }),
    ]);
    expect(search(v1(), 'stra*')).toHaveLength(1);
  });

  it('gives the same bytes for the same input', async () => {
    const again = join(dir, 'again.sqlite');
    await buildModule(pool, 'mtg', again, BUILT_AT);
    expect(sha(again)).toEqual(sha(v1()));
  });

  it('builds a delta that turns the old module into the new one', async () => {
    await db.execute(sql`
      update cards set text = 'Errata text.' where name = 'Blessed Defiance';
      update print_localizations set name = 'Adeline, die Strahlende' where lang = 'de'
        and name like 'Adeline%';
      delete from prints where number = '20' and set_id = (select id from sets where code = 'mid');
      update prices_current set cents_market = 999 where source = 'cardmarket' and finish = 'normal'
        and print_id = (select p.id from prints p join sets s on s.id = p.set_id
          where s.code = 'mid' and p.number = '1');
      insert into print_localizations (print_id, lang, name)
        select p.id, 'de', 'Segen des Trotzes' from prints p join cards c on c.id = p.card_id
        where c.name = 'Blessed Defiance';
      update app_meta set value = (value::int + 3)::text where key = 'catalog_version';
    `);
    const v2 = join(dir, 'v2.sqlite');
    await buildModule(pool, 'mtg', v2, '2026-10-11T06:30:00.000Z');

    const delta = diffModules(v1(), v2);
    expect(delta).toMatch(/^-- catalog-mtg v\d+ -> v\d+\n/);
    expect(delta).toContain('DELETE FROM prints WHERE id = ');
    expect(delta).toContain("'Errata text.'");

    const patched = join(dir, 'patched.sqlite');
    copyFileSync(v1(), patched);
    const target = new DatabaseSync(patched);
    target.exec('BEGIN');
    target.exec(delta);
    target.exec('COMMIT');
    target.exec(`INSERT INTO names_fts (names_fts) VALUES ('integrity-check')`);
    target.close();

    expect(dump(patched)).toEqual(dump(v2));
    expect(search(patched, 'strahlende katharerin')).toEqual([]);
    expect(search(patched, 'strahlende')).toEqual(search(v2, 'strahlende'));
    expect(search(patched, 'trotzes')).toHaveLength(1);
    // Nothing to do between equal modules but nothing at all.
    expect(diffModules(v2, v2).trim().split('\n')).toHaveLength(1);
  });
});
