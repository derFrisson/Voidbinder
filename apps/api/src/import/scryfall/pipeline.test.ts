import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMeta, cards, importRuns, printLocalizations, prints, sets } from '../../db/schema';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import { CHUNK_LINES, planSteps, runScryfallImport, type ImportDeps } from './pipeline';
import { fakeScryfall, fixture, MemoryBlobStore, type FakeScryfall } from './test-fixtures';
import type { Db } from './write';

describe('planSteps', () => {
  it('gives every chunk its own step, cards before the other languages', () => {
    const steps = planSteps('work/scryfall/r1', 3, 2);
    expect(steps.map((s) => s.name)).toEqual([
      'cards 00000',
      'cards 00001',
      'cards 00002',
      'localizations 00000',
      'localizations 00001',
    ]);
    expect(steps[2]?.key).toBe('work/scryfall/r1/default_cards/00002.jsonl');
    expect(steps[4]?.key).toBe('work/scryfall/r1/all_cards/00001.jsonl');
    expect(planSteps('p', 0, 0)).toEqual([]);
  });
});

describe.skipIf(!databaseUrl)('Scryfall import (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshDatabase()));
  afterAll(() => drop());

  const steps: string[] = [];
  const run = (fake: FakeScryfall = {}, blobs = new MemoryBlobStore()) =>
    runScryfallImport(
      { fetch: fakeScryfall(fake), blobs, withDb: (fn) => fn(db) } satisfies ImportDeps,
      (name, fn) => (steps.push(name), fn()),
      { date: '2026-10-09', languages: ['en', 'de'] },
    );
  const version = async () =>
    Number((await db.select().from(appMeta).where(eq(appMeta.key, 'catalog_version')))[0]?.value);
  const snapshot = async () =>
    Promise.all(
      [cards, prints, sets].map((t) =>
        db.select({ id: t.id, hash: t.sourceHash, updatedAt: t.updatedAt }).from(t).orderBy(t.id),
      ),
    );

  it('imports sets, cards, prints and localizations and bumps catalog_version', async () => {
    const before = await version();
    const blobs = new MemoryBlobStore();
    const { stats } = await run({}, blobs);

    expect(stats.sets).toEqual({ inserted: 2, updated: 0, unchanged: 0, skipped: 2 });
    expect(stats.prints).toEqual({ inserted: 28, updated: 0, unchanged: 0 });
    // 28 prints, two of them Plains: 27 cards.
    expect(stats.cards).toEqual({ inserted: 27, updated: 0, unchanged: 0 });
    expect(stats.skipped).toEqual({ layout: 1, digital: 1, noSet: 0 });
    expect(stats.otherLanguages).toEqual({ written: 2, noPrint: 0 });
    expect(await version()).toBe(before + 1);

    const langs = await db
      .select({ lang: printLocalizations.lang, n: sql<number>`count(*)::int` })
      .from(printLocalizations)
      .groupBy(printLocalizations.lang)
      .orderBy(printLocalizations.lang);
    // neo 293 (a Plains) was printed in Japanese only: default_cards carries it as `ja`.
    expect(langs).toEqual([
      { lang: 'de', n: 2 },
      { lang: 'en', n: 27 },
      { lang: 'ja', n: 1 },
    ]);
    const [runRow] = await db.select().from(importRuns);
    expect(runRow).toMatchObject({ source: 'scryfall', kind: 'full', status: 'ok' });

    // Raw dumps stay, the run's chunks are deleted.
    expect([...blobs.objects.keys()].sort()).toEqual([
      'raw/scryfall/2026-10-09/all_cards.jsonl.gz',
      'raw/scryfall/2026-10-09/default_cards.jsonl.gz',
      'raw/scryfall/2026-10-09/sets.json',
    ]);
    expect(steps).toContain('cards 00000');
    expect(steps).toContain('localizations 00000');
    expect(CHUNK_LINES).toBeGreaterThan(30);
  });

  it('changes nothing when the same data is imported again', async () => {
    const before = await snapshot();
    const { stats } = await run();
    expect(stats.cards).toEqual({ inserted: 0, updated: 0, unchanged: 27 });
    expect(stats.prints).toEqual({ inserted: 0, updated: 0, unchanged: 28 });
    expect(stats.sets).toMatchObject({ inserted: 0, updated: 0, unchanged: 2 });
    expect(stats.localizations + stats.otherLanguages.written).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('updates exactly the card whose text changed', async () => {
    const [old] = await db.select().from(cards).where(eq(cards.name, 'Blessed Defiance'));
    const changed = fixture('default_cards.jsonl').replace(
      /("name":"Blessed Defiance".*?"oracle_text":")[^"]*/,
      '$1Errata text.',
    );
    const { stats } = await run({ defaultCards: changed });
    expect(stats.cards).toEqual({ inserted: 0, updated: 1, unchanged: 26 });
    const [row] = await db.select().from(cards).where(eq(cards.name, 'Blessed Defiance'));
    expect(row?.text).toBe('Errata text.');
    expect(row?.sourceHash).not.toBe(old?.sourceHash);
    expect(row?.updatedAt.getTime()).toBeGreaterThan(old?.updatedAt.getTime() ?? Infinity);
  });

  it('marks a failed run and leaves catalog_version alone', async () => {
    const before = await version();
    await expect(run({ setsStatus: 500 })).rejects.toThrow(/answered 500/);
    expect(await version()).toBe(before);
    const [last] = await db
      .select()
      .from(importRuns)
      .orderBy(sql`${importRuns.startedAt} desc`)
      .limit(1);
    expect(last).toMatchObject({ status: 'failed', error: expect.stringContaining('500') });
    expect(steps.at(-1)).toBe('fail run');
  });
});
