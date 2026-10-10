import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appMeta,
  cards,
  collectionEntries,
  deckEntries,
  decks,
  importRuns,
  legalityChanges,
  printLocalizations,
  prints,
  sets,
  user,
} from '../../db/schema';
import {
  BanlistResponseSchema,
  PrintResponseSchema,
  SetPageResponseSchema,
} from '@voidbinder/shared/api';
import { DrizzleCardStore } from '../../platform/cloudflare/drizzle-card-store';
import { databaseUrl, freshDatabase, testApp } from '../../test-helpers';
import { banlistDatesUrl } from './banlist-dates';
import { CHUNK_LINES, planSteps, runYgoprodeckImport, type ImportDeps } from './pipeline';
import { fakeYgoprodeck, fixture, MemoryBlobStore, type FakeYgoprodeck } from './test-fixtures';
import type { Db } from './write';

describe('planSteps', () => {
  it('gives every chunk its own step, the English cards before the other languages', () => {
    const steps = planSteps('work/dev/ygoprodeck/r1', { de: 1, en: 2 });
    expect(steps.map((s) => s.name)).toEqual([
      'cards 00000',
      'cards 00001',
      'localizations de 00000',
    ]);
    expect(steps[1]?.key).toBe('work/dev/ygoprodeck/r1/cardinfo_en/00001.jsonl');
    expect(steps[2]?.key).toBe('work/dev/ygoprodeck/r1/cardinfo_de/00000.jsonl');
    expect(planSteps('p', { en: 0 })).toEqual([]);
  });
});

describe.skipIf(!databaseUrl)('YGOPRODeck import (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshDatabase()));
  afterAll(() => drop());

  const steps: string[] = [];
  const purged: string[][] = [];
  const run = (fake: FakeYgoprodeck = {}, blobs = new MemoryBlobStore(), failAt?: string) =>
    runYgoprodeckImport(
      {
        fetch: fakeYgoprodeck(fake),
        raw: blobs,
        withDb: (fn) => fn(db),
        purgeCache: async (tags) => void purged.push(tags),
      } satisfies ImportDeps,
      (name, fn) => (
        steps.push(name),
        name === failAt ? Promise.reject(new Error('step failed')) : fn()
      ),
      { env: 'dev', date: '2026-10-10', languages: ['en', 'de'] },
    );
  const meta = async (key: string) =>
    (await db.select().from(appMeta).where(eq(appMeta.key, key)))[0]?.value;
  const version = async () =>
    Number((await db.select().from(appMeta).where(eq(appMeta.key, 'catalog_version')))[0]?.value);
  const snapshot = async () =>
    Promise.all(
      [cards, prints, sets].map((t) =>
        db.select({ id: t.id, hash: t.sourceHash, updatedAt: t.updatedAt }).from(t).orderBy(t.id),
      ),
    );
  const print = async (set: string, number: string) => {
    const [row] = await db
      .select({ id: prints.id, rarity: prints.rarity, ids: prints.externalIds, card: cards.name })
      .from(prints)
      .innerJoin(sets, eq(sets.id, prints.setId))
      .innerJoin(cards, eq(cards.id, prints.cardId))
      .where(sql`${sets.code} = ${set.toLowerCase()} and ${prints.number} = ${number}`);
    if (!row) throw new Error(`print ${set} ${number} missing`);
    return row;
  };
  const localizations = async (printId: string) =>
    db
      .select({ lang: printLocalizations.lang, name: printLocalizations.name })
      .from(printLocalizations)
      .where(eq(printLocalizations.printId, printId))
      .orderBy(printLocalizations.lang);

  it('imports sets, cards, prints and localizations and bumps catalog_version', async () => {
    const before = await version();
    const blobs = new MemoryBlobStore();
    const requests: string[] = [];
    const { stats } = await run({ requests }, blobs);

    // Three requests for the whole run (en, de, sets), none for an image or per card, and two
    // for the ban lists' dates.
    expect(requests).toEqual([
      'https://db.ygoprodeck.com/api/v7/cardinfo.php?misc=yes',
      'https://db.ygoprodeck.com/api/v7/cardinfo.php?language=de',
      'https://db.ygoprodeck.com/api/v7/cardsets.php',
      banlistDatesUrl('tcg'),
      banlistDatesUrl('ocg'),
    ]);
    // The newest list in force on the run's day: not the announced 2027 one, not the Korean one.
    expect(stats.banlistDates).toEqual({ tcg: '2026-09-21', ocg: '2026-10-01' });
    expect(await meta('banlist_tcg_effective')).toBe('2026-09-21');
    expect(await meta('banlist_ocg_effective')).toBe('2026-10-01');
    // New cards have no history.
    expect(await db.select().from(legalityChanges)).toEqual([]);
    expect(stats.lines).toEqual({ en: 27, de: 21 });
    // 46 entries, 39 codes (anniversary editions share one); 3 more come from the cards.
    expect(stats.sets).toEqual({ inserted: 39, updated: 0, unchanged: 0, entries: 46 });
    expect(stats.setsCreated).toBe(3);
    // 27 objects: two are in no set (skipped, counted).
    expect(stats.cards).toEqual({ inserted: 25, updated: 0, unchanged: 0 });
    expect(stats.skipped.noSets).toBe(2);
    // BLCR-EN015/016 (two cards each) and SGX3-ENE10 (two cards): the first card keeps the print.
    expect(stats.skipped.codeConflicts).toBe(3);
    expect(stats.codeConflicts).toEqual([
      'BLCR-EN015 Secret Rare: 71620241',
      'BLCR-EN016 Secret Rare: 71620241',
      'SGX3-ENE10 Common: 24508238',
    ]);
    // One print per code and rarity: BP02-EN129, MAMO-EN038, CRBR-EN013, RA01-EN008 in several.
    expect(stats.prints).toEqual({ inserted: 62, updated: 0, unchanged: 0 });
    expect(stats.localizations).toBe(62);
    // The German list has 21 cards; 20 are in the catalog, one only exists in German.
    expect(stats.otherLanguages).toEqual({ de: { written: 51, noCard: 1 } });
    expect(await version()).toBe(before + 1);

    const [{ n: setCount } = { n: 0 }] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(sets);
    expect(setCount).toBe(42);
    const [runRow] = await db.select().from(importRuns);
    expect(runRow).toMatchObject({ source: 'ygoprodeck', kind: 'full', status: 'ok' });
    expect(runRow?.stats.codeConflicts).toEqual(stats.codeConflicts);

    // Raw dumps stay, the run's chunks are deleted.
    expect([...blobs.objects.keys()].sort()).toEqual([
      'raw/dev/ygoprodeck/2026-10-10/cardinfo_de.json.gz',
      'raw/dev/ygoprodeck/2026-10-10/cardinfo_en.json.gz',
      'raw/dev/ygoprodeck/2026-10-10/cardsets.json',
    ]);
    expect(steps).toEqual(
      expect.arrayContaining(['cards 00000', 'localizations de 00000', 'finish run']),
    );
    expect(steps[steps.indexOf('finish run') + 1]).toBe('purge cache');
    expect(purged).toEqual([['catalog']]);
    expect(CHUNK_LINES).toBeGreaterThan(27);
  });

  it('writes the model: set, print, localizations, no invented finishes', async () => {
    const [lob] = await db.select().from(sets).where(eq(sets.code, 'lob'));
    expect(lob).toMatchObject({
      gameId: 'yugioh',
      name: 'Legend of Blue Eyes White Dragon',
      releasedOn: '2002-03-08',
      cardCount: 355,
      externalIds: { set_code: 'LOB' },
    });
    const bewd = await print('LOB', 'EN001');
    expect(bewd).toMatchObject({ card: 'Blue-Eyes White Dragon', rarity: 'Ultra Rare' });
    expect(bewd.ids).toMatchObject({ set_code: 'LOB-EN001', variants: ['LOB-DE001'] });
    // The English name from the English list, the German one from the German list.
    expect(await localizations(bewd.id)).toEqual([
      { lang: 'de', name: 'Blauäugiger w. Drache' },
      { lang: 'en', name: 'Blue-Eyes White Dragon' },
    ]);
    const [card] = await db.select().from(cards).where(eq(cards.name, 'Blue-Eyes White Dragon'));
    expect(card).toMatchObject({ oracleKey: '89631139', typeLine: 'Normal Monster' });
    expect(card?.legalities).toEqual({ tcg: 'Unlimited', ocg: 'Unlimited' });
    const finishes = await db.selectDistinct({ f: prints.finishes }).from(prints);
    expect(finishes).toEqual([{ f: ['normal'] }]);
  });

  it('serves the set through the catalog API by its code in any case', async () => {
    const app = testApp({ cardStore: new DrizzleCardStore(db) });
    const res = await app.request('/catalog/sets/yugioh/LOB?lang=de');
    expect(res.status).toBe(200);
    const page = SetPageResponseSchema.parse(await res.json());
    expect(page.set.name).toBe('Legend of Blue Eyes White Dragon');
    expect(page.prints.map((p) => p.number).sort()).toEqual(['DE099', 'EN001']);
    expect(page.prints.find((p) => p.number === 'EN001')?.name).toBe('Blauäugiger w. Drache');
    // A number in two rarities: two prints next to each other, told apart by the variant.
    const bp02 = SetPageResponseSchema.parse(
      await (await app.request('/catalog/sets/yugioh/bp02')).json(),
    );
    expect(bp02.prints.map((p) => [p.number, p.variant, p.rarity])).toEqual([
      ['EN128', 'mosaic-rare', 'Mosaic Rare'],
      ['EN129', 'mosaic-rare', 'Mosaic Rare'],
      ['EN129', 'rare', 'Rare'],
    ]);
    // The source's image URLs are for the mirror (VB-57), not the API.
    const detail = PrintResponseSchema.parse(
      await (await app.request(`/catalog/prints/${bp02.prints[2]?.id}`)).json(),
    );
    expect(detail.print).toMatchObject({ variant: 'rare', externalIds: { ygoprodeck: 55144522 } });
    expect(detail.print.externalIds).not.toHaveProperty('image_url');
    expect(detail.print.externalIds).not.toHaveProperty('image_url_small');
  });

  it('keeps a German-only code as a print of its own, with both localizations', async () => {
    const own = await print('LOB', 'DE099');
    expect(own).toMatchObject({ card: 'Raigeki', rarity: 'Super Rare' });
    expect(own.ids).toMatchObject({ set_code: 'LOB-DE099', language: 'de' });
    expect((await localizations(own.id)).map((l) => l.lang)).toEqual(['de', 'en']);
  });

  it('creates a set the sets list lacks from the card, and a code without a dash as its own', async () => {
    const [db49] = await db.select().from(sets).where(eq(sets.code, 'db49'));
    expect(db49).toMatchObject({
      name: 'Dark Beginning 1',
      releasedOn: null,
      cardCount: null,
      externalIds: { set_code: 'DB49' },
    });
    expect((await print('DB49', 'DB49')).card).toBe('Backup Soldier');
  });

  it('lets the first card keep a code two cards share', async () => {
    expect((await print('SGX3', 'ENE10')).card).toBe('Mist Archfiend');
    expect((await print('BLCR', 'EN015')).card).toBe('Advanced Crystal Beast Cobalt Eagle');
  });

  it('changes nothing when the same data is imported again', async () => {
    const before = await snapshot();
    const { stats } = await run();
    expect(stats.cards).toEqual({ inserted: 0, updated: 0, unchanged: 25 });
    expect(stats.prints).toEqual({ inserted: 0, updated: 0, unchanged: 62 });
    expect(stats.sets).toMatchObject({ inserted: 0, updated: 0, unchanged: 39 });
    expect(stats.setsCreated).toBe(0);
    expect(stats.localizations + (stats.otherLanguages.de?.written ?? -1)).toBe(0);
    expect(await snapshot()).toEqual(before);
  });

  it('updates exactly the card whose text changed', async () => {
    const [old] = await db.select().from(cards).where(eq(cards.name, 'Pot of Greed'));
    const en = JSON.parse(fixture('cardinfo_en.json')) as {
      data: { name: string; desc: string }[];
    };
    const potOfGreed = en.data.find((c) => c.name === 'Pot of Greed');
    if (potOfGreed) potOfGreed.desc = 'Errata.';
    const changed = JSON.stringify(en);
    const { stats } = await run({ en: changed });
    expect(stats.cards).toEqual({ inserted: 0, updated: 1, unchanged: 24 });
    // Its three prints' English localizations carry the text.
    expect(stats.localizations).toBe(3);
    const [row] = await db.select().from(cards).where(eq(cards.name, 'Pot of Greed'));
    expect(row?.text).toBe('Errata.');
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

  it('purges nothing when a step fails after a partial write', async () => {
    purged.length = 0;
    steps.length = 0;
    await expect(run({}, undefined, 'localizations de 00000')).rejects.toThrow('step failed');
    // The English cards were written, the run failed: the edge keeps its entries until the TTL.
    expect(steps).toContain('cards 00000');
    expect(steps.at(-1)).toBe('fail run');
    expect(purged).toEqual([]);
  });

  it('fails the run on an answer without cards instead of finishing an empty one', async () => {
    const before = await version();
    await expect(run({ en: '{"error":"rate limited"}' })).rejects.toThrow(/holds no cards/);
    expect(await version()).toBe(before);
  });

  it('keeps a finished run ok when the chunk cleanup fails', async () => {
    const before = await version();
    const blobs = new MemoryBlobStore();
    blobs.delete = () => Promise.reject(new Error('R2 down'));
    const { runId } = await run({}, blobs);
    const [row] = await db.select().from(importRuns).where(eq(importRuns.id, runId));
    expect(row?.status).toBe('ok');
    expect(await version()).toBe(before + 1);
    expect(steps.at(-1)).toBe('clean up chunks');
    expect(
      [...blobs.objects.keys()].some((k) => k.startsWith(`work/dev/ygoprodeck/${runId}/`)),
    ).toBe(true);
  });

  // VB-81: Pot of Greed goes from Forbidden to Limited in the TCG, Blue-Eyes White Dragon from
  // Unlimited to Semi-Limited; the OCG and GOAT lists stay.
  const changedList = () => {
    const en = JSON.parse(fixture('cardinfo_en.json')) as {
      data: { name: string; banlist_info?: Record<string, string> }[];
    };
    for (const c of en.data) {
      if (c.name === 'Pot of Greed') c.banlist_info = { ...c.banlist_info, ban_tcg: 'Limited' };
      if (c.name === 'Blue-Eyes White Dragon') c.banlist_info = { ban_tcg: 'Semi-Limited' };
    }
    return JSON.stringify(en);
  };
  const cardId = async (name: string) => {
    const [row] = await db.select({ id: cards.id }).from(cards).where(eq(cards.name, name));
    if (!row) throw new Error(`card ${name} missing`);
    return row.id;
  };

  it('records each status change and keeps the dates when Yugipedia fails', async () => {
    const { stats } = await run({ en: changedList(), datesStatus: 500 });
    expect(stats.banlistDates).toEqual({});
    expect(await meta('banlist_tcg_effective')).toBe('2026-09-21');
    const rows = await db
      .select({
        card: cards.name,
        format: legalityChanges.format,
        from: legalityChanges.fromStatus,
        to: legalityChanges.toStatus,
      })
      .from(legalityChanges)
      .innerJoin(cards, eq(cards.id, legalityChanges.cardId))
      .orderBy(cards.name);
    expect(rows).toEqual([
      { card: 'Blue-Eyes White Dragon', format: 'tcg', from: 'Unlimited', to: 'Semi-Limited' },
      { card: 'Pot of Greed', format: 'tcg', from: 'Forbidden', to: 'Limited' },
    ]);
  });

  it('serves the ban list with its groups, changes and dates', async () => {
    const app = testApp({ cardStore: new DrizzleCardStore(db) });
    const res = await app.request('/catalog/banlist/yugioh?format=tcg&lang=de');
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toContain('public');
    const list = BanlistResponseSchema.parse(await res.json());
    expect(list.effectiveDate).toBe('2026-09-21');
    expect(list.asOf).not.toBeNull();
    expect(list.groups.limited.map((c) => c.name)).toContain('Topf der Gier');
    expect(list.groups.semiLimited.map((c) => c.name)).toEqual(['Blauäugiger w. Drache']);
    expect(list.groups.forbidden.map((c) => c.name)).not.toContain('Topf der Gier');
    expect(list.changes.map((c) => [c.card.name, c.from, c.to])).toEqual(
      expect.arrayContaining([
        ['Topf der Gier', 'Forbidden', 'Limited'],
        ['Blauäugiger w. Drache', 'Unlimited', 'Semi-Limited'],
      ]),
    );
    // A tile names a print to show.
    expect(list.groups.semiLimited[0]).toMatchObject({ setCode: expect.any(String) });
    // The OCG list did not change.
    const ocg = BanlistResponseSchema.parse(
      await (await app.request('/catalog/banlist/yugioh?format=ocg')).json(),
    );
    expect(ocg.changes).toEqual([]);
    expect(ocg.groups.forbidden.map((c) => c.name)).toContain('Pot of Greed');
    expect((await app.request('/catalog/banlist/mtg')).status).toBe(400);
  });

  it("reports the user's changed cards and the deck lines over the list", async () => {
    const [potOfGreed, blueEyes] = [
      await cardId('Pot of Greed'),
      await cardId('Blue-Eyes White Dragon'),
    ];
    const [printOfBlueEyes] = await db
      .select({ id: prints.id })
      .from(prints)
      .where(eq(prints.cardId, blueEyes));
    await db.insert(user).values({ id: 'u-ban', name: 'Kaiba', email: 'kaiba@example.test' });
    await db.insert(collectionEntries).values({
      userId: 'u-ban',
      printId: printOfBlueEyes?.id ?? '',
      quantity: 3,
      language: 'en',
      condition: 'NM',
      finish: 'normal',
    });
    const [deck] = await db
      .insert(decks)
      .values({ userId: 'u-ban', gameId: 'yugioh', name: 'Kaiba', format: 'advanced' })
      .returning({ id: decks.id });
    const raigeki = await cardId('Raigeki');
    await db.insert(deckEntries).values([
      { deckId: deck?.id ?? '', cardId: blueEyes, zone: 'main', quantity: 3 },
      { deckId: deck?.id ?? '', cardId: potOfGreed, zone: 'main', quantity: 1 },
      { deckId: deck?.id ?? '', cardId: raigeki, zone: 'main', quantity: 1 },
    ]);
    const impact = await new DrizzleCardStore(db).banlistImpact(
      'u-ban',
      { game: 'yugioh', format: 'tcg', lang: 'en' },
      '2026-01-01',
    );
    expect(impact.collection).toEqual([
      expect.objectContaining({
        card: expect.objectContaining({ id: blueEyes }),
        owned: 3,
        status: 'Semi-Limited',
        change: expect.objectContaining({ from: 'Unlimited', to: 'Semi-Limited' }),
      }),
    ]);
    // Blue-Eyes: changed and three copies over two; Pot of Greed: changed, one copy is fine;
    // Raigeki: neither.
    expect(impact.decks.map((d) => [d.card.name, d.copies, d.limit, d.change?.to])).toEqual([
      ['Blue-Eyes White Dragon', 3, 2, 'Semi-Limited'],
      ['Pot of Greed', 1, 1, 'Limited'],
    ]);
    // Changes before `since` count no more.
    const later = await new DrizzleCardStore(db).banlistImpact(
      'u-ban',
      { game: 'yugioh', format: 'tcg', lang: 'en' },
      '2999-01-01',
    );
    expect(later.collection).toEqual([]);
    expect(later.decks.map((d) => d.card.name)).toEqual(['Blue-Eyes White Dragon']);
  });
});
