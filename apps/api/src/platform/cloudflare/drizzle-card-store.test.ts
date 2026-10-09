import { eq } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMeta } from '../../db/schema';
import { DrizzleCardStore } from './drizzle-card-store';

// Integration test against a real Postgres: `docker compose up -d` at the repo root, then
// DATABASE_URL=postgres://voidbinder:voidbinder@localhost:5434/voidbinder pnpm --filter api test
const url = process.env.DATABASE_URL;
if (!url) process.stderr.write('[api] DATABASE_URL is unset: skipping the Postgres tests\n');

describe.skipIf(!url)('DrizzleCardStore (Postgres)', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  const migrationsFolder = new URL('../../../drizzle', import.meta.url).pathname;
  const config = {
    migrationsFolder,
    migrationsSchema: 'drizzle',
    migrationsTable: '__drizzle_migrations_api',
  };

  beforeAll(async () => {
    // ponytail: the site's test may create the shared `drizzle` schema at the same moment
    // (turbo runs both); one retry covers that race.
    await migrate(db, config).catch(() => migrate(db, config));
  });

  afterAll(() => pool.end());

  it('migrates app_meta with the catalog_version seed', async () => {
    const [row] = await db.select().from(appMeta).where(eq(appMeta.key, 'catalog_version'));
    expect(row?.value).toEqual(expect.any(String));
    expect(row?.updatedAt).toBeInstanceOf(Date);
  });

  it('pings an open database and rejects on a closed one', async () => {
    await expect(new DrizzleCardStore(db).ping()).resolves.toBeUndefined();

    const closed = new Pool({ connectionString: 'postgres://nobody:x@127.0.0.1:1/none' });
    await expect(new DrizzleCardStore(drizzle(closed)).ping()).rejects.toThrow();
    await closed.end();
  });
});
