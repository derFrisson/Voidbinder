import { like } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DrizzleWaitlistRepository } from './repository';
import { waitlistSignups } from './schema';

// Integration test against a real Postgres: `docker compose up -d` at the repo root, then
// DATABASE_URL=postgres://voidbinder:voidbinder@localhost:5434/voidbinder pnpm --filter site test
const url = process.env.DATABASE_URL;
if (!url)
  process.stderr.write('[waitlist] DATABASE_URL is unset: skipping the Postgres repository test\n');

describe.skipIf(!url)('DrizzleWaitlistRepository (Postgres)', () => {
  const pool = new Pool({ connectionString: url });
  const db = drizzle(pool);
  const repo = new DrizzleWaitlistRepository(db);
  const email = `it-${crypto.randomUUID()}@example.test`;
  const base = {
    email,
    locale: 'de' as const,
    status: 'pending' as const,
    confirmTokenHash: `c-${crypto.randomUUID()}`,
    confirmExpiresAt: new Date('2026-10-16T12:00:00Z'),
    consentTextVersion: '2026-10-09',
    lastConfirmationSentAt: new Date('2026-10-09T12:00:00Z'),
  };

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: new URL('../../../drizzle', import.meta.url).pathname });
  });

  afterAll(async () => {
    await db.delete(waitlistSignups).where(like(waitlistSignups.email, 'it-%@example.test'));
    await pool.end();
  });

  it('inserts, finds by email, token hash and id, and refuses a duplicate address', async () => {
    const row = await repo.insert(base);
    expect(row).toMatchObject({ ...base, confirmedAt: null, unsubscribedAt: null });
    expect(row?.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(await repo.insert({ ...base, confirmTokenHash: 'x' })).toBeNull();

    expect((await repo.findByEmail(email))?.id).toBe(row?.id);
    expect((await repo.findByConfirmTokenHash(base.confirmTokenHash))?.id).toBe(row?.id);
    expect((await repo.findById(row?.id ?? ''))?.email).toBe(email);
    expect(await repo.findById(crypto.randomUUID())).toBeNull();
    expect(await repo.findByEmail('missing@example.test')).toBeNull();
  });

  it('updates fields and keeps timestamps as dates', async () => {
    const row = await repo.findByEmail(email);
    if (!row) throw new Error('row missing');
    const confirmedAt = new Date('2026-10-10T08:00:00Z');
    await repo.update(row.id, { status: 'confirmed', confirmedAt, lastConfirmationSentAt: null });
    expect(await repo.findByEmail(email)).toMatchObject({
      status: 'confirmed',
      confirmedAt,
      lastConfirmationSentAt: null,
    });
  });

  it('enforces the status check in the database', async () => {
    const row = await repo.findByEmail(email);
    if (!row) throw new Error('row missing');
    // @ts-expect-error invalid on purpose
    await expect(repo.update(row.id, { status: 'deleted' })).rejects.toThrow();
  });

  it('deleteExpired removes only expired pending and unsubscribed rows', async () => {
    const cutoff = new Date('2026-09-01T00:00:00Z');
    const mk = (tag: string, status: 'pending' | 'confirmed' | 'unsubscribed', d: Date) =>
      repo.insert({
        ...base,
        email: `it-purge-${tag}-${crypto.randomUUID()}@example.test`,
        confirmTokenHash: `p-${crypto.randomUUID()}`,
        status,
        confirmExpiresAt: d,
        unsubscribedAt: status === 'unsubscribed' ? d : null,
      });
    const before = new Date(cutoff.getTime() - 1);
    const rows = {
      pendingOld: await mk('po', 'pending', before),
      pendingEdge: await mk('pe', 'pending', cutoff),
      confirmedOld: await mk('co', 'confirmed', before),
      unsubOld: await mk('uo', 'unsubscribed', before),
      unsubEdge: await mk('ue', 'unsubscribed', cutoff),
      // A pending row with an old unsubscribed_at must survive: the unsubscribed rule is status-bound.
      pendingWithOldUnsub: await repo.insert({
        ...base,
        email: `it-purge-pu-${crypto.randomUUID()}@example.test`,
        confirmTokenHash: `p-${crypto.randomUUID()}`,
        status: 'pending',
        confirmExpiresAt: cutoff,
        unsubscribedAt: before,
      }),
    };
    // The shared database may hold other rows (a dev database), so the counts are only checked
    // for our rows: exactly one pending and one unsubscribed row of ours are older than the cutoff.
    const counts = await repo.deleteExpired({ pendingBefore: cutoff, unsubscribedBefore: cutoff });
    expect(counts.pending).toBeGreaterThanOrEqual(1);
    expect(counts.unsubscribed).toBeGreaterThanOrEqual(1);
    const alive = async (r: { id: string } | null) => !!(r && (await repo.findById(r.id)));
    expect(await alive(rows.pendingOld)).toBe(false);
    expect(await alive(rows.unsubOld)).toBe(false);
    expect(await alive(rows.pendingEdge)).toBe(true);
    expect(await alive(rows.unsubEdge)).toBe(true);
    expect(await alive(rows.confirmedOld)).toBe(true);
    expect(await alive(rows.pendingWithOldUnsub)).toBe(true);
  });
});
