import { sql } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { log } from '../middleware/log';
import { grams } from '../platform/cloudflare/d1-search-index';

// The refresh of the search index in D1 (VB-98, ADR 0006) from Postgres, the source of truth.
// Postgres hashes every set with its prints and names; a set whose hash differs from the one in
// D1 is rewritten whole (delete, insert), one batch (one D1 transaction) per chunk of sets, so a
// set is never half there. Sets gone from Postgres are deleted. The localizations carry no
// `updated_at`, and a hash also catches a deletion or a renamed card, so no timestamp is used.

/** Bumped when what the index stores changes: every set's hash changes, so all are rewritten. */
const SCHEMA = 'v1';

/** 1 for an Extended Art print (VB-106), else null (which concat_ws skips in the hash). */
const EXTENDED_ART = sql.raw(`case when p.external_ids #>> '{artwork,alt}' = 'EA' then 1 end`);

/** 1 for a key that is another rarity's scan (`SIBLING_SCAN`, VB-117), else null (as EXTENDED_ART). */
const siblingScan = (alias: string) =>
  sql.raw(`case when ${alias}.external_ids #>> '{artwork,sibling}' = 'true' then 1 end`);

/** Prints per chunk (one Workflow step, one D1 batch); a bigger set is a chunk of its own. */
export const CHUNK_PRINTS = 1000;

/** Rows per INSERT, passed as one JSON parameter (D1 binds at most 100 parameters). */
const INSERT_ROWS = 500;

/** A refresh still holding the lock after this long is taken as dead. */
const LOCK_TTL_MS = 2 * 3_600_000;

/** How often, and how long apart, a refresh waits for a running one before giving up. */
export const LOCK_WAITS = 12;
export const LOCK_WAIT_SECONDS = 300;

export type Step = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

export interface SearchIndexDeps {
  d1: D1Database;
  /** A fresh (uncached) Postgres connection for one step. */
  withDb<T>(fn: (db: NodePgDatabase) => Promise<T>): Promise<T>;
  /** Purges the API's edge cache by tag; never throws. */
  purgeCache?(tags: string[]): Promise<void>;
  /** Waits durably (Workflows `step.sleep`). */
  sleep?(name: string, seconds: number): Promise<void>;
}

export interface RefreshOptions {
  /** Rewrite every set, whatever its hash. */
  full: boolean;
  /** The lock owner, the Workflow instance id. */
  owner: string;
}

export interface RefreshStats {
  status: 'ok' | 'busy';
  catalogVersion?: string;
  sets?: number;
  setsWritten?: number;
  setsRemoved?: number;
  rowsWritten?: number;
  durationMs?: number;
}

interface Plan {
  catalogVersion: string;
  sets: number;
  /** Set ids with their new hash, per chunk. */
  chunks: [string, string][][];
  removed: string[];
}

/** Takes the lock unless another live refresh holds it; true when this one holds it now. */
async function lock(d1: D1Database, owner: string, now: number): Promise<boolean> {
  const res = await d1
    .prepare(
      `insert into meta (key, value) values ('lock', ?1) on conflict (key) do update
      set value = excluded.value
      where json_extract(meta.value, '$.owner') = ?2 or json_extract(meta.value, '$.at') < ?3`,
    )
    .bind(JSON.stringify({ owner, at: now }), owner, now - LOCK_TTL_MS)
    .run();
  return res.meta.changes > 0;
}

/** The plan: the catalog version, and the sets whose hash in Postgres differs from D1's. */
async function plan(deps: SearchIndexDeps, full: boolean): Promise<Plan> {
  const [catalogVersion, hashes] = await deps.withDb(async (db) => {
    const version = await db.execute<{ value: string }>(
      sql`select value from app_meta where key = 'catalog_version'`,
    );
    const rows = await db.execute<{ id: string; hash: string; prints: number }>(sql`
      select s.id, md5(concat_ws('|', ${sql.raw(`'${SCHEMA}'`)}, s.game_id, s.code, s.name, s.released_on,
          s.card_count, (select g.card_format from games g where g.id = s.game_id),
          (select string_agg(l.lang || '=' || l.name, ',' order by l.lang)
            from set_localizations l where l.set_id = s.id),
          (select md5(string_agg(concat_ws('|', p.id, p.card_id, c.name, p.number, p.variant,
              p.rarity, p.released_on, p.image_key,
              p.external_ids #>> '{scryfall_images,normal}', ${EXTENDED_ART}, ${siblingScan('p')},
              (select string_agg(concat_ws('=', pl.lang, pl.name, pl.image_key,
                  pl.external_ids #>> '{scryfall_images,normal}', pl.external_ids ->> 'set_code',
                  ${siblingScan('pl')}),
                  ',' order by pl.lang)
                from print_localizations pl where pl.print_id = p.id)
            ), ';' order by p.id))
            from prints p join cards c on c.id = p.card_id where p.set_id = s.id)
        )) as hash,
        (select count(*)::int from prints p where p.set_id = s.id) as prints
      from sets s order by s.id`);
    return [version.rows[0]?.value ?? '0', rows.rows] as const;
  });
  // Read in both modes: a full rebuild skips only the hash comparison, it still removes sets gone
  // from Postgres.
  const stored = new Map(
    (
      await deps.d1.prepare('select id, hash from sets').all<{ id: string; hash: string }>()
    ).results.map((r) => [r.id, r.hash]),
  );
  const live = new Set(hashes.map((h) => h.id));
  const chunks: [string, string][][] = [];
  let chunk: [string, string][] = [];
  let size = 0;
  for (const h of hashes) {
    if (!full && stored.get(h.id) === h.hash) continue;
    if (chunk.length && size + h.prints > CHUNK_PRINTS) {
      chunks.push(chunk);
      chunk = [];
      size = 0;
    }
    chunk.push([h.id, h.hash]);
    size += h.prints;
  }
  if (chunk.length) chunks.push(chunk);
  return {
    catalogVersion,
    sets: hashes.length,
    chunks,
    removed: [...stored.keys()].filter((id) => !live.has(id)),
  };
}

/** The statements that delete sets (by a JSON array of ids) with their prints and names. */
function deleteSets(d1: D1Database, ids: string[]): D1PreparedStatement[] {
  const json = JSON.stringify(ids);
  return [
    `delete from names where print_id in
      (select id from prints where set_id in (select value from json_each(?1)))`,
    'delete from prints where set_id in (select value from json_each(?1))',
    'delete from set_names where set_id in (select value from json_each(?1))',
    'delete from sets where id in (select value from json_each(?1))',
  ].map((s) => d1.prepare(s).bind(json));
}

/** INSERTs of `rows` (arrays in `columns` order) into `table`, INSERT_ROWS per statement. */
function inserts(
  d1: D1Database,
  table: string,
  columns: string[],
  rows: unknown[][],
  verb = 'insert',
): D1PreparedStatement[] {
  const select = columns.map((_, i) => `value ->> ${i}`).join(', ');
  const out: D1PreparedStatement[] = [];
  for (let i = 0; i < rows.length; i += INSERT_ROWS)
    out.push(
      d1
        .prepare(
          `${verb} into ${table} (${columns.join(', ')}) select ${select} from json_each(?1)`,
        )
        .bind(JSON.stringify(rows.slice(i, i + INSERT_ROWS))),
    );
  return out;
}

/** Rewrites the sets of one chunk from Postgres; returns D1's rows written. */
async function syncChunk(deps: SearchIndexDeps, chunk: [string, string][]): Promise<number> {
  const ids = chunk.map(([id]) => id);
  const hash = new Map(chunk);
  const list = `{${ids.join(',')}}`;
  const data = await deps.withDb(async (db) => {
    const [setRows, setNames, printRows, names] = await Promise.all([
      db.execute<{
        id: string;
        game: string;
        code: string;
        code_key: string;
        name: string;
        released_on: string | null;
        card_count: number | null;
        card_format: string;
      }>(sql`select s.id, s.game_id as game, s.code, catalog_code_key(s.code) as code_key, s.name,
          s.released_on::text as released_on, s.card_count, g.card_format
        from sets s join games g on g.id = s.game_id where s.id = any(${list}::uuid[])`),
      db.execute<{ set_id: string; lang: string; name: string }>(
        sql`select set_id, lang, name from set_localizations where set_id = any(${list}::uuid[])`,
      ),
      db.execute<{
        id: string;
        card_id: string;
        set_id: string;
        card_name: string;
        number: string;
        number_value: number | null;
        number_alnum: string;
        number_key: string | null;
        variant: string;
        rarity: string | null;
        released_on: string | null;
        image_key: string | null;
        image_src: string | null;
        extended_art: number | null;
        image_sibling: number | null;
      }>(sql`select p.id, p.card_id, p.set_id, c.name as card_name, p.number,
          nullif(regexp_replace(p.number, '[^0-9].*$', ''), '')::int as number_value,
          regexp_replace(lower(p.number), '[^a-z0-9]+', '', 'g') as number_alnum,
          catalog_number_key(p.number) as number_key, p.variant, p.rarity,
          p.released_on::text as released_on, p.image_key,
          p.external_ids #>> '{scryfall_images,normal}' as image_src,
          ${EXTENDED_ART} as extended_art, ${siblingScan('p')} as image_sibling
        from prints p join cards c on c.id = p.card_id where p.set_id = any(${list}::uuid[])`),
      db.execute<{
        print_id: string;
        lang: string;
        name: string;
        image_key: string | null;
        image_src: string | null;
        code: string | null;
        code_alnum: string | null;
        image_sibling: number | null;
      }>(sql`select pl.print_id, pl.lang, pl.name, pl.image_key, ${siblingScan('pl')} as image_sibling,
          pl.external_ids #>> '{scryfall_images,normal}' as image_src,
          -- storedCode: '' for a language the set lists dropped (VB-94).
          coalesce(nullif(pl.external_ids ->> 'set_code', ''),
            case when pl.external_ids ->> 'set_code_source' = 'yugipedia' then '' end) as code,
          regexp_replace(lower(pl.external_ids ->> 'set_code'), '[^a-z0-9]+', '', 'g') as code_alnum
        from print_localizations pl join prints p on p.id = pl.print_id
        where p.set_id = any(${list}::uuid[])`),
    ]);
    return {
      sets: setRows.rows,
      setNames: setNames.rows,
      prints: printRows.rows,
      names: names.rows,
    };
  });

  const english = new Set(
    data.names.filter((n) => n.lang === 'en').map((n) => `${n.print_id}|${n.name}`),
  );
  const nameRows = data.names.map((n) => [
    n.print_id,
    n.lang,
    n.name,
    n.name.toLowerCase(),
    n.image_key,
    n.image_src,
    n.code,
    n.code_alnum,
    n.image_sibling,
  ]);
  // The card's English name, matched by `?names=all`, where no `en` name equals it.
  for (const p of data.prints)
    if (!english.has(`${p.id}|${p.card_name}`))
      nameRows.push([
        p.id,
        '',
        p.card_name,
        p.card_name.toLowerCase(),
        null,
        null,
        null,
        null,
        null,
      ]);
  const keys = [...new Set(nameRows.map((n) => n[3] as string))];

  const d1 = deps.d1;
  const results = await d1.batch([
    ...deleteSets(d1, ids),
    ...inserts(
      d1,
      'sets',
      [
        'id',
        'game',
        'code',
        'code_key',
        'name',
        'name_key',
        'released_on',
        'card_count',
        'card_format',
        'hash',
      ],
      data.sets.map((s) => [
        s.id,
        s.game,
        s.code,
        s.code_key,
        s.name,
        s.name.toLowerCase(),
        s.released_on,
        s.card_count,
        s.card_format,
        hash.get(s.id),
      ]),
    ),
    ...inserts(
      d1,
      'set_names',
      ['set_id', 'lang', 'name', 'name_key'],
      data.setNames.map((n) => [n.set_id, n.lang, n.name, n.name.toLowerCase()]),
    ),
    ...inserts(
      d1,
      'prints',
      [
        'id',
        'card_id',
        'set_id',
        'card_name',
        'number',
        'number_value',
        'number_alnum',
        'number_key',
        'variant',
        'rarity',
        'released_on',
        'image_key',
        'image_src',
        'extended_art',
        'image_sibling',
      ],
      data.prints.map((p) => [
        p.id,
        p.card_id,
        p.set_id,
        p.card_name,
        p.number,
        p.number_value,
        p.number_alnum,
        p.number_key,
        p.variant,
        p.rarity,
        p.released_on,
        p.image_key,
        p.image_src,
        p.extended_art,
        p.image_sibling,
      ]),
    ),
    ...inserts(
      d1,
      'names',
      [
        'print_id',
        'lang',
        'name',
        'name_key',
        'image_key',
        'image_src',
        'code',
        'code_alnum',
        'image_sibling',
      ],
      nameRows,
    ),
    // New names only; one no print has any more is deleted by the refresh's last step.
    ...inserts(
      d1,
      'name_keys',
      ['name_key', 'grams'],
      keys.map((k) => [k, grams(k)]),
      'insert or ignore',
    ),
  ]);
  return results.reduce((n, r) => n + (r.meta.rows_written ?? 0), 0);
}

/**
 * Brings the search index up to Postgres (VB-98): one durable step per stage and per chunk, so a
 * failed step is retried and a resumed instance continues where it stopped. Single-flight: a
 * second refresh waits for the running one (LOCK_WAITS × LOCK_WAIT_SECONDS), then gives up.
 */
export async function refreshSearchIndex(
  deps: SearchIndexDeps,
  step: Step,
  { full, owner }: RefreshOptions,
): Promise<RefreshStats> {
  const started = await step('start', async () => Date.now());
  for (let attempt = 0; ; attempt++) {
    if (await step(`lock ${attempt}`, () => lock(deps.d1, owner, Date.now()))) break;
    if (attempt + 1 >= LOCK_WAITS || !deps.sleep) {
      log('info', { message: 'search index refresh skipped, another one is running', owner });
      return { status: 'busy' };
    }
    await deps.sleep(`wait for the running refresh ${attempt}`, LOCK_WAIT_SECONDS);
  }

  try {
    return await refreshLocked(deps, step, full, owner, started);
  } catch (err) {
    // A failed step would otherwise keep the lock for LOCK_TTL_MS and turn the next refreshes away.
    await step('release lock', async () => (await unlock(deps.d1, owner).run()).meta.changes);
    throw err;
  }
}

/** This owner's lock only: after a TTL takeover the lock is another refresh's. */
function unlock(d1: D1Database, owner: string): D1PreparedStatement {
  return d1
    .prepare(`delete from meta where key = 'lock' and json_extract(value, '$.owner') = ?1`)
    .bind(owner);
}

async function refreshLocked(
  deps: SearchIndexDeps,
  step: Step,
  full: boolean,
  owner: string,
  started: number,
): Promise<RefreshStats> {
  const p = await step('plan', () => plan(deps, full));
  let rowsWritten = 0;
  for (const [i, chunk] of p.chunks.entries())
    rowsWritten += await step(`sync ${i + 1}/${p.chunks.length}`, () => syncChunk(deps, chunk));
  if (p.removed.length)
    rowsWritten += await step('remove', async () => {
      const res = await deps.d1.batch(deleteSets(deps.d1, p.removed));
      return res.reduce((n, r) => n + (r.meta.rows_written ?? 0), 0);
    });

  const stats: RefreshStats = await step('finish', async () => {
    await deps.d1.batch([
      deps.d1
        .prepare(
          `insert into meta (key, value) values ('catalog_version', ?1), ('synced_at', ?2)
          on conflict (key) do update set value = excluded.value`,
        )
        .bind(p.catalogVersion, new Date().toISOString()),
      // Names no print has any more (shared by sets, so kept until here).
      deps.d1.prepare(
        `delete from name_keys
        where not exists (select 1 from names n where n.name_key = name_keys.name_key)`,
      ),
      unlock(deps.d1, owner),
    ]);
    const done: RefreshStats = {
      status: 'ok',
      catalogVersion: p.catalogVersion,
      sets: p.sets,
      setsWritten: p.chunks.reduce((n, c) => n + c.length, 0),
      setsRemoved: p.removed.length,
      rowsWritten,
      durationMs: Date.now() - started,
    };
    log('info', { message: 'search index refreshed', full, ...done });
    return done;
  });
  // The typeahead's cached answers came from the index before this refresh.
  if (stats.setsWritten || stats.setsRemoved)
    await step('purge cache', async () => deps.purgeCache?.(['catalog']));
  return stats;
}
