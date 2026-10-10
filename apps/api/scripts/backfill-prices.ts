// TCGCSV price history backfill (VB-63), run on the database VPS (docs/guides/database-vps.md,
// section 13): downloads TCGCSV's daily price archive one day at a time, unpacks the three games
// with 7z, writes the mapped prices into `prices_daily` and deletes the files again. The logic
// lives in src/import/prices/backfill.ts.
//
//   pnpm --filter api backfill-prices --env-file ~/.config/voidbinder/pg.env --db dev
//     [--from 2024-02-08] [--to <yesterday>] [--delay-ms 2000] [--dry-run] [--refill]
//
// Env: PG_MIRROR_URL_DEV / PG_MIRROR_URL_PROD for `--db` (or `DBS=dev|prod`), else DATABASE_URL.
// Resumable: a day that already has `tcgplayer` rows (the daily import, or this script, which
// writes a day in one transaction) is skipped, and so is a day the progress file
// ~/.local/state/voidbinder/price-backfill-<db>.json records as done or missing. `--refill` skips
// both checks and downloads every day of the range; ON CONFLICT DO NOTHING keeps it safe and adds
// only rows that are missing (products mapped since).
import { execFile } from 'node:child_process';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { parseArgs, promisify } from 'node:util';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import {
  ARCHIVE_START,
  archiveUrl,
  days,
  emptyGames,
  hasDay,
  loadMappings,
  readDay,
  writeDay,
} from '../src/import/prices/backfill';
import { CATEGORIES, type PricedGame } from '../src/import/prices/tcgcsv';
import { USER_AGENT } from '../src/import/scryfall/source';
import { log } from '../src/middleware/log';

const { values: args } = parseArgs({
  options: {
    'env-file': { type: 'string', multiple: true },
    db: { type: 'string', default: process.env.DBS },
    from: { type: 'string', default: ARCHIVE_START },
    to: { type: 'string' },
    'delay-ms': { type: 'string', default: '2000' },
    'dry-run': { type: 'boolean', default: false },
    refill: { type: 'boolean', default: false },
  },
});

for (const file of args['env-file'] ?? []) process.loadEnvFile(file);

function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (shell or --env-file)`);
  return value;
}

const DAY = /^\d{4}-\d{2}-\d{2}$/;
// TCGCSV publishes a day's archive after its ~20:00 UTC build: yesterday is the latest whole one.
const to = args.to ?? new Date(Date.now() - 864e5).toISOString().slice(0, 10);
const from = args.from;
if (!DAY.test(from) || !DAY.test(to) || from > to)
  throw new Error('--from and --to must be YYYY-MM-DD, from <= to');
if (from < ARCHIVE_START) throw new Error(`the archive starts on ${ARCHIVE_START}`);
// Always all games: a day is all or nothing, so a partial run would leave the rest skipped.
const games = Object.keys(CATEGORIES) as PricedGame[];
const delayMs = Number(args['delay-ms']);
if (!Number.isInteger(delayMs) || delayMs < 0) throw new Error('--delay-ms must be a whole number');
const db = args.db;
if (db !== undefined && db !== 'dev' && db !== 'prod') throw new Error('--db must be dev or prod');
const databaseUrl = db ? env(`PG_MIRROR_URL_${db.toUpperCase()}`) : env('DATABASE_URL');
const dryRun = args['dry-run'];

const stateDir = join(homedir(), '.local/state/voidbinder');
const progressFile = join(stateDir, `price-backfill-${db ?? 'local'}.json`);
type Progress = Record<string, number | 'missing'>;
const progress: Progress = JSON.parse(await readFile(progressFile, 'utf8').catch(() => '{}'));
const saveProgress = async () => {
  await mkdir(stateDir, { recursive: true });
  await writeFile(progressFile, JSON.stringify(progress, null, 1));
};

const run = promisify(execFile);
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The day's archive in `dir`; null when TCGCSV has none for that day (404). */
async function download(day: string, dir: string): Promise<string | null> {
  const res = await fetch(archiveUrl(day), { headers: { 'User-Agent': USER_AGENT } });
  if (res.status === 404) return null;
  if (!res.ok)
    // 403 is the archive switched off as a whole ("temporarily removed"): stop, never hammer it.
    throw new Error(
      `${archiveUrl(day)} answered ${res.status}: ${(await res.text()).slice(0, 200)}`,
    );
  const file = join(dir, `prices-${day}.ppmd.7z`);
  // ponytail: one day's archive in memory; stream it to disk if a day grows past a few 100 MB.
  await writeFile(file, new Uint8Array(await res.arrayBuffer()));
  return file;
}

const pool = new Pool({ connectionString: databaseUrl, max: 1 });
const pg = drizzle(pool);
// A fixed folder, wiped at startup: a SIGKILL skips the `finally` and leaves the files behind.
const work = join(homedir(), '.cache/voidbinder/price-backfill');
await rm(work, { recursive: true, force: true });
await mkdir(work, { recursive: true });
const started = Date.now();
const total = { days: 0, skipped: 0, missing: 0, inserted: 0 };
try {
  const mappings = await loadMappings(pg);
  log('info', { message: 'price backfill', db, from, to, games, mappings: mappings.size, dryRun });
  let first = true;
  // Days answered 404, saved as `missing` only once a later day downloads, so a wrong URL
  // scheme never marks the range as finished.
  const notFound: string[] = [];
  for (const day of days(from, to)) {
    if (!args.refill && (progress[day] !== undefined || (await hasDay(pg, day)))) {
      total.skipped++;
      continue;
    }
    if (!first) await sleep(delayMs);
    first = false;
    const dir = join(work, day);
    await mkdir(dir);
    try {
      const archive = await download(day, dir);
      if (!archive) {
        // The URL scheme is unverified against a real file: a few 404s in a row means it is wrong.
        if (notFound.push(day) >= 3)
          throw new Error(`no archive for ${notFound.length} days in a row up to ${day}`);
        log('warn', { message: 'no archive for this day', day });
        total.missing++;
        continue;
      }
      // Only the three games' files leave the archive; everything else stays packed.
      await run('7z', [
        'x',
        '-y',
        '-bso0',
        `-o${dir}`,
        archive,
        ...games.map((g) => `${day}/${CATEGORIES[g]}/*`),
      ]);
      await rm(archive);
      const perGame = await readDay(dir, day, mappings, games);
      // Nothing unpacked for a game: the inner layout is not `<day>/<category>/<group>/prices`.
      // Stop before the day is saved as done.
      const empty = emptyGames(perGame);
      if (empty.length) throw new Error(`${day}: no groups unpacked for ${empty.join(', ')}`);
      if (!dryRun) for (const d of notFound) progress[d] = 'missing';
      notFound.length = 0;
      const rows = Object.values(perGame).flatMap((g) => g.rows);
      const inserted = dryRun ? 0 : await writeDay(pg, day, rows);
      if (!dryRun) progress[day] = inserted;
      total.days++;
      total.inserted += inserted;
      log('info', {
        message: 'price backfill day',
        day,
        rows: rows.length,
        // A dry run shows a few rows to compare with the daily import's rows of the same day.
        ...(dryRun && { sample: rows.slice(0, 3) }),
        inserted,
        ...Object.fromEntries(
          Object.entries(perGame).map(([g, s]) => [
            g,
            { groups: s.groups, rows: s.rows.length, unmapped: s.unmapped, noMarket: s.noMarket },
          ]),
        ),
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
      if (!dryRun) await saveProgress();
    }
  }
  if (!dryRun) {
    for (const d of notFound) progress[d] = 'missing';
    await saveProgress();
  }
} finally {
  await rm(work, { recursive: true, force: true });
  await pool.end();
  log('info', {
    message: 'price backfill finished',
    ...total,
    seconds: (Date.now() - started) / 1000,
  });
}
