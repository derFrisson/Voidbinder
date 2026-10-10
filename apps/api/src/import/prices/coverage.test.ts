import { and, eq, inArray } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { pricesCurrent, prints, sets } from '../../db/schema';
import { databaseUrl, freshDatabase, testApp } from '../../test-helpers';
import { runScryfallImport } from '../scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../scryfall/test-fixtures';
import type { Db } from '../scryfall/write';
import { coverageCounts, lastCoverage, priceCoverage } from './coverage';
import { runTcgcsvImport } from './pipeline';
import { results, type TcgGroup } from './tcgcsv';
import { fakeTcgcsv, tcgcsvFixture } from './test-fixtures';

describe.skipIf(!databaseUrl)('price coverage (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const blobs = new MemoryBlobStore();
  const groups = results<TcgGroup>(tcgcsvFixture('1/groups.json'), 'groups');

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    await runScryfallImport(
      { fetch: fakeScryfall(), raw: blobs, withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-09', languages: ['en'] },
    );
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runTcgcsvImport(
      { fetch: fakeTcgcsv(), raw: blobs, withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-09', delayMs: 0, games: ['mtg'] },
    );
    quiet.mockRestore();
  });
  afterAll(() => drop());

  it('counts the priced prints per set, the unmatched groups and the unpriced sets', async () => {
    const c = await priceCoverage(db, 'mtg', groups);
    expect(c.sets.filter((s) => s.groups.length)).toEqual([
      { code: 'mid', name: 'Innistrad: Midnight Hunt', prints: 22, priced: 2, groups: [2864] },
      { code: 'neo', name: 'Kamigawa: Neon Dynasty', prints: 6, priced: 1, groups: [2965] },
    ]);
    expect(c.unmatchedGroups).toEqual([
      { groupId: 24770, name: 'Commander: Star Trek', abbreviation: 'TRC' },
    ]);
    expect(c.unpricedSets).toEqual([]);
    expect(coverageCounts(c)).toMatchObject({ setsWithGroup: 2, setsPriced: 2, priced: 3 });

    // Neo loses its TCGplayer price: a set with a group and no price.
    const neo = db
      .select({ id: prints.id })
      .from(prints)
      .innerJoin(sets, eq(sets.id, prints.setId))
      .where(eq(sets.code, 'neo'));
    await db
      .delete(pricesCurrent)
      .where(and(inArray(pricesCurrent.printId, neo), eq(pricesCurrent.source, 'tcgplayer')));
    expect((await priceCoverage(db, 'mtg', groups)).unpricedSets).toEqual([
      { code: 'neo', name: 'Kamigawa: Neon Dynasty', prints: 6 },
    ]);

    // A run (forced: the same build) whose Neo group lists no price WARNs once for the set.
    const warned = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const quiet = vi.spyOn(console, 'log').mockImplementation(() => {});
    await runTcgcsvImport(
      {
        fetch: fakeTcgcsv({
          files: { '1/2965/prices': JSON.stringify({ success: true, errors: [], results: [] }) },
        }),
        raw: blobs,
        withDb: (fn) => fn(db),
      },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-09', delayMs: 0, games: ['mtg'], force: true },
    );
    const warnings = warned.mock.calls.map(([line]) => JSON.parse(String(line)) as object);
    warned.mockRestore();
    quiet.mockRestore();
    expect(warnings).toEqual([
      expect.objectContaining({
        level: 'warn',
        message: 'set has a TCGplayer group and no price',
        game: 'mtg',
        code: 'neo',
        name: 'Kamigawa: Neon Dynasty',
        prints: 6,
      }),
    ]);
  });

  it('answers GET /admin/prices/coverage from the last run’s group list', async () => {
    const get = (query: string, raw = blobs, auth = 'Bearer t') =>
      testApp({
        adminToken: 't',
        priceCoverage: (game) => lastCoverage(db, raw, game),
      }).request(`/admin/prices/coverage${query}`, { headers: { Authorization: auth } });
    const res = await get('?game=mtg');
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      game: 'mtg',
      unmatchedGroups: [{ groupId: 24770 }],
      unpricedSets: [{ code: 'neo' }],
    });
    // The run imported Magic only: no Pokémon group list.
    expect((await get('?game=pokemon')).status).toBe(404);
    expect((await get('?game=mtg', new MemoryBlobStore())).status).toBe(404);
    expect((await get('?game=lorcana')).status).toBe(400);
    expect((await get('?game=mtg', blobs, 'Bearer wrong')).status).toBe(401);
  });
});
