import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  appMeta,
  cards,
  importRuns,
  printLocalizations,
  prints,
  setLocalizations,
  sets,
} from '../../db/schema';
import { DrizzleCardStore } from '../../platform/cloudflare/drizzle-card-store';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import {
  CHUNK_CARDS,
  needsImport,
  planSets,
  rotates,
  runTcgdexImport,
  type ImportOptions,
  type SetInfo,
  type StepRunner,
} from './pipeline';
import {
  card,
  fakeTcgdex,
  MemoryBlobStore,
  setDetail,
  testClient,
  type FakeTcgdex,
} from './test-fixtures';
import type { Db } from './write';

const info = (over: Partial<SetInfo> = {}): SetInfo => ({
  id: 's',
  releaseDate: '2020-01-01',
  cards: 10,
  other: { de: 10 },
  detailHash: 'h',
  ...over,
});
const complete = { prints: 10, localizations: { en: 10, de: 10 }, detailHash: 'h' };
const opts = { mode: 'incremental', date: '2026-10-10' } as const;

describe('needsImport', () => {
  it('imports a set the catalog does not know', () => {
    expect(needsImport(info(), undefined, opts)).toBe(true);
  });

  it('skips a complete old set', () => {
    expect(needsImport(info(), complete, opts)).toBe(false);
  });

  it('imports a set with fewer prints than TCGdex lists', () => {
    expect(needsImport(info(), { ...complete, prints: 9 }, opts)).toBe(true);
  });

  it('imports a set when German cards appeared', () => {
    expect(needsImport(info(), { ...complete, localizations: { en: 10, de: 8 } }, opts)).toBe(true);
    expect(needsImport(info({ other: {} }), { ...complete, localizations: { en: 10 } }, opts)).toBe(
      false,
    );
  });

  it('always refetches a set released less than 90 days ago', () => {
    expect(needsImport(info({ releaseDate: '2026-08-01' }), complete, opts)).toBe(true);
    expect(needsImport(info({ releaseDate: '2026-07-01' }), complete, opts)).toBe(false);
    expect(needsImport(info({ releaseDate: null }), complete, opts)).toBe(false);
  });

  it('refetches a set whose details changed, or that was never marked complete', () => {
    expect(needsImport(info({ detailHash: 'new' }), complete, opts)).toBe(true);
    expect(needsImport(info(), { ...complete, detailHash: undefined }, opts)).toBe(true);
  });

  it('counts the cards TCGdex answered 404 for as present', () => {
    const state = { ...complete, prints: 9, localizations: { en: 9, de: 8 } };
    expect(needsImport(info(), state, opts)).toBe(true);
    expect(
      needsImport(info(), { ...state, missingCards: { en: ['s-1'], de: ['s-1', 's-2'] } }, opts),
    ).toBe(false);
  });

  it('refetches every set on its day of the rolling refresh, about 1/30 of them a day', () => {
    const days = Array.from({ length: 30 }, (_, d) => `2026-09-${String(d + 1).padStart(2, '0')}`);
    expect(days.filter((day) => needsImport(info(), complete, { ...opts, date: day }))).toEqual([
      '2026-09-26',
    ]);
    const ids = Array.from({ length: 3000 }, (_, i) => `set${i}`);
    const due = ids.filter((id) => rotates(id, opts.date)).length;
    expect(due).toBeGreaterThan(60);
    expect(due).toBeLessThan(140);
  });

  it('imports everything in a full run', () => {
    expect(needsImport(info(), complete, { ...opts, mode: 'full' })).toBe(true);
  });
});

describe('planSets', () => {
  it('plans a chunk per 100 cards, skips sets without cards, and names the other languages', () => {
    const infos = [
      info({ id: 'a', cards: 201 }),
      info({ id: 'b', cards: 0 }),
      info({ id: 'c', other: {} }),
    ];
    expect(planSets(infos, new Map(), opts)).toEqual([
      { id: 'a', chunks: 3, langs: ['de'], detailHash: 'h' },
      { id: 'c', chunks: 1, langs: [], detailHash: 'h' },
    ]);
    expect(CHUNK_CARDS).toBe(100);
  });
});

describe.skipIf(!databaseUrl)('TCGdex import (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshDatabase()));
  afterAll(() => drop());

  const steps: string[] = [];
  const purged: string[][] = [];
  const run = (
    fake: FakeTcgdex = {},
    over: Partial<ImportOptions> = {},
    blobs = new MemoryBlobStore(),
    runner: StepRunner = (name, fn) => (steps.push(name), fn()),
  ) =>
    runTcgdexImport(
      {
        client: testClient(fakeTcgdex(fake), 1),
        blobs,
        withDb: (fn) => fn(db),
        purgeCache: async (tags) => void purged.push(tags),
      },
      runner,
      { env: 'dev', date: '2026-10-10', languages: ['en', 'de'], mode: 'incremental', ...over },
    );
  const version = async () =>
    Number((await db.select().from(appMeta).where(eq(appMeta.key, 'catalog_version')))[0]?.value);
  const snapshot = async () =>
    Promise.all(
      [cards, prints, sets].map((t) =>
        db.select({ id: t.id, hash: t.sourceHash, updatedAt: t.updatedAt }).from(t).orderBy(t.id),
      ),
    );
  const printOf = async (id: string) => {
    const [row] = await db
      .select({ print: prints, card: cards })
      .from(prints)
      .innerJoin(cards, eq(cards.id, prints.cardId))
      .where(eq(cards.oracleKey, id));
    if (!row) throw new Error(`${id} is not imported`);
    return row;
  };

  it('imports sets, cards, prints and both languages, skips Pocket, bumps catalog_version', async () => {
    const before = await version();
    const blobs = new MemoryBlobStore();
    const calls: string[] = [];
    const { stats } = await run({ calls }, {}, blobs);

    expect(stats.sets).toMatchObject({
      inserted: 3,
      updated: 0,
      unchanged: 0,
      skipped: { digital: 1, missing: 0 },
    });
    expect(stats.planned).toEqual({ sets: 3, chunks: 3, unchanged: 0 });
    expect(stats.cards).toEqual({ inserted: 24, updated: 0, unchanged: 0 });
    expect(stats.prints).toEqual({ inserted: 24, updated: 0, unchanged: 0 });
    // 24 English localizations and 22 German ones: swshp-SWSH074 and -075 have none.
    expect(stats.localizations).toBe(46);
    expect(stats.missing).toBe(0);
    expect(await version()).toBe(before + 1);

    // The Pocket set is never asked for its German side or its cards.
    expect(calls).toContain('/en/sets/A1');
    expect(calls).not.toContain('/de/sets/A1');
    expect(calls.some((c) => c.includes('A1-'))).toBe(false);
    // No card is asked for in German when the German set list lacks it.
    expect(calls).not.toContain('/de/cards/swshp-SWSH074');
    expect(calls).toContain('/en/cards/swshp-SWSH074');

    const [runRow] = await db.select().from(importRuns);
    expect(runRow).toMatchObject({ source: 'tcgdex', kind: 'delta', status: 'ok' });

    const langs = await db
      .select({ lang: printLocalizations.lang, n: sql<number>`count(*)::int` })
      .from(printLocalizations)
      .groupBy(printLocalizations.lang)
      .orderBy(printLocalizations.lang);
    expect(langs).toEqual([
      { lang: 'de', n: 22 },
      { lang: 'en', n: 24 },
    ]);

    // The raw copies stay: the lists, the set details and the cards as TCGdex sent them.
    const keys = [...blobs.objects.keys()].sort();
    expect(keys).toContain('raw/dev/tcgdex/2026-10-10/sets.en.json');
    expect(keys).toContain('raw/dev/tcgdex/2026-10-10/sets/de/swsh3.json');
    expect(keys).not.toContain('raw/dev/tcgdex/2026-10-10/sets/de/A1.json');
    expect(keys).toContain('raw/dev/tcgdex/2026-10-10/cards/swsh3/00000.en.jsonl');
    expect(keys).toContain('raw/dev/tcgdex/2026-10-10/cards/swshp/00000.de.jsonl');
    expect(steps).toEqual(
      expect.arrayContaining([
        'sets 00000',
        'plan',
        'cards swsh3 0',
        'cards base1 0',
        'finish run',
      ]),
    );
    expect(steps[steps.indexOf('finish run') + 1]).toBe('purge cache');
    expect(purged).toEqual([['catalog', 'game:pokemon']]);
  });

  it('writes the set, its names and release date', async () => {
    const [set] = await db.select().from(sets).where(eq(sets.code, 'swsh3'));
    expect(set).toMatchObject({
      gameId: 'pokemon',
      name: 'Darkness Ablaze',
      kind: 'swsh',
      cardCount: 189,
      releasedOn: '2020-08-14',
    });
    const names = await db
      .select()
      .from(setLocalizations)
      .where(eq(setLocalizations.setId, set?.id ?? ''));
    expect(names.map((n) => [n.lang, n.name]).sort()).toEqual([
      ['de', 'Flammende Finsternis'],
      ['en', 'Darkness Ablaze'],
    ]);
    expect(await db.select().from(sets).where(eq(sets.code, 'A1'))).toEqual([]);
    // Marked complete: the hash of the details it was imported from, no card missing.
    expect(set?.externalIds).toMatchObject({
      detail_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      missing_cards: {},
    });
  });

  it('serves a print without the source image URLs and the marketplace guess', async () => {
    const { card: furret, print } = await printOf('swsh3-136');
    const extra = {
      image_url: 'https://example.test/a.jpg',
      image_url_small: 'https://example.test/b.jpg',
    };
    await db
      .update(prints)
      .set({ externalIds: sql`${prints.externalIds} || ${JSON.stringify(extra)}::jsonb` })
      .where(eq(prints.id, print.id));
    const body = await new DrizzleCardStore(db).getCard(furret.id, { currency: 'EUR' });
    expect(body?.prints[0]?.externalIds).toEqual({ tcgdex: 'swsh3-136' });
    await db
      .update(prints)
      .set({ externalIds: sql`${prints.externalIds} - 'image_url' - 'image_url_small'` })
      .where(eq(prints.id, print.id));
  });

  it('writes a Trainer, an Energy and a Pokémon card as one card and one print each', async () => {
    const trainer = await printOf('swsh3-171');
    expect(trainer.card).toMatchObject({
      name: 'Struggle Gloves',
      typeLine: 'Trainer - Tool',
      legalities: { standard: 'not_legal', expanded: 'legal' },
    });
    expect(trainer.print).toMatchObject({ number: '171', rarity: 'Uncommon', artist: 'Ryo Ueda' });

    const energy = await printOf('swsh3-176');
    expect(energy.card.typeLine).toBe('Energy - Special');
    expect(energy.card.attributes).toMatchObject({ category: 'Energy', energyType: 'Special' });

    const furret = await printOf('swsh3-136');
    expect(furret.card.attributes).toMatchObject({ hp: 110, evolveFrom: 'Sentret', retreat: 1 });
    expect(furret.print.finishes).toEqual(['normal', 'reverse']);
    expect(furret.print.externalIds).toMatchObject({
      tcgdex: 'swsh3-136',
      tcgdex_marketplace: { mapping_confidence: 'low', cardmarket: 483559, tcgplayer: 219333 },
    });
  });

  it('writes all four finishes of a card that has every variant', async () => {
    expect((await printOf('base1-4')).print.finishes).toEqual([
      'normal',
      'reverse',
      'holo',
      'first_edition',
    ]);
  });

  it('gives a card without a German localization only its English one', async () => {
    const { print } = await printOf('swshp-SWSH074');
    const rows = await db
      .select()
      .from(printLocalizations)
      .where(eq(printLocalizations.printId, print.id));
    expect(rows.map((r) => r.lang)).toEqual(['en']);

    const furret = await printOf('swsh3-136');
    const both = await db
      .select()
      .from(printLocalizations)
      .where(eq(printLocalizations.printId, furret.print.id))
      .orderBy(printLocalizations.lang);
    expect(both.map((r) => [r.lang, r.name])).toEqual([
      ['de', 'Wiesenior'],
      ['en', 'Furret'],
    ]);
    expect(both[0]?.externalIds).toMatchObject({
      tcgdex_images: { high: 'https://assets.tcgdex.net/de/swsh/swsh3/136/high.webp' },
    });
  });

  it('skips the complete old sets and the unchanged rows when run again', async () => {
    const before = await snapshot();
    const calls: string[] = [];
    const { stats } = await run({ calls });
    // swsh3 and base1 are complete and old; swshp too (its two English-only cards have no German to wait for).
    expect(stats.planned).toEqual({ sets: 0, chunks: 0, unchanged: 3 });
    expect(stats.sets).toMatchObject({ inserted: 0, updated: 0, unchanged: 3 });
    expect(calls.some((c) => c.includes('/cards/'))).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it('changes nothing when a full run fetches the same data', async () => {
    const before = await snapshot();
    const { stats } = await run({}, { mode: 'full' });
    expect(stats.planned.sets).toBe(3);
    expect(stats.cards).toEqual({ inserted: 0, updated: 0, unchanged: 24 });
    expect(stats.prints).toEqual({ inserted: 0, updated: 0, unchanged: 24 });
    expect(stats.localizations).toBe(0);
    expect(await snapshot()).toEqual(before);
    const [last] = await db
      .select()
      .from(importRuns)
      .orderBy(sql`${importRuns.startedAt} desc`)
      .limit(1);
    expect(last).toMatchObject({ kind: 'full', status: 'ok' });
  });

  it('refetches a set when a German card appears, and nothing else', async () => {
    const swshpDe = setDetail('de', 'swshp');
    swshpDe.cards.push(...setDetail('en', 'swshp').cards.filter((c) => /SWSH07[45]/.test(c.id)));
    const german = { ...card('en', 'swshp-SWSH074'), name: 'Pikachu V (de)' };
    const calls: string[] = [];
    const { stats } = await run({
      calls,
      override: (path) =>
        path === '/de/sets/swshp'
          ? Response.json(swshpDe)
          : path === '/de/cards/swshp-SWSH074'
            ? Response.json(german)
            : path === '/de/cards/swshp-SWSH075'
              ? Response.json({ ...german, id: 'swshp-SWSH075', localId: 'SWSH075', name: 'Zwei' })
              : undefined,
    });
    expect(stats.planned).toEqual({ sets: 1, chunks: 1, unchanged: 2 });
    expect(stats.localizations).toBe(2);
    expect(stats.cards).toEqual({ inserted: 0, updated: 0, unchanged: 8 });
    expect(calls.filter((c) => c.includes('/cards/')).length).toBe(16);
    const { print } = await printOf('swshp-SWSH074');
    const rows = await db
      .select()
      .from(printLocalizations)
      .where(eq(printLocalizations.printId, print.id));
    expect(rows.map((r) => r.lang).sort()).toEqual(['de', 'en']);
  });

  it('does not touch a card when only its prices changed', async () => {
    const priced = {
      ...card('en', 'swsh3-136'),
      pricing: { cardmarket: { avg: 99 } },
      updated: '2031-01-01',
    };
    const { stats } = await run(
      { override: (p) => (p === '/en/cards/swsh3-136' ? Response.json(priced) : undefined) },
      { mode: 'full' },
    );
    expect(stats.cards).toMatchObject({ updated: 0, unchanged: 24 });
    expect(stats.prints).toMatchObject({ updated: 0, unchanged: 24 });
  });

  it('updates exactly the card whose text changed', async () => {
    const [old] = await db.select().from(cards).where(eq(cards.oracleKey, 'swsh3-171'));
    const changed = { ...card('en', 'swsh3-171'), effect: 'Errata text.' };
    const { stats } = await run(
      { override: (p) => (p === '/en/cards/swsh3-171' ? Response.json(changed) : undefined) },
      { mode: 'full' },
    );
    expect(stats.cards).toEqual({ inserted: 0, updated: 1, unchanged: 23 });
    const [row] = await db.select().from(cards).where(eq(cards.oracleKey, 'swsh3-171'));
    expect(row?.text).toBe('Errata text.');
    expect(row?.sourceHash).not.toBe(old?.sourceHash);
    expect(row?.updatedAt.getTime()).toBeGreaterThan(old?.updatedAt.getTime() ?? Infinity);
  });

  it('counts a card TCGdex lists but cannot deliver, and imports the rest', async () => {
    const { stats } = await run(
      {
        override: (p) =>
          p === '/en/cards/swsh3-200' ? new Response('gone', { status: 404 }) : undefined,
      },
      { mode: 'full' },
    );
    expect(stats.missing).toBe(1);
    expect(stats.prints).toMatchObject({ inserted: 0, updated: 0, unchanged: 23 });
    // Recorded, so the incremental runs do not refetch the set for it every day.
    const [swsh3] = await db.select().from(sets).where(eq(sets.code, 'swsh3'));
    // German lists it too: without the English card it is missing there as well.
    expect((swsh3?.externalIds as Record<string, unknown>).missing_cards).toEqual({
      en: ['swsh3-200'],
      de: ['swsh3-200'],
    });
  });

  it('marks a failed run and leaves catalog_version alone', async () => {
    const before = await version();
    await expect(
      run(
        {
          override: (p) =>
            p === '/en/cards/swsh3-1' ? new Response('x', { status: 500 }) : undefined,
        },
        {
          mode: 'full',
        },
      ),
    ).rejects.toThrow(/answered 500/);
    expect(await version()).toBe(before);
    const [last] = await db
      .select()
      .from(importRuns)
      .orderBy(sql`${importRuns.startedAt} desc`)
      .limit(1);
    expect(last).toMatchObject({ status: 'failed', error: expect.stringContaining('500') });
    expect(steps.at(-1)).toBe('fail run');
  });

  it('resumes at the failed step: a retried step repeats nothing before it', async () => {
    const ran: string[] = [];
    let failed = false;
    const retrying: StepRunner = async (name, fn) => {
      ran.push(name);
      try {
        return await fn();
      } catch (err) {
        if (failed || !name.startsWith('cards ')) throw err;
        failed = true;
        ran.push(`${name} (retry)`);
        return fn();
      }
    };
    let flaky = true;
    const { stats } = await run(
      {
        override: (p) => {
          if (p !== '/en/cards/base1-3' || !flaky) return undefined;
          flaky = false;
          return new Response('x', { status: 503 });
        },
      },
      { mode: 'full' },
      new MemoryBlobStore(),
      retrying,
    );
    expect(ran).toContain('cards base1 0 (retry)');
    expect(ran.filter((n) => n === 'start run')).toHaveLength(1);
    expect(ran.filter((n) => n.startsWith('sets '))).toHaveLength(1);
    expect(stats.cards).toMatchObject({ updated: 0 });
  });

  // Last: the flipped legality would show up as an update in the full runs above.
  it('refetches an old complete set on its rotation day and updates the flipped legality', async () => {
    const flipped = { ...card('en', 'swsh3-171'), legal: { standard: true, expanded: true } };
    const override = (p: string) =>
      p === '/en/cards/swsh3-171' ? Response.json(flipped) : undefined;
    // 2026-10-10 is no set's day: nothing to fetch, the flip stays unseen.
    expect((await run({ override })).stats.planned.sets).toBe(0);
    // 2026-10-09 is swsh3's day.
    const { stats } = await run({ override }, { date: '2026-10-09' });
    expect(stats.planned).toEqual({ sets: 1, chunks: 1, unchanged: 2 });
    expect(stats.cards).toEqual({ inserted: 0, updated: 1, unchanged: 7 });
    expect((await printOf('swsh3-171')).card.legalities).toEqual({
      standard: 'legal',
      expanded: 'legal',
    });
  });
});
