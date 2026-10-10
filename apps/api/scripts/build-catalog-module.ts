// Offline catalog modules (VB-29), run on the database VPS (docs/guides/database-vps.md, section 12):
// one prebuilt SQLite file per game with the sets, cards, prints, en/de localizations, image keys,
// display prices and an FTS5 name index, gzipped, plus a delta from the previous version, both
// published to R2 with a manifest. Schema and the app's contract: docs/architecture/catalog-module.md.
//
//   pnpm --filter api build-catalog-module --env-file ~/.config/voidbinder/r2.env
//     --env-file ~/.config/voidbinder/pg.env --db dev --game yugioh --out ~/catalog-modules/dev
//     [--upload]
//
// Without --upload it only builds into --out (and a delta from the newest older module there).
// With --upload it skips a game whose published manifest already has the current catalog_version,
// builds the delta from the published version when that module is still in --out, uploads the
// files and the manifest last, deletes what the new manifest no longer names (the previous module
// stays one more run), and keeps only the new SQLite file in --out for the next delta.
//
// Env (from --env-file or the shell): PG_MIRROR_URL_DEV / PG_MIRROR_URL_PROD for `--db`, else
// DATABASE_URL; for --upload R2_ENDPOINT, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY, R2_BUCKET
// (default voidbinder-catalog) and MODULES_PUBLIC_URL (default https://img.voidbinder.de).
import { createHash } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { parseArgs } from 'node:util';
import { gzipSync } from 'node:zlib';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { SOURCE_PREFERENCE } from '@voidbinder/core';
import { GameSchema } from '@voidbinder/shared';
import {
  ModuleManifestSchema,
  type ModuleDelta,
  type ModuleManifest,
} from '@voidbinder/shared/api';
import { Pool, type PoolClient } from 'pg';
import { log } from '../src/middleware/log';

/** Schema of the SQLite file; bump on any change to the tables below. */
export const SCHEMA_VERSION = 1;
/** The oldest app reader that can open this schema (raise it only for a breaking change). */
export const MIN_APP_SCHEMA_VERSION = 1;
/** Languages kept in the module. */
export const LANGS = ['en', 'de'];
/** Deltas kept in a manifest; an app further behind downloads the whole module. */
export const MAX_DELTAS = 30;

/** Every table but the FTS index: key and columns, in the order of the Postgres queries below. */
export const TABLES = {
  meta: { key: ['key'], columns: ['key', 'value'] },
  sets: {
    key: ['id'],
    columns: ['id', 'code', 'name', 'name_de', 'released_on', 'card_count', 'kind', 'image_key'],
  },
  cards: { key: ['id'], columns: ['id', 'name', 'type_line', 'text', 'attributes', 'legalities'] },
  prints: {
    key: ['id'],
    columns: [
      'id',
      'card_id',
      'set_id',
      'number',
      'variant',
      'rarity',
      'finishes',
      'artist',
      'image_key',
      'released_on',
    ],
  },
  print_localizations: {
    key: ['print_id', 'lang'],
    columns: ['print_id', 'lang', 'name', 'text', 'image_key'],
  },
  prices: {
    key: ['print_id', 'finish', 'currency'],
    columns: ['print_id', 'finish', 'currency', 'cents', 'source', 'observed_at'],
  },
} as const;
type Table = keyof typeof TABLES;

const SCHEMA = `
CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE sets (
  id TEXT PRIMARY KEY, code TEXT NOT NULL, name TEXT NOT NULL, name_de TEXT, released_on TEXT,
  card_count INTEGER, kind TEXT, image_key TEXT
) WITHOUT ROWID;
CREATE TABLE cards (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, type_line TEXT, text TEXT,
  attributes TEXT NOT NULL, legalities TEXT NOT NULL
) WITHOUT ROWID;
CREATE TABLE prints (
  id TEXT PRIMARY KEY, card_id TEXT NOT NULL, set_id TEXT NOT NULL, number TEXT NOT NULL,
  variant TEXT NOT NULL, rarity TEXT, finishes TEXT NOT NULL, artist TEXT, image_key TEXT,
  released_on TEXT
) WITHOUT ROWID;
CREATE INDEX prints_card_id ON prints (card_id);
CREATE INDEX prints_set_id_number ON prints (set_id, number);
-- The FTS index's content table: an INTEGER PRIMARY KEY, because VACUUM may renumber implicit rowids.
CREATE TABLE print_localizations (
  id INTEGER PRIMARY KEY, print_id TEXT NOT NULL, lang TEXT NOT NULL, name TEXT NOT NULL,
  text TEXT, image_key TEXT, UNIQUE (print_id, lang)
);
CREATE TABLE prices (
  print_id TEXT NOT NULL, finish TEXT NOT NULL, currency TEXT NOT NULL, cents INTEGER NOT NULL,
  source TEXT NOT NULL, observed_at TEXT NOT NULL, PRIMARY KEY (print_id, finish, currency)
) WITHOUT ROWID;
CREATE VIRTUAL TABLE names_fts USING fts5 (
  name, content = 'print_localizations', content_rowid = 'id',
  tokenize = 'unicode61 remove_diacritics 2'
);`;

// Keep names_fts in step with print_localizations; a delta's upserts and deletes go through these.
const TRIGGERS = `
CREATE TRIGGER print_localizations_ai AFTER INSERT ON print_localizations BEGIN
  INSERT INTO names_fts (rowid, name) VALUES (new.id, new.name);
END;
CREATE TRIGGER print_localizations_ad AFTER DELETE ON print_localizations BEGIN
  INSERT INTO names_fts (names_fts, rowid, name) VALUES ('delete', old.id, old.name);
END;
CREATE TRIGGER print_localizations_au AFTER UPDATE ON print_localizations BEGIN
  INSERT INTO names_fts (names_fts, rowid, name) VALUES ('delete', old.id, old.name);
  INSERT INTO names_fts (rowid, name) VALUES (new.id, new.name);
END;`;

// Casts to text keep Postgres' values as they are (no Date, no parsed JSON); `order by` the key
// makes the build deterministic.
const QUERIES: Record<Exclude<Table, 'meta'>, string> = {
  sets: `select s.id::text, s.code, s.name, de.name, s.released_on::text, s.card_count, s.kind,
      s.image_key
    from sets s left join set_localizations de on de.set_id = s.id and de.lang = 'de'
    where s.game_id = $1 order by s.id`,
  cards: `select id::text, name, type_line, text, attributes::text, legalities::text
    from cards where game_id = $1 order by id`,
  prints: `select p.id::text, p.card_id::text, p.set_id::text, p.number, p.variant, p.rarity,
      array_to_json(p.finishes)::text, p.artist, p.image_key, p.released_on::text
    from prints p join sets s on s.id = p.set_id where s.game_id = $1 order by p.id`,
  print_localizations: `select l.print_id::text, l.lang, l.name, l.text, l.image_key
    from print_localizations l join prints p on p.id = l.print_id join sets s on s.id = p.set_id
    where s.game_id = $1 and l.lang = any($2::text[]) order by l.print_id, l.lang collate "C"`,
  // The display price per print, finish and currency: the source that currency prefers
  // (SOURCE_PREFERENCE, as in GET /catalog/prints/:id/prices), in its own currency.
  prices: `select distinct on (pc.print_id, pc.finish, pc.currency)
      pc.print_id::text, pc.finish, pc.currency, pc.cents_market, pc.source,
      to_char(pc.observed_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
    from prices_current pc join prints p on p.id = pc.print_id join sets s on s.id = p.set_id
    where s.game_id = $1
    order by pc.print_id, pc.finish, pc.currency,
      array_position($2::text[], pc.currency || ':' || pc.source), pc.source collate "C"`,
};

/** Parameters after the game ($1) of each query. */
const PARAMS: Partial<Record<keyof typeof QUERIES, unknown[]>> = {
  print_localizations: [LANGS],
  prices: [
    Object.entries(SOURCE_PREFERENCE).flatMap(([currency, sources]) =>
      sources.map((s) => `${currency}:${s}`),
    ),
  ],
};

const placeholders = (n: number) => Array.from({ length: n }, () => '?').join(', ');

/** Rows of a query through a server-side cursor, so Magic never sits in memory at once. */
async function* cursor(client: PoolClient, text: string, values: unknown[]) {
  await client.query(`declare module_rows no scroll cursor for ${text}`, values);
  for (;;) {
    const { rows } = await client.query<unknown[]>({
      text: 'fetch 5000 from module_rows',
      rowMode: 'array',
    });
    if (rows.length === 0) break;
    yield* rows;
  }
  await client.query('close module_rows');
}

/** The current catalog_version (global, bumped by every import run). */
export async function catalogVersion(pg: Pool | PoolClient): Promise<number> {
  const { rows } = await pg.query<{ value: string }>(
    `select value from app_meta where key = 'catalog_version'`,
  );
  return Number(rows[0]?.value ?? 0);
}

export interface BuildResult {
  version: number;
  rows: Record<Table, number>;
}

/**
 * Builds the module of `game` at `path` from one consistent snapshot of the catalog. The same
 * catalog and `builtAt` give the same bytes.
 */
export async function buildModule(
  pool: Pool,
  game: string,
  path: string,
  builtAt: string,
): Promise<BuildResult> {
  rmSync(path, { force: true });
  const db = new DatabaseSync(path);
  const client = await pool.connect();
  try {
    db.exec('PRAGMA journal_mode = OFF; PRAGMA synchronous = OFF;');
    db.exec(SCHEMA);
    await client.query('begin isolation level repeatable read, read only');
    const version = await catalogVersion(client);
    const rows = {} as Record<Table, number>;
    const statement = (table: Table) => {
      const { columns } = TABLES[table];
      rows[table] = 0;
      const stmt = db.prepare(
        `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders(columns.length)})`,
      );
      return (values: unknown[]) => {
        stmt.run(...(values as (string | number | null)[]));
        rows[table]++;
      };
    };
    db.exec('BEGIN');
    const meta = statement('meta');
    meta(['built_at', builtAt]);
    meta(['game', game]);
    meta(['schema_version', String(SCHEMA_VERSION)]);
    meta(['version', String(version)]);
    for (const table of Object.keys(QUERIES) as (keyof typeof QUERIES)[]) {
      const insert = statement(table);
      for await (const row of cursor(client, QUERIES[table], [game, ...(PARAMS[table] ?? [])]))
        insert(row);
    }
    await client.query('commit');
    db.exec(`INSERT INTO names_fts (names_fts) VALUES ('rebuild')`);
    db.exec(`INSERT INTO names_fts (names_fts) VALUES ('optimize')`);
    db.exec(TRIGGERS);
    db.exec('COMMIT');
    db.exec('VACUUM');
    return { version, rows };
  } catch (err) {
    await client.query('rollback').catch(() => undefined);
    throw err;
  } finally {
    client.release();
    db.close();
  }
}

/**
 * The SQL that turns module `oldPath` into module `newPath`: row-level deletes of keys the new
 * one lacks, then upserts (`ON CONFLICT … DO UPDATE`, which fires the FTS triggers) of every row
 * that is new or changed. Every statement ends with `;`, and one may span several lines (`quote()`
 * keeps the newlines of a text value), so the app runs the whole file at once (`execAsync`) in one
 * transaction and never splits it by line.
 */
export function diffModules(oldPath: string, newPath: string): string {
  const db = new DatabaseSync(newPath, { readOnly: true });
  try {
    db.exec(`ATTACH DATABASE '${oldPath.replaceAll("'", "''")}' AS old`);
    const meta = (schema: string, key: string) =>
      (db.prepare(`SELECT value FROM ${schema}.meta WHERE key = ?`).get(key) as { value: string })
        .value;
    const lines = [
      `-- catalog-${meta('main', 'game')} v${meta('old', 'version')} -> v${meta('main', 'version')}`,
    ];
    const emit = (sql: string) => {
      for (const row of db.prepare(sql).iterate()) lines.push((row as { s: string }).s);
    };
    const tables = Object.entries(TABLES) as [Table, (typeof TABLES)[Table]][];
    for (const [table, { key }] of tables) {
      const where = key.map((k) => `'${k} = ' || quote(${k})`).join(` || ' AND ' || `);
      emit(`SELECT 'DELETE FROM ${table} WHERE ' || ${where} || ';' AS s
        FROM (SELECT ${key} FROM old.${table} EXCEPT SELECT ${key} FROM main.${table})
        ORDER BY ${key}`);
    }
    for (const [table, { key, columns }] of tables) {
      const values = columns.map((c) => `quote(${c})`).join(` || ', ' || `);
      const set = columns
        .filter((c) => !(key as readonly string[]).includes(c))
        .map((c) => `${c} = excluded.${c}`)
        .join(', ');
      const head = `INSERT INTO ${table} (${columns.join(', ')}) VALUES (`;
      const tail = `) ON CONFLICT (${key.join(', ')}) DO UPDATE SET ${set};`;
      emit(`SELECT '${head}' || ${values} || '${tail}' AS s
        FROM (SELECT ${columns} FROM main.${table} EXCEPT SELECT ${columns} FROM old.${table})
        ORDER BY ${key}`);
    }
    return `${lines.join('\n')}\n`;
  } finally {
    db.close();
  }
}

const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');

// The schema version is part of the name: a module key is immutable (one year cache), so a schema
// bump on an unchanged catalog_version must never overwrite the published object.
export const moduleFile = (game: string, version: number, schema = SCHEMA_VERSION) =>
  `catalog-${game}-v${version}-s${schema}.sqlite`;
export const deltaFile = (game: string, from: number, to: number, schema = SCHEMA_VERSION) =>
  `catalog-${game}-v${from}-v${to}-s${schema}.sql.gz`;

/**
 * What the CLI does before it builds. `skip`: the published module is this version with this
 * schema, nothing to do. `from`: the version to diff against, or null for no delta. A delta needs
 * that version's module in `--out` (`localVersions`) and, on upload, the published manifest to be
 * that version in the same schema (a schema bump starts a fresh chain); without upload it is the
 * newest older module in `--out`.
 */
export function plan(o: {
  published: Pick<ModuleManifest, 'version' | 'schemaVersion'> | null;
  /** The catalog_version now; the published module is up to date when it has this version. */
  current: number;
  localVersions: number[];
  /** The version being built. */
  version: number;
  upload: boolean;
  schemaVersion: number;
}): { skip: boolean; from: number | null } {
  const sameSchema = o.published?.schemaVersion === o.schemaVersion;
  if (o.published?.version === o.current && sameSchema) return { skip: true, from: null };
  const older = o.localVersions.filter((v) => v < o.version);
  const from = o.upload
    ? o.published && sameSchema && older.includes(o.published.version)
      ? o.published.version
      : null
    : older.length
      ? Math.max(...older)
      : null;
  return { skip: false, from };
}

/** The slice of the bucket the retention needs. */
export interface ModuleStore {
  list(prefix: string): Promise<string[]>;
  delete(key: string): Promise<void>;
}

/**
 * After the manifest PUT: deletes every key under `prefix` that the new manifest does not name,
 * except the previous manifest's module (one grace run for an app that read the old manifest
 * just before it was replaced). Returns the deleted keys.
 */
export async function prune(
  store: ModuleStore,
  prefix: string,
  manifest: ModuleManifest,
  previous: ModuleManifest | null,
): Promise<string[]> {
  const key = (url: string) => `${prefix}/${url.slice(url.lastIndexOf('/') + 1)}`;
  const keep = new Set([
    `${prefix}/manifest.json`,
    key(manifest.module.url),
    ...manifest.deltas.map((d) => key(d.url)),
    ...(previous ? [key(previous.module.url)] : []),
  ]);
  const stale = (await store.list(`${prefix}/`)).filter((k) => !keep.has(k));
  for (const k of stale) await store.delete(k);
  return stale;
}

/** The manifest of a new build: the previous chain (ending at `delta.from`) plus `delta`. */
export function nextManifest(
  previous: ModuleManifest | null,
  next: Omit<ModuleManifest, 'deltas'>,
  delta: ModuleDelta | null,
): ModuleManifest {
  const chain = delta && previous?.version === delta.from ? previous.deltas : [];
  return { ...next, deltas: delta ? [...chain, delta].slice(-MAX_DELTAS) : [] };
}

// ---------------------------------------------------------------------------------------------
// CLI

async function main() {
  const { values: args } = parseArgs({
    options: {
      'env-file': { type: 'string', multiple: true },
      db: { type: 'string' },
      game: { type: 'string' },
      out: { type: 'string', default: join(homedir(), 'catalog-modules') },
      upload: { type: 'boolean', default: false },
    },
  });
  for (const file of args['env-file'] ?? []) process.loadEnvFile(file);
  const env = (name: string, fallback?: string): string => {
    const value = process.env[name] ?? fallback;
    if (!value) throw new Error(`${name} is not set (shell or --env-file)`);
    return value;
  };

  const game = GameSchema.parse(args.game);
  if (args.db !== undefined && args.db !== 'dev' && args.db !== 'prod')
    throw new Error('--db must be dev or prod');
  if (args.upload && !args.db) throw new Error('--upload needs --db (the R2 prefix)');
  const databaseUrl = args.db ? env(`PG_MIRROR_URL_${args.db.toUpperCase()}`) : env('DATABASE_URL');
  const out = join(args.out, game);
  mkdirSync(out, { recursive: true });

  const s3 = args.upload ? r2(env) : null;
  const prefix = `modules/${args.db}/${game}`;
  const publicUrl = env('MODULES_PUBLIC_URL', 'https://img.voidbinder.de');

  const pool = new Pool({ connectionString: databaseUrl, max: 1 });
  const started = Date.now();
  try {
    const current = await catalogVersion(pool);
    const published = s3 ? await s3.getManifest(`${prefix}/manifest.json`) : null;
    const localVersions = () =>
      readdirSync(out)
        .map(
          (f) => new RegExp(`^catalog-${game}-v(\\d+)-s${SCHEMA_VERSION}\\.sqlite$`).exec(f)?.[1],
        )
        .filter((v) => v !== undefined)
        .map(Number);
    const options = { published, current, upload: Boolean(s3), schemaVersion: SCHEMA_VERSION };
    if (plan({ ...options, localVersions: localVersions(), version: current }).skip) {
      log('info', { message: 'catalog module up to date', game, version: current });
      return;
    }

    const building = join(out, `catalog-${game}.building.sqlite`);
    const builtAt = new Date().toISOString();
    const { version, rows } = await buildModule(pool, game, building, builtAt);
    if (rows.prints === 0) {
      rmSync(building);
      log('info', { message: 'catalog module skipped: no prints', game, version });
      return;
    }
    const sqlitePath = join(out, moduleFile(game, version));
    renameSync(building, sqlitePath);

    // The previous module: the published one (upload), else the newest older one in --out.
    const { from } = plan({
      ...options,
      current: version,
      localVersions: localVersions(),
      version,
    });
    const fromPath = from === null ? null : join(out, moduleFile(game, from));

    const raw = readFileSync(sqlitePath);
    const gz = gzipSync(raw, { level: 9 });
    const files: { name: string; body: Uint8Array; cache: string }[] = [
      { name: `${moduleFile(game, version)}.gz`, body: gz, cache: IMMUTABLE },
    ];
    let delta: ModuleDelta | null = null;
    if (fromPath && from !== null) {
      const body = gzipSync(diffModules(fromPath, sqlitePath), { level: 9 });
      const name = deltaFile(game, from, version);
      files.push({ name, body, cache: IMMUTABLE });
      delta = {
        from,
        to: version,
        url: `${publicUrl}/${prefix}/${name}`,
        size: body.length,
        sha256: sha256(body),
      };
    }
    const manifest = nextManifest(
      published,
      {
        game,
        version,
        schemaVersion: SCHEMA_VERSION,
        minAppSchemaVersion: MIN_APP_SCHEMA_VERSION,
        builtAt,
        module: {
          url: `${publicUrl}/${prefix}/${files[0]?.name}`,
          size: gz.length,
          sha256: sha256(gz),
          rawSize: raw.length,
          rawSha256: sha256(raw),
        },
      },
      delta,
    );
    const manifestBody = new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`);

    if (s3) {
      // The manifest goes last, so it never names a file that is not there yet.
      for (const f of files) await s3.put(`${prefix}/${f.name}`, f.body, f.cache);
      await s3.put(`${prefix}/manifest.json`, manifestBody, MANIFEST_CACHE);
      const pruned = await prune(s3, prefix, manifest, published);
      if (pruned.length) log('info', { message: 'catalog module files pruned', game, pruned });
      // Keep only the new module, the source of the next delta.
      for (const f of readdirSync(out)) if (f !== moduleFile(game, version)) rmSync(join(out, f));
    } else {
      for (const f of files) writeFileSync(join(out, f.name), f.body);
      writeFileSync(join(out, 'manifest.json'), manifestBody);
    }
    log('info', {
      message: 'catalog module built',
      game,
      version,
      from: delta?.from ?? null,
      rows,
      rawBytes: raw.length,
      gzBytes: gz.length,
      deltaBytes: delta?.size ?? null,
      uploaded: Boolean(s3),
      seconds: (Date.now() - started) / 1000,
    });
  } finally {
    await pool.end();
  }
}

const IMMUTABLE = 'public, max-age=31536000, immutable';
const MANIFEST_CACHE = 'public, max-age=60';

/** The public bucket through the S3 API; this script writes `modules/` keys only. */
function r2(env: (name: string, fallback?: string) => string) {
  const bucket = env('R2_BUCKET', 'voidbinder-catalog');
  const s3 = new S3Client({
    region: 'auto',
    endpoint: env('R2_ENDPOINT'),
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
  });
  return {
    async getManifest(key: string): Promise<ModuleManifest | null> {
      try {
        const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return ModuleManifestSchema.parse(JSON.parse((await res.Body?.transformToString()) ?? ''));
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
    async list(prefix: string): Promise<string[]> {
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const res = await s3.send(
          new ListObjectsV2Command({ Bucket: bucket, Prefix: prefix, ContinuationToken: token }),
        );
        for (const o of res.Contents ?? []) if (o.Key) keys.push(o.Key);
        token = res.NextContinuationToken;
      } while (token);
      return keys;
    },
    async delete(key: string) {
      if (!key.startsWith('modules/')) throw new Error(`refusing to delete ${key}`);
      await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    },
    async put(key: string, body: Uint8Array, cacheControl: string) {
      if (!key.startsWith('modules/')) throw new Error(`refusing to write ${key}`);
      const contentType = key.endsWith('.json') ? 'application/json' : 'application/gzip';
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: cacheControl,
        }),
      );
    },
  };
}

if (import.meta.main) await main();
