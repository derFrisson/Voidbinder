import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { appMeta, cards, importRuns, printLocalizations, prints, sets } from '../../db/schema';
import { PrintResponseSchema, SetPageResponseSchema } from '@voidbinder/shared/api';
import { DrizzleCardStore } from '../../platform/cloudflare/drizzle-card-store';
import { imagePick } from '../../platform/cloudflare/image';
import { databaseUrl, freshDatabase, testApp } from '../../test-helpers';
import { mirrorImages, pendingRows, type MirrorDeps } from '../images';
import { MemoryBlobStore } from '../scryfall/test-fixtures';
import type { Db } from '../scryfall/write';
import {
  apiUrl,
  fileUrls,
  imageName,
  numberKey,
  parseGallery,
  parseGalleryTitle,
  planArtworks,
  rarityAbbr,
  runGalleryImport,
  setNameKey,
  type GalleryPage,
} from './galleries';
import { writeLocalizations, type ImportDeps } from './pipeline';
import { CRAWL_DELAY_MS, USER_AGENT } from './source';

// Real answers (Yugipedia, 2026-10-10): the gallery titles from Quarter Century Stampede to
// Rarity Collection 5, the wikitext of RA04's English and German and RA05's English gallery, and
// the files the import asks for on these prints.
const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../test/fixtures/yugipedia/${name}`, import.meta.url).pathname,
    'utf8',
  );
const wikitext = (title: string) => {
  const answer = JSON.parse(fixture('galleries_revisions.json')) as {
    query: { pages: Record<string, { title: string; revisions: { '*': string }[] }> };
  };
  return (
    Object.values(answer.query.pages).find((p) => p.title === title)?.revisions[0]?.['*'] ?? ''
  );
};
const RA05 = 'Set Card Galleries:Rarity Collection 5 (TCG-EN-1E)';
const RA04_EN = 'Set Card Galleries:Quarter Century Stampede (TCG-EN-1E)';
const RA04_DE = 'Set Card Galleries:Quarter Century Stampede (TCG-DE-1E)';
const page = (title: string) => parseGalleryTitle(title) as GalleryPage;
const gallery = (title: string) => ({
  page: page(title),
  rows: parseGallery(wikitext(title), page(title)),
});

/** The saved answer of each request kind, whatever titles it names. */
const fakeYugipedia =
  (requests: string[]) =>
  async (url: string, init?: RequestInit): Promise<Response> => {
    requests.push(url);
    expect(init?.headers).toMatchObject({ 'User-Agent': USER_AGENT });
    const params = new URL(url).searchParams;
    return new Response(
      fixture(
        params.get('list') === 'allpages'
          ? 'galleries_allpages.json'
          : params.get('prop') === 'revisions'
            ? 'galleries_revisions.json'
            : 'galleries_imageinfo.json',
      ),
    );
  };

describe('Yugipedia galleries', () => {
  it('reads region, edition and language from a gallery title', () => {
    expect(parseGalleryTitle(RA04_DE)).toEqual({
      title: RA04_DE,
      set: 'Quarter Century Stampede',
      region: 'DE',
      edition: '1E',
      lang: 'de',
    });
    expect(
      parseGalleryTitle('Set Card Galleries:Legend of Blue Eyes White Dragon (TCG-SP)'),
    ).toMatchObject({ region: 'SP', edition: null, lang: 'es' });
    expect(
      parseGalleryTitle('Set Card Galleries:Legend of Blue Eyes White Dragon (TCG-NA-UE)')?.lang,
    ).toBe('en');
    expect(
      parseGalleryTitle('Set Card Galleries:Legend of Blue Eyes White Dragon (OCG-JP)'),
    ).toBeNull();
    expect(
      parseGalleryTitle('Set Card Galleries:Legend of Blue Eyes White Dragon (OCG-KR-1E)'),
    ).toBeNull();
    // YGOPRODeck's set names, matched to the wiki's.
    expect(setNameKey('Legendary 5D&apos;s Decks')).toBe(setNameKey("Legendary 5D's Decks"));
    expect(setNameKey('Premium Pack (TCG)')).toBe(setNameKey('Premium Pack'));
  });

  it("names rarities and cards as the template's file names do", () => {
    expect(['Starlight Rare', 'StR', 'starlight'].map(rarityAbbr)).toEqual(['StR', 'StR', 'StR']);
    expect(rarityAbbr("Collector's Rare")).toBe('CR');
    expect(rarityAbbr('PLatinum Secret Rare')).toBe('PlScR');
    expect(rarityAbbr('Quarter Century Secret Rare')).toBe('QCScR');
    expect(rarityAbbr("Ultra Rare (Pharaoh's Rare)")).toBe('URPR');
    expect(rarityAbbr('Ghost/Gold Rare')).toBe('GGR');
    expect(rarityAbbr('New artwork')).toBeNull();
    // Module:Card image name's own test cases.
    expect(imageName('Blue-Eyes White Dragon')).toBe('BlueEyesWhiteDragon');
    expect(imageName('Stardust Dragon/Assault Mode')).toBe('StardustDragonAssaultMode');
    expect(imageName("Fiend's Hand")).toBe('FiendsHand');
    expect(imageName('Fiend&#39;s Hand')).toBe('FiendsHand');
    expect(imageName('Jinzo #7')).toBe('Jinzo7');
    expect(imageName('Red Nova (card)')).toBe('RedNova');
    expect(imageName('Dark Magician (Arkana)')).toBe('DarkMagician');
    expect(imageName('Number 99: Utopia Dragonar')).toBe('Number99UtopiaDragonar');
  });

  it('parses every row of a gallery with its rarity, alt code and file', () => {
    const rows = parseGallery(wikitext(RA05), page(RA05));
    expect(rows.filter((r) => r.code === 'RA05-EN141')).toEqual([
      {
        code: 'RA05-EN141',
        rarity: 'UR',
        alt: 'EA',
        file: 'RedEyesDarkDragoon-RA05-EN-UR-1E-EA.png',
      },
      {
        code: 'RA05-EN141',
        rarity: 'StR',
        alt: 'EA',
        file: 'RedEyesDarkDragoon-RA05-EN-StR-1E-EA.png',
      },
    ]);
    expect(rows.find((r) => r.code === 'RA05-EN002')).toEqual({
      code: 'RA05-EN002',
      rarity: 'SR',
      alt: '',
      file: 'PSYFrameDriver-RA05-EN-SR-1E.png',
    });
    // `//description::` without a space; `Dark Magician (Arkana)` loses its disambiguation.
    expect(
      parseGallery(wikitext(RA04_DE), page(RA04_DE))
        .filter((r) => r.code === 'RA04-DE106' && r.rarity === 'QCScR')
        .map((r) => r.file),
    ).toEqual([
      'DarkMagician-RA04-DE-QCScR-1E-AA.png',
      'DarkMagician-RA04-DE-QCScR-1E-AA2.png',
      'DarkMagician-RA04-DE-QCScR-1E-AA3.png',
      'DarkMagician-RA04-DE-QCScR-1E-AA4.png',
      'DarkMagician-RA04-DE-QCScR-1E-AA5.png',
    ]);
    // Rows as other galleries write them (2026-10-10): a rarity and an extension on the row, an
    // explicit file, a gallery without card numbers.
    const lcgx = page(
      'Set Card Galleries:Legendary Collection 2: The Duel Academy Years Mega Pack (TCG-EN-1E)',
    );
    expect(
      parseGallery(
        `{{Set gallery|rarity=Ultra Rare|alt=|notes=[[Foo|bar]] {{X|y}}|
LCGX-EN182; Cyber End Dragon; ScR; Alt // extension::jpg
LCGX-EN183; Cyber Twin Dragon;; // file::Some File.png; description::x
}}
{{Set gallery|abbr=YGLD|
Glory of the King's Hand
}}`,
        lcgx,
      ),
    ).toEqual([
      {
        code: 'LCGX-EN182',
        rarity: 'ScR',
        alt: 'Alt',
        file: 'CyberEndDragon-LCGX-EN-ScR-1E-Alt.jpg',
      },
      { code: 'LCGX-EN183', rarity: 'UR', alt: '', file: 'Some File.png' },
    ]);
  });

  it('finds the English print from a German or European code', () => {
    expect(['EN141', 'DE141', '141'].map(numberKey)).toEqual(['141', '141', '141']);
    expect(['E001', 'G001', '001'].map(numberKey)).toEqual(['001', '001', '001']);
    expect(numberKey('ENS01')).toBe('S01');
    expect(numberKey('ENA26')).toBe('A26');
    // Several letters before the digits.
    expect(['ENSE1', 'DESE1'].map(numberKey)).toEqual(['SE1', 'SE1']);
  });

  it('plans the prints of multi-artwork cards and flagged rows, best file first', () => {
    const ra05 = planArtworks(
      'ra05',
      [
        {
          id: 'dragoon-ur',
          number: 'EN141',
          rarity: 'Ultra Rare',
          artworks: null,
          langs: [],
          language: null,
        },
        {
          id: 'dragoon-str',
          number: 'EN141',
          rarity: 'Starlight Rare',
          artworks: null,
          langs: [],
          language: null,
        },
        // One artwork, no alt code: the passcode image is right.
        {
          id: 'psy',
          number: 'EN002',
          rarity: 'Super Rare',
          artworks: null,
          langs: [],
          language: null,
        },
        { id: 'dm', number: 'EN083', rarity: 'Ultra Rare', artworks: 9, langs: [], language: null },
        // A rarity the gallery lacks: no guess.
        { id: 'dm-cr', number: 'EN083', rarity: 'Common', artworks: 9, langs: [], language: null },
      ],
      [gallery(RA05)],
    );
    expect(ra05).toEqual([
      {
        printId: 'dragoon-ur',
        lang: 'en',
        alt: 'EA',
        files: [
          'RedEyesDarkDragoon-RA05-EN-UR-1E-EA.png',
          'RedEyesDarkDragoon-RA05-EN-StR-1E-EA.png',
        ],
      },
      // Its Starlight scan is missing on the wiki: the same EA artwork in Ultra Rare next.
      {
        printId: 'dragoon-str',
        lang: 'en',
        alt: 'EA',
        files: [
          'RedEyesDarkDragoon-RA05-EN-StR-1E-EA.png',
          'RedEyesDarkDragoon-RA05-EN-UR-1E-EA.png',
        ],
      },
      // No alt code: another rarity may be another artwork, so no fallback.
      { printId: 'dm', lang: 'en', alt: '', files: ['DarkMagician-RA05-EN-UR-1E.png'] },
    ]);
    const ra04 = planArtworks(
      'ra04',
      [
        {
          id: 'aleister',
          number: 'EN024',
          rarity: 'Platinum Secret Rare',
          artworks: null,
          langs: ['de', 'fr'],
          language: null,
        },
      ],
      [gallery(RA04_DE), gallery(RA04_EN)],
    );
    // The German page has no `AA` where the English one has: its own row is taken as it is.
    // A German-only print reads the German page alone, never the English row of its number.
    expect(
      planArtworks(
        'ra04',
        [
          {
            id: 'aleister-de',
            number: 'DE024',
            rarity: 'Platinum Secret Rare',
            artworks: 2,
            langs: [],
            language: 'de',
          },
        ],
        [gallery(RA04_DE), gallery(RA04_EN)],
      ),
    ).toEqual([
      {
        printId: 'aleister-de',
        lang: 'en',
        alt: '',
        files: ['AleistertheInvoker-RA04-DE-PlScR-1E.png'],
      },
    ]);
    expect(ra04).toEqual([
      {
        printId: 'aleister',
        lang: 'en',
        alt: 'AA',
        files: [
          'AleistertheInvoker-RA04-EN-PlScR-1E-AA.png',
          'AleistertheInvoker-RA04-EN-QCScR-1E-AA.png',
        ],
      },
      {
        printId: 'aleister',
        lang: 'de',
        alt: '',
        files: ['AleistertheInvoker-RA04-DE-PlScR-1E.png'],
      },
    ]);
  });

  it('asks for files with format=json last and keeps the ones that exist', async () => {
    // A URL ending in `.png` gets MediaWiki's "Security redirect" instead of JSON.
    expect(apiUrl({ prop: 'imageinfo', titles: 'File:A.png' })).toMatch(/&format=json$/);
    const requests: string[] = [];
    const raw: string[] = [];
    const urls = await fileUrls(
      fakeYugipedia(requests),
      ['RedEyesDarkDragoon-RA05-EN-UR-1E-EA.png', 'RedEyesDarkDragoon-RA05-EN-StR-1E-EA.png'],
      raw,
      0,
    );
    expect(requests).toHaveLength(1);
    expect(raw).toHaveLength(1);
    expect(urls.get('RedEyesDarkDragoon-RA05-EN-UR-1E-EA.png')).toBe(
      'https://ms.yugipedia.com//b/bf/RedEyesDarkDragoon-RA05-EN-UR-1E-EA.png',
    );
    expect(urls.has('RedEyesDarkDragoon-RA05-EN-StR-1E-EA.png')).toBe(false);
  });
  it('waits the crawl delay before every request when no delay is given', async () => {
    vi.useFakeTimers();
    try {
      const requests: string[] = [];
      // 51 files: two `imageinfo` requests, each after CRAWL_DELAY_MS.
      const files = Array.from({ length: 51 }, (_, i) => `F${i}.png`);
      const pending = fileUrls(fakeYugipedia(requests), files, []);
      await vi.advanceTimersByTimeAsync(CRAWL_DELAY_MS - 1);
      expect(requests).toHaveLength(0);
      await vi.advanceTimersByTimeAsync(1);
      expect(requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(CRAWL_DELAY_MS - 1);
      expect(requests).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(requests).toHaveLength(2);
      await pending;
    } finally {
      vi.useRealTimers();
    }
  });
});

describe.skipIf(!databaseUrl)('Yugipedia gallery import (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshDatabase()));
  afterAll(() => drop());

  const requests: string[] = [];
  const blobs = new MemoryBlobStore();
  const run = (date = '2026-10-10') =>
    runGalleryImport(
      { fetch: fakeYugipedia(requests), raw: blobs, withDb: (fn) => fn(db) } satisfies ImportDeps,
      (_name, fn) => fn(),
      { env: 'dev', date, delayMs: 0 },
    );
  const ids: Record<string, string> = {};
  const passcodeKey = (id: number) => `images/yugioh/${id}/en/orig.jpg`;

  beforeAll(async () => {
    const set = async (code: string, name: string) =>
      (await db.insert(sets).values({ gameId: 'yugioh', code, name }).returning({ id: sets.id }))[0]
        ?.id ?? '';
    const ra05 = await set('ra05', 'Rarity Collection 5');
    const ra04 = await set('ra04', 'Quarter Century Stampede');
    await set('lob', 'Legend of Blue Eyes White Dragon');
    const print = async (
      name: string,
      key: number,
      setId: string,
      number: string,
      rarity: string,
      extra: Record<string, unknown> = {},
      langs: string[] = [],
    ) => {
      const [card] = await db
        .insert(cards)
        .values({ gameId: 'yugioh', oracleKey: `${key}`, name })
        .onConflictDoUpdate({ target: [cards.gameId, cards.oracleKey], set: { name } })
        .returning({ id: cards.id });
      const [p] = await db
        .insert(prints)
        .values({
          setId,
          cardId: card?.id ?? '',
          number,
          variant: rarity.toLowerCase().replace(/ /g, '-'),
          rarity,
          imageKey: passcodeKey(key),
          externalIds: {
            ygoprodeck: key,
            image_url: `https://images.ygoprodeck.com/images/cards/${key}.jpg`,
            ...extra,
          },
        })
        .returning({ id: prints.id });
      for (const lang of langs)
        await db.insert(printLocalizations).values({ printId: p?.id ?? '', lang, name });
      return p?.id ?? '';
    };
    ids.dragoonUr = await print('Red-Eyes Dark Dragoon', 37818794, ra05, 'EN141', 'Ultra Rare');
    ids.dragoonStr = await print(
      'Red-Eyes Dark Dragoon',
      37818794,
      ra05,
      'EN141',
      'Starlight Rare',
    );
    ids.psy = await print('PSY-Frame Driver', 49036338, ra05, 'EN002', 'Super Rare');
    ids.dm = await print('Dark Magician', 46986414, ra05, 'EN083', 'Ultra Rare', { artworks: 9 });
    ids.aleister = await print(
      'Aleister the Invoker',
      86120751,
      ra04,
      'EN024',
      'Platinum Secret Rare',
      {},
      ['de'],
    );
  });

  it('plans nothing before the YGOPRODeck import has written the artwork counts', async () => {
    await db.execute(sql`update prints set external_ids = external_ids - 'artworks'`);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect((await run()).stats).toEqual({ sets: 0, pages: 0, planned: 0, found: 0, written: 0 });
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('run the YGOPRODeck import first'));
    warn.mockRestore();
    expect(requests).toEqual([]);
    // No set cooled down.
    expect(
      await db.select().from(appMeta).where(eq(appMeta.key, 'yugipedia_galleries_checked')),
    ).toEqual([]);
    await db.execute(
      sql`update prints set external_ids = external_ids || '{"artworks":9}' where id = ${ids.dm}`,
    );
  });

  it('gives each print the scan of its artwork and lets the mirror copy it', async () => {
    const { stats } = await run();
    expect(stats).toEqual({ sets: 2, pages: 3, planned: 5, found: 4, written: 4 });
    // The listing, RA04's English and German and RA05's English gallery in one request, the files in one.
    expect(requests).toHaveLength(3);
    expect(requests.every((u) => u.startsWith('https://yugipedia.com/api.php?action=query&'))).toBe(
      true,
    );
    expect(decodeURIComponent(requests[1] ?? '')).toContain(
      `titles=${RA04_DE}|${RA04_EN}|${RA05}`.replace(/ /g, '+'),
    );

    const row = async (id: string) =>
      (
        await db
          .select({ key: prints.imageKey, ids: prints.externalIds })
          .from(prints)
          .where(eq(prints.id, id))
      )[0];
    expect((await row(ids.dragoonStr ?? ''))?.ids.artwork).toEqual({
      file: 'RedEyesDarkDragoon-RA05-EN-UR-1E-EA.png',
      url: 'https://ms.yugipedia.com//b/bf/RedEyesDarkDragoon-RA05-EN-UR-1E-EA.png',
      alt: 'EA',
    });
    // The old key serves until the mirror has stored the new scan, and the mirror plans the row.
    expect((await row(ids.dragoonStr ?? ''))?.key).toBe(passcodeKey(37818794));
    expect(
      (await pendingRows(db, { game: 'yugioh' }))
        .filter((r) => r.table === 'prints')
        .map((r) => [r.printId, r.key]),
    ).toEqual(
      expect.arrayContaining([
        [ids.dragoonStr, passcodeKey(37818794)],
        [ids.dm, passcodeKey(46986414)],
      ]),
    );
    expect((await row(ids.dm ?? ''))?.ids.artwork).toMatchObject({
      file: 'DarkMagician-RA05-EN-UR-1E.png',
    });
    expect((await row(ids.aleister ?? ''))?.ids.artwork).toMatchObject({ alt: 'AA' });
    // One artwork, no alt code: untouched.
    expect(await row(ids.psy ?? '')).toMatchObject({ key: passcodeKey(49036338) });
    expect((await row(ids.psy ?? ''))?.ids.artwork).toBeUndefined();
    // The German scan is not on the wiki: the localization keeps no artwork.
    const [de] = await db
      .select()
      .from(printLocalizations)
      .where(eq(printLocalizations.printId, ids.aleister ?? ''));
    expect(de?.externalIds).toEqual({});

    expect([...blobs.objects.keys()].sort()).toEqual([
      'raw/dev/yugipedia/galleries/2026-10-10/sets-00000.json',
      'raw/dev/yugipedia/galleries/2026-10-10/titles.json',
    ]);
    const [runRow] = await db
      .select()
      .from(importRuns)
      .where(eq(importRuns.source, 'yugipedia-galleries'));
    expect(runRow).toMatchObject({ status: 'ok', kind: 'full' });
    const [checked] = await db
      .select()
      .from(appMeta)
      .where(eq(appMeta.key, 'yugipedia_galleries_checked'));
    // `lob` has no gallery among the titles: never planned.
    expect(JSON.parse(checked?.value ?? '{}')).toEqual({ ra04: '2026-10-10', ra05: '2026-10-10' });

    // The mirror copies the scans, at one request a second with Yugipedia's User-Agent, named
    // after the file; both Red-Eyes prints share one.
    const fetched: [string, unknown][] = [];
    const slept: number[] = [];
    const deps: MirrorDeps = {
      fetch: async (url, init) => {
        fetched.push([url, init?.headers]);
        return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/png' } });
      },
      store: { put: (k, b, o) => blobs.put(k, b, o), head: (k) => blobs.head(k) },
      log: () => undefined,
      clock: { now: () => 0, sleep: async (ms) => void slept.push(ms) },
    };
    const mirrored = await mirrorImages(
      deps,
      db,
      { game: 'yugioh' },
      { concurrency: 1, verify: false },
    );
    expect(mirrored).toMatchObject({ images: 3, uploaded: 3, failed: 0 });
    expect(
      fetched.every(
        ([url, headers]) =>
          url.startsWith('https://ms.yugipedia.com/') &&
          (headers as Record<string, string>)['User-Agent'] === USER_AGENT,
      ),
    ).toBe(true);
    expect(slept).toEqual([1000, 2000]);
    expect((await row(ids.dragoonUr ?? ''))?.key).toBe(
      'images/yugioh/RedEyesDarkDragoon-RA05-EN-UR-1E-EA/en/orig.png',
    );
    expect((await row(ids.dragoonStr ?? ''))?.key).toBe(
      'images/yugioh/RedEyesDarkDragoon-RA05-EN-UR-1E-EA/en/orig.png',
    );

    // The API shows the print's own scan in every language it has no scan of its own in.
    const pick = async (lang: string) =>
      (
        await db.execute<{ image: { key: string; lang: string; sibling: boolean } }>(
          sql`select ${imagePick(prints, lang)} as image from ${prints} where ${prints.id} = ${ids.aleister}`,
        )
      ).rows[0]?.image;
    expect(await pick('de')).toEqual({
      key: 'images/yugioh/AleistertheInvoker-RA04-EN-PlScR-1E-AA/en/orig.png',
      lang: 'en',
      sibling: false,
    });
  });

  it('labels the Extended Art prints in the catalog API and keeps the scan internal', async () => {
    const app = testApp({ cardStore: new DrizzleCardStore(db) });
    const page = SetPageResponseSchema.parse(
      await (await app.request('/catalog/sets/yugioh/ra05')).json(),
    );
    expect(page.prints.map((p) => [p.number, p.rarity, p.extendedArt ?? false])).toEqual([
      ['EN002', 'Super Rare', false],
      ['EN083', 'Ultra Rare', false],
      ['EN141', 'Starlight Rare', true],
      ['EN141', 'Ultra Rare', true],
    ]);
    const res = await app.request(`/catalog/prints/${ids.dragoonUr}`);
    const { print } = PrintResponseSchema.parse(await res.json());
    expect(print.extendedArt).toBe(true);
    expect(print.externalIds).not.toHaveProperty('artwork');
  });

  it('keeps the artwork through the other importers and reads a set again after the cool-down', async () => {
    // The names import rewrites the German row (Yugipedia's) without dropping a scan on it.
    await db.execute(sql`update print_localizations set external_ids = '{"yugipedia":"Aleister the Invoker","artwork":{"file":"x.png","url":"https://x.test/x.png"}}'
      where print_id = ${ids.aleister} and lang = 'de'`);
    const page = {
      title: 'Aleister the Invoker',
      passwords: ['86120751'],
      englishName: 'Aleister the Invoker',
      localizations: [{ lang: 'de', name: 'Aleister der Herbeirufer', text: null }],
    };
    expect(await writeLocalizations(db, new Map([['86120751', page]]))).toBe(1);
    const [de] = await db
      .select()
      .from(printLocalizations)
      .where(eq(printLocalizations.printId, ids.aleister ?? ''));
    expect(de).toMatchObject({
      name: 'Aleister der Herbeirufer',
      externalIds: { yugipedia: 'Aleister the Invoker', artwork: { file: 'x.png' } },
    });
    // Unchanged otherwise: not rewritten.
    expect(await writeLocalizations(db, new Map([['86120751', page]]))).toBe(0);

    requests.length = 0;
    expect((await run('2026-10-17')).stats).toEqual({
      sets: 0,
      pages: 0,
      planned: 0,
      found: 0,
      written: 0,
    });
    // The listing only.
    expect(requests).toHaveLength(1);
    // Thirty days on: read again, nothing changed, nothing written, the mirrored keys stay.
    expect((await run('2026-11-09')).stats).toMatchObject({ sets: 2, found: 4, written: 0 });
    const [p] = await db
      .select({ key: prints.imageKey })
      .from(prints)
      .where(eq(prints.id, ids.dm ?? ''));
    expect(p?.key).toBe('images/yugioh/DarkMagician-RA05-EN-UR-1E/en/orig.png');
  });
});
