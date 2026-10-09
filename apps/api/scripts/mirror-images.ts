// Bulk card image mirror (VB-57), run on the database VPS (docs/guides/database-vps.md, section
// 11): copies the source image of every print without `image_key` into R2 through the S3 API and
// makes the 320 px WebP copy with sharp. The logic lives in src/import/images.ts, shared with the
// import Workflows' daily delta.
//
//   pnpm --filter api mirror-images --env-file ~/.config/voidbinder/r2.env [--game mtg]
//     [--limit 200] [--concurrency 8] [--verify] [--dry-run]
//
// Env (from --env-file or the shell): DATABASE_URL, R2_ENDPOINT
// (https://<account>.eu.r2.cloudflarestorage.com), R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY,
// R2_BUCKET (default voidbinder-catalog).
import { parseArgs } from 'node:util';
import { HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { drizzle } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import sharp from 'sharp';
import { mirrorImages, SM_WIDTH, SOURCE_RATES, type MirrorDeps } from '../src/import/images';
import { log } from '../src/middleware/log';

const { values: args } = parseArgs({
  options: {
    'env-file': { type: 'string' },
    game: { type: 'string' },
    limit: { type: 'string' },
    concurrency: { type: 'string', default: '8' },
    verify: { type: 'boolean', default: false },
    'dry-run': { type: 'boolean', default: false },
  },
});

if (args['env-file']) process.loadEnvFile(args['env-file']);

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
  },
  resize: async (body) =>
    new Uint8Array(
      await sharp(body).resize({ width: SM_WIDTH, withoutEnlargement: true }).webp().toBuffer(),
    ),
  log,
};

const pool = new Pool({ connectionString: env('DATABASE_URL'), max: 2 });
const started = Date.now();
try {
  const stats = await mirrorImages(
    deps,
    drizzle(pool),
    { game, limit },
    { concurrency, verify: args.verify, dryRun },
  );
  log('info', {
    message: 'image mirror finished',
    ...stats,
    seconds: (Date.now() - started) / 1000,
  });
} finally {
  await pool.end();
}
