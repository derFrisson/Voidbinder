import { sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { cards, printLocalizations, prints, sets } from '../../db/schema';
import { runScryfallImport } from '../../import/scryfall/pipeline';
import { fakeScryfall, MemoryBlobStore } from '../../import/scryfall/test-fixtures';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import { DrizzleCardStore } from './drizzle-card-store';
import { imagePick, resolveImage, type ImagePick } from './image';

const key = (print: string, lang: string, file = 'sm.webp') =>
  `images/mtg/${print}/${lang}/${file}`;

describe('resolveImage', () => {
  it('serves the picked key with its language, else the first source URL, else nothing', () => {
    const pick = { key: 'images/mtg/a/en/sm.webp', lang: 'en', sibling: true };
    expect(resolveImage('https://img.test', pick)).toEqual({
      imageUrl: 'https://img.test/images/mtg/a/en/sm.webp',
      imageLang: 'en',
      imageFrom: 'sibling',
    });
    const sources = [
      { lang: 'de', ids: null },
      {
        lang: 'en',
        ids: { scryfall_images: { normal: 'https://cards.scryfall.io/normal/a.jpg' } },
      },
    ];
    // Without an image host the key is useless: the source URL (local dev).
    expect(resolveImage('', pick, sources)).toEqual({
      imageUrl: 'https://cards.scryfall.io/normal/a.jpg',
      imageLang: 'en',
      imageFrom: 'print',
    });
    expect(resolveImage('https://img.test', null)).toEqual({ imageUrl: null });
  });
});

// The fallback chain (VB-86/VB-87) on hand-made prints of one set and card per case.
describe.skipIf(!databaseUrl)('imagePick (Postgres)', () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>['db'];
  let drop: () => Promise<void>;
  let n = 0;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
  });
  afterAll(() => drop());

  const newSet = async (releasedOn: string) => {
    const [set] = await db
      .insert(sets)
      .values({ gameId: 'mtg', code: `s${++n}`, name: 'Set', releasedOn })
      .returning({ id: sets.id });
    return set?.id ?? '';
  };
  const newCard = async () => {
    const [card] = await db
      .insert(cards)
      .values({ gameId: 'mtg', name: `Card ${++n}`, oracleKey: `oracle-${n}` })
      .returning({ id: cards.id });
    return card?.id ?? '';
  };
  /** A print with its own key (or none) and localizations `lang → key or null`. */
  const newPrint = async (
    cardId: string,
    setId: string,
    imageKey: string | null,
    locs: Record<string, string | null> = {},
    releasedOn?: string,
  ) => {
    const [print] = await db
      .insert(prints)
      .values({ cardId, setId, number: `${++n}`, imageKey, releasedOn })
      .returning({ id: prints.id });
    const id = print?.id ?? '';
    const rows = Object.entries(locs).map(([lang, k]) => ({
      printId: id,
      lang,
      name: 'x',
      imageKey: k,
    }));
    if (rows.length) await db.insert(printLocalizations).values(rows);
    return id;
  };
  const pick = async (id: string, lang: string) => {
    const { rows } = await db.execute<{ image: ImagePick | null }>(
      sql`select ${imagePick(prints, lang)} as image from ${prints} where ${prints.id} = ${id}`,
    );
    return rows[0]?.image ?? null;
  };

  it('walks the chain: own language, own key, en, ja, the others in order', async () => {
    const set = await newSet('2024-01-01');
    // The requested language's own image; nothing changes for a print that has it.
    const full = await newPrint(await newCard(), set, key('p', 'en'), {
      de: key('p', 'de'),
      ja: key('p', 'ja'),
    });
    expect(await pick(full, 'de')).toEqual({ key: key('p', 'de'), lang: 'de', sibling: false });
    // No French image: the print's own (English) scan, before the ja localization.
    expect(await pick(full, 'fr')).toEqual({ key: key('p', 'en'), lang: 'en', sibling: false });

    const keyless = await newCard();
    const noOwn = await newPrint(keyless, set, null, {
      de: key('q', 'de'),
      ja: key('q', 'ja'),
      en: key('q', 'en'),
      fr: null,
    });
    expect(await pick(noOwn, 'fr')).toMatchObject({ key: key('q', 'en'), lang: 'en' });
    const jaFirst = await newPrint(await newCard(), set, null, {
      de: key('r', 'de'),
      ja: key('r', 'ja'),
    });
    expect(await pick(jaFirst, 'fr')).toMatchObject({ lang: 'ja' });
    const others = await newPrint(await newCard(), set, null, {
      ko: key('s', 'ko'),
      it: key('s', 'it'),
      es: key('s', 'es'),
      fr: key('s', 'fr'),
    });
    expect(await pick(others, 'en')).toMatchObject({ lang: 'fr' });
    const rest = await newPrint(await newCard(), set, null, {
      zh: key('t', 'zh'),
      ko: key('t', 'ko'),
    });
    expect(await pick(rest, 'de')).toMatchObject({ lang: 'ko', sibling: false });
  });

  it('prefers a high-res scan over a lowres one of the same step', async () => {
    const set = await newSet('2024-01-01');
    // A German lowres scan does not beat the print's own English high-res scan.
    const lowDe = await newPrint(await newCard(), set, key('u', 'en'), {
      de: key('u', 'de', 'sm-lowres.webp'),
    });
    expect(await pick(lowDe, 'de')).toEqual({ key: key('u', 'en'), lang: 'en', sibling: false });
    // A lowres own scan does not beat a German high-res one.
    const lowOwn = await newPrint(await newCard(), set, key('v', 'en', 'sm-lowres.webp'), {
      de: key('v', 'de'),
    });
    expect(await pick(lowOwn, 'de')).toMatchObject({ key: key('v', 'de') });
    // Across steps the language wins: the own English lowres scan before a Japanese high-res one.
    const lowEn = await newPrint(await newCard(), set, key('w', 'en', 'orig-lowres.jpg'), {
      ja: key('w', 'ja'),
    });
    expect(await pick(lowEn, 'en')).toMatchObject({ key: key('w', 'en', 'orig-lowres.jpg') });
  });

  it('takes another print of the card: language first, then same set, then the newest', async () => {
    const [old, mid, recent] = [
      await newSet('2010-01-01'),
      await newSet('2015-01-01'),
      await newSet('2020-01-01'),
    ];
    const card = await newCard();
    const placeholder = await newPrint(card, mid, null, { de: null });
    expect(await pick(placeholder, 'de')).toBeNull();

    const older = await newPrint(card, old, key('x', 'en'), {}, '2010-01-01');
    expect(await pick(placeholder, 'de')).toEqual({
      key: key('x', 'en'),
      lang: 'en',
      sibling: true,
    });
    const newer = await newPrint(card, recent, key('y', 'en'), {}, '2020-01-01');
    expect(await pick(placeholder, 'de')).toMatchObject({ key: key('y', 'en'), sibling: true });
    const sameSet = await newPrint(card, mid, key('z', 'en'));
    expect(await pick(placeholder, 'de')).toMatchObject({ key: key('z', 'en'), sibling: true });
    // A German scan on any sibling beats the English ones for a German reader.
    await db.insert(printLocalizations).values({
      printId: older,
      lang: 'de',
      name: 'x',
      imageKey: key('x', 'de'),
    });
    expect(await pick(placeholder, 'de')).toMatchObject({ key: key('x', 'de'), lang: 'de' });
    expect(await pick(placeholder, 'en')).toMatchObject({ key: key('z', 'en') });
    // The print's own image always wins over a sibling's.
    expect(await pick(newer, 'de')).toMatchObject({ key: key('y', 'en'), sibling: false });
    expect(await pick(sameSet, 'en')).toMatchObject({ sibling: false });
  });

  it('keeps the set page and the search on indexes', async () => {
    await runScryfallImport(
      { fetch: fakeScryfall(), raw: new MemoryBlobStore(), withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'local', date: '2026-10-09', languages: ['en', 'de'] },
    );
    const queries: { sql: string; params: unknown[] }[] = [];
    const logged = drizzle(db.$client, {
      logger: { logQuery: (query, params) => queries.push({ sql: query, params }) },
    });
    const store = new DrizzleCardStore(logged, { imageBaseUrl: 'https://img.test' });
    const query = { lang: 'de', sort: 'number', currency: 'EUR', page: 1 } as const;
    const page = await store.getSetPage('mtg', 'mid', query, 60);
    const hits = await store.search({ q: 'adeline', lang: 'de', currency: 'EUR', page: 1 }, 20);
    expect(page?.prints.length).toBeGreaterThan(0);
    expect(hits.prints.length).toBeGreaterThan(0);

    const client = await db.$client.connect();
    try {
      await client.query('begin');
      // A plan that can only scan the tables shows a Seq Scan even with seq scans disabled.
      await client.query('set local enable_seqscan = off');
      const withImage = queries.filter((q) => q.sql.includes('json_build_object'));
      expect(withImage).toHaveLength(2);
      for (const q of withImage) {
        const plan = (await client.query(`explain ${q.sql}`, q.params)).rows
          .map((r: { 'QUERY PLAN': string }) => r['QUERY PLAN'])
          .join('\n');
        expect(plan).toContain('print_localizations_print_id_lang_pk');
        expect(plan).toContain('prints_card_id_idx');
        expect(plan).not.toMatch(/Seq Scan on (prints|print_localizations)/);
      }
    } finally {
      await client.query('rollback');
      client.release();
    }
  });
});
