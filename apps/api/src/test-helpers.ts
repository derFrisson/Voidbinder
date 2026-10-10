import type { BlobStore, CardStore, CollectionStore, DeckStore, JobQueue } from '@voidbinder/core';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { createApp, type AppDeps, type Platform } from './app';
import type { MailMessage } from './auth/mail';

/** The Postgres of the integration tests; unset skips them. */
export const databaseUrl = process.env.DATABASE_URL;

/** Every programmatic migrate() uses the API's journal table (drizzle.config.ts). */
export const migrationConfig = {
  migrationsFolder: new URL('../drizzle', import.meta.url).pathname,
  migrationsSchema: 'drizzle',
  migrationsTable: '__drizzle_migrations_api',
};

/**
 * A new, migrated database on the test server, so test files that write the catalog run in
 * parallel without seeing each other. `drop()` removes it. `migrationsFolder`: migrate from
 * another folder (a test of a migration's data step, from the migrations before it).
 */
export async function freshDatabase(migrationsFolder = migrationConfig.migrationsFolder) {
  if (!databaseUrl) throw new Error('DATABASE_URL is unset');
  const admin = new Pool({ connectionString: databaseUrl, max: 1 });
  const name = `test_${crypto.randomUUID().replaceAll('-', '')}`;
  await admin.query(`create database ${name}`);
  const url = new URL(databaseUrl);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString() });
  // `drop database … with (force)` can terminate a client that `pool.end()` is still closing;
  // without a listener its error would surface as an unhandled error of the test run.
  pool.on('error', () => undefined);
  const db = drizzle(pool);
  await migrate(db, { ...migrationConfig, migrationsFolder });
  return {
    db,
    drop: async () => {
      await pool.end();
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}

/** A stand-in whose methods reject unless overridden: for tests that never touch that seam. */
function unavailable<T extends object>(what: string, overrides: Partial<T> = {}): T {
  return new Proxy(overrides as T, {
    get: (target, key) =>
      target[key as keyof T] ??
      (() => Promise.reject(new Error(`${what} not available in this test`))),
  });
}

/** The deps every test app shares; `mails` records what the app sent. */
export function testDeps(mails: MailMessage[] = []): Omit<AppDeps, 'openPlatform'> {
  return {
    appUrl: 'https://app.example.test',
    extraOrigins: [],
    version: 'test',
    auth: {
      secret: 'test-secret-that-is-at-least-32-bytes-long',
      apiUrl: 'https://api.example.test',
      twoFactorKey: btoa('test-two-factor-key-of-32-bytes!'),
      mail: { send: async (m) => void mails.push(m) },
    },
    // Sign-up and the reset request go through without a token, like local development.
    turnstile: { secret: 'test-turnstile-secret', skip: true, nativeBypass: false },
  };
}

export interface TestAppOptions {
  /** false: the database ping fails. */
  dbUp?: boolean;
  /** Overrides the in-memory card store (e.g. a DrizzleCardStore on the test database). */
  cardStore?: CardStore;
  jobQueue?: JobQueue;
  collectionStore?: CollectionStore;
  deckStore?: DeckStore;
  /** The cache-disabled database (admin writes); unavailable otherwise. */
  db?: NodePgDatabase;
  adminToken?: string;
  extraOrigins?: string[];
}

/** The app with an in-memory platform. */
export function testApp(opts: TestAppOptions = {}) {
  const platform: Platform = {
    cardStore:
      opts.cardStore ??
      unavailable<CardStore>('card store', {
        ping: () => (opts.dbUp === false ? Promise.reject(new Error('down')) : Promise.resolve()),
      }),
    collectionStore: opts.collectionStore ?? unavailable<CollectionStore>('collection store'),
    deckStore: opts.deckStore ?? unavailable<DeckStore>('deck store'),
    blobStore: unavailable<BlobStore>('blob store'),
    jobQueue: opts.jobQueue ?? unavailable<JobQueue>('job queue'),
    db: opts.db ?? unavailable<NodePgDatabase>('database'),
    close: async () => undefined,
  };
  return createApp({
    ...testDeps(),
    extraOrigins: opts.extraOrigins ?? [],
    adminToken: opts.adminToken,
    openPlatform: () => platform,
  });
}
