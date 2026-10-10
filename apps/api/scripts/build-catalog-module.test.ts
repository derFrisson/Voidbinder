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
  attributionOf,
  buildModule,
  diffModules,
  MAX_DELTAS,
  nextManifest,
  plan,
  prune,
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

describe('plan', () => {
  const published = { version: 5, schemaVersion: SCHEMA_VERSION };
  const base = {
    published,
    current: 7,
    localVersions: [3, 5],
    version: 7,
    upload: true,
    schemaVersion: SCHEMA_VERSION,
  };
  it.each([
    ['nothing published: no delta', { published: null }, { skip: false, from: null }],
    ['up to date: skip', { current: 5, version: 5 }, { skip: true, from: null }],
    ['published v5 with v5 local: delta from v5', {}, { skip: false, from: 5 }],
    [
      'published module missing locally: no delta',
      { localVersions: [3] },
      { skip: false, from: null },
    ],
    [
      'schema bump: no skip, no delta',
      { published: { ...published, schemaVersion: 0 } },
      { skip: false, from: null },
    ],
    [
      'schema bump on the same version: rebuilt, no delta',
      { published: { version: 7, schemaVersion: 0 }, current: 7 },
      { skip: false, from: null },
    ],
    [
      'no upload: newest older local module',
      { upload: false, published: null },
      { skip: false, from: 5 },
    ],
    [
      'no upload: none older',
      { upload: false, published: null, localVersions: [7, 9] },
      { skip: false, from: null },
    ],
  ])('%s', (_name, change, expected) => {
    expect(plan({ ...base, ...change })).toEqual(expected);
  });
});

describe('attribution (VB-93)', () => {
  it('credits Yugipedia in a Yu-Gi-Oh! manifest, which the schema keeps', () => {
    expect(attributionOf('mtg')).toBeUndefined();
    // VB-118: the pictures TCGdex lacks come from pokemontcg.io.
    expect(attributionOf('pokemon')).toBe(
      'Card images: Pokémon TCG API (pokemontcg.io), https://pokemontcg.io',
    );
    const attribution = attributionOf('yugioh');
    expect(attribution).toMatch(/Yugipedia \(CC BY-SA 4\.0\), https:\/\/creativecommons/);
    const manifest = nextManifest(
      null,
      {
        game: 'yugioh',
        version: 1,
        schemaVersion: SCHEMA_VERSION,
        minAppSchemaVersion: 1,
        builtAt: BUILT_AT,
        module: {
          url: 'https://img.example.test/m.sqlite.gz',
          size: 1,
          sha256: 'a'.repeat(64),
          rawSize: 1,
          rawSha256: 'b'.repeat(64),
        },
        ...(attribution ? { attribution } : {}),
      },
      null,
    );
    expect(ModuleManifestSchema.parse(manifest).attribution).toBe(attribution);
  });
});

describe('prune', () => {
  const file = (name: string) => `https://img.example.test/modules/dev/mtg/${name}`;
  const manifest = (version: number, deltas: [number, number][]) =>
    ModuleManifestSchema.parse({
      game: 'mtg',
      version,
      schemaVersion: SCHEMA_VERSION,
      minAppSchemaVersion: 1,
      builtAt: BUILT_AT,
      module: {
        url: file(`catalog-mtg-v${version}-s1.sqlite.gz`),
        size: 1,
        sha256: 'a'.repeat(64),
        rawSize: 1,
        rawSha256: 'b'.repeat(64),
      },
      deltas: deltas.map(([from, to]) => ({
        from,
        to,
        url: file(`catalog-mtg-v${from}-v${to}-s1.sql.gz`),
        size: 1,
        sha256: 'c'.repeat(64),
      })),
    });

  it('keeps the manifest, its files and the previous module, deletes the rest', async () => {
    const keys = new Set(
      [
        'manifest.json',
        'catalog-mtg-v1-s1.sqlite.gz',
        'catalog-mtg-v3-s1.sqlite.gz',
        'catalog-mtg-v5-s1.sqlite.gz',
        'catalog-mtg-v1-v3-s1.sql.gz',
        'catalog-mtg-v3-v5-s1.sql.gz',
        'catalog-mtg-v5-v7-s1.sql.gz',
        'catalog-mtg-v7-s1.sqlite.gz',
      ].map((f) => `modules/dev/mtg/${f}`),
    );
    keys.add('modules/dev/pokemon/catalog-pokemon-v1-s1.sqlite.gz');
    const store = {
      list: async (prefix: string) => [...keys].filter((k) => k.startsWith(prefix)),
      delete: async (key: string) => void keys.delete(key),
    };
    const previous = manifest(5, [[3, 5]]);
    const next = manifest(7, [[5, 7]]);
    const deleted = await prune(store, 'modules/dev/mtg', next, previous);
    expect(deleted.sort()).toEqual(
      [
        'catalog-mtg-v1-s1.sqlite.gz',
        'catalog-mtg-v3-s1.sqlite.gz',
        'catalog-mtg-v1-v3-s1.sql.gz',
        'catalog-mtg-v3-v5-s1.sql.gz',
      ]
        .map((f) => `modules/dev/mtg/${f}`)
        .sort(),
    );
    expect([...keys].sort()).toEqual(
      [
        'modules/dev/mtg/manifest.json',
        'modules/dev/mtg/catalog-mtg-v5-s1.sqlite.gz',
        'modules/dev/mtg/catalog-mtg-v5-v7-s1.sql.gz',
        'modules/dev/mtg/catalog-mtg-v7-s1.sqlite.gz',
        'modules/dev/pokemon/catalog-pokemon-v1-s1.sqlite.gz',
      ].sort(),
    );
    // The next run drops v5 too.
    await prune(store, 'modules/dev/mtg', manifest(9, [[7, 9]]), next);
    expect(keys.has('modules/dev/mtg/catalog-mtg-v5-s1.sqlite.gz')).toBe(false);
    expect(keys.has('modules/dev/mtg/catalog-mtg-v7-s1.sqlite.gz')).toBe(true);
  });
});

describe('nextManifest', () => {
  const base = {
    game: 'mtg' as const,
    schemaVersion: SCHEMA_VERSION,
    minAppSchemaVersion: 1,
    builtAt: BUILT_AT,
    module: {
      url: 'https://img.example.test/modules/dev/mtg/catalog-mtg-v2-s1.sqlite.gz',
      size: 10,
      sha256: 'a'.repeat(64),
      rawSize: 20,
      rawSha256: 'b'.repeat(64),
    },
  };
  const delta = (from: number, to: number) => ({
    from,
    to,
    url: `https://img.example.test/modules/dev/mtg/catalog-mtg-v${from}-v${to}-s1.sql.gz`,
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
    // One display price per print, finish, currency and language: Adeline has normal + foil in
    // EUR + USD, English copies.
    const adeline = search(v1(), 'adeline')[0] as { print_id: string };
    expect(
      (tables.prices as { print_id: string }[]).filter((p) => p.print_id === adeline.print_id),
    ).toEqual([
      expect.objectContaining({
        finish: 'foil',
        currency: 'EUR',
        lang: 'en',
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
      update cards set text = E'Errata line one.\nIt''s line two;\n-- not a comment' where name = 'Blessed Defiance';
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
    expect(delta).toContain("'Errata line one.\nIt''s line two;\n-- not a comment'");

    const patched = join(dir, 'patched.sqlite');
    copyFileSync(v1(), patched);
    const target = new DatabaseSync(patched);
    target.exec('BEGIN');
    target.exec(delta);
    target.exec('COMMIT');
    target.exec(`INSERT INTO names_fts (names_fts) VALUES ('integrity-check')`);
    target.close();

    expect(dump(patched)).toEqual(dump(v2));
    expect((dump(patched).cards as { text: string | null }[]).map((c) => c.text)).toContain(
      "Errata line one.\nIt's line two;\n-- not a comment",
    );
    expect(search(patched, 'strahlende katharerin')).toEqual([]);
    expect(search(patched, 'strahlende')).toEqual(search(v2, 'strahlende'));
    expect(search(patched, 'trotzes')).toHaveLength(1);
    // Nothing to do between equal modules but nothing at all.
    expect(diffModules(v2, v2).trim().split('\n')).toHaveLength(1);
  });
});
