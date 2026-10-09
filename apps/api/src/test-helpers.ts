import type { BlobStore, CardStore, JobQueue } from '@voidbinder/core';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { createApp, type Platform } from './app';

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
 * parallel without seeing each other. `drop()` removes it.
 */
export async function freshDatabase() {
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
  await migrate(db, migrationConfig);
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

export interface TestAppOptions {
  /** false: the database ping fails. */
  dbUp?: boolean;
  /** Overrides the in-memory card store (e.g. a DrizzleCardStore on the test database). */
  cardStore?: CardStore;
  jobQueue?: JobQueue;
  adminToken?: string;
}

/** The app with an in-memory platform. */
export function testApp(opts: TestAppOptions = {}) {
  const platform: Platform = {
    cardStore:
      opts.cardStore ??
      unavailable<CardStore>('card store', {
        ping: () => (opts.dbUp === false ? Promise.reject(new Error('down')) : Promise.resolve()),
      }),
    blobStore: unavailable<BlobStore>('blob store'),
    jobQueue: opts.jobQueue ?? unavailable<JobQueue>('job queue'),
    close: async () => undefined,
  };
  return createApp({
    appUrl: 'https://app.example.test',
    version: 'test',
    adminToken: opts.adminToken,
    openPlatform: () => platform,
  });
}
