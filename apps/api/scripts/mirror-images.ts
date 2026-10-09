// Card image mirror (VB-57), run on the database VPS (docs/guides/database-vps.md, section 11):
// copies the source image of every print without `image_key` into R2 through the S3 API and makes
// the 320 px WebP copy with sharp; `--sm` also adds that copy to the rows the import Workflows'
// daily delta stored as `orig` only. The logic lives in src/import/images.ts, shared with the delta.
//
//   pnpm --filter api mirror-images --env-file ~/.config/voidbinder/r2.env
//     --env-file ~/.config/voidbinder/pg.env --db dev [--game mtg] [--limit 200]
//     [--concurrency 8] [--sm] [--verify] [--dry-run]
//
// Env (from --env-file or the shell): PG_MIRROR_URL_DEV / PG_MIRROR_URL_PROD for `--db`, else
// DATABASE_URL; R2_ENDPOINT (https://<account>.eu.r2.cloudflarestorage.com), R2_ACCESS_KEY_ID,
// R2_SECRET_ACCESS_KEY, R2_BUCKET (default voidbinder-catalog).
import { parseArgs } from 'node:util';
import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import sharp from 'sharp';
import {
  MirrorBusy,
  mirrorImages,
  SM_WIDTH,
  SOURCE_RATES,
  type MirrorDeps,
} from '../src/import/images';
import { log } from '../src/middleware/log';

const { values: args } = parseArgs({
  options: {
    'env-file': { type: 'string', multiple: true },
    db: { type: 'string' },
    game: { type: 'string' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '8' },
    sm: { type: 'boolean', default: false },
    verify: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

for (const file of args['env-file'] ?? []) process.loadEnvFile(file);

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (!value) throw new Error(`${name} is not set (shell or --env-file)`);
  return value;
}

function positive(name: string, value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 1) throw new Error(`--${name} must be a positive integer`);
  return n;
}

const game = args.game;
if (game && !(game in SOURCE_RATES))
  throw new Error(`--game must be one of ${Object.keys(SOURCE_RATES).join(', ')}`);
const limit = positive('limit', args.limit);
const concurrency = positive('concurrency', args.concurrency) ?? 8;
const dryRun = args['dry-run'];
if (args.db !== undefined && args.db !== 'dev' && args.db !== 'prod')
  throw new Error('--db must be dev or prod');
const databaseUrl = args.db ? env(`PG_MIRROR_URL_${args.db.toUpperCase()}`) : env('DATABASE_URL');

const bucket = env('R2_BUCKET', 'voidbinder-catalog');
const s3 = dryRun
  ? null
  : new S3Client({
      region: 'auto',
      endpoint: env('R2_ENDPOINT'),
      credentials: {
        accessKeyId: env('R2_ACCESS_KEY_ID'),
        secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
      },
    });

const deps: MirrorDeps = {
  fetch: (input, init) => fetch(input, init),
  store: {
    put: (key, body, { contentType, cacheControl }) =>
      (s3 as S3Client).send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: key,
          Body: body,
          ContentType: contentType,
          CacheControl: cacheControl,
        }),
      ),
    head: async (key) => {
      try {
        return await (s3 as S3Client).send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      } catch (err) {
        if ((err as { name?: string }).name === 'NotFound') return null;
        throw err;
      }
    },
    read: async (key) => {
      try {
        const res = await (s3 as S3Client).send(new GetObjectCommand({ Bucket: bucket, Key: key }));
        return (await res.Body?.transformToByteArray()) ?? null;
      } catch (err) {
        if ((err as { name?: string }).name === 'NoSuchKey') return null;
        throw err;
      }
    },
  },
  resize: async (body) =>
    new Uint8Array(
      await sharp(body).resize({ width: SM_WIDTH, withoutEnlargement: true }).webp().toBuffer(),
    ),
  log,
};

// One connection holds the run's lock, the others read and write.
const pool = new Pool({ connectionString: databaseUrl, max: 3 });
const started = Date.now();
try {
  const stats = await mirrorImages(
    deps,
    drizzle(pool),
    { game, limit, sm: args.sm },
    { concurrency, verify: args.verify, dryRun },
  );
  log('info', {
    message: 'image mirror finished',
    ...stats,
    seconds: (Date.now() - started) / 1000,
  });
} catch (err) {
  if (!(err instanceof MirrorBusy)) throw err;
  log('error', { message: err.message });
  process.exitCode = 1;
} finally {
  await pool.end();
}
