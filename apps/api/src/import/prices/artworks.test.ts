import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { PrintResponseSchema } from '@voidbinder/shared/api';
import { cards, priceMappings, prints, sets } from '../../db/schema';
import { DrizzleCardStore } from '../../platform/cloudflare/drizzle-card-store';
import { databaseUrl, freshDatabase, testApp } from '../../test-helpers';
import { mirrorImages, type MirrorDeps } from '../images';
import { MemoryBlobStore } from '../scryfall/test-fixtures';
import type { Db } from '../scryfall/write';
import { writeArtworks } from '../yugipedia/galleries';
import { artworkFlag, runTcgcsvImport } from './pipeline';
import { results, type TcgProduct } from './tcgcsv';
import { fakeTcgcsv, tcgcsvFixture } from './test-fixtures';

// VB-119: TCGplayer's `(Extended Art)` / `(Alternate Art)` products flag their prints' artwork,
// and the product image stands in for a missing Yugipedia scan. Fixtures: TCGCSV's BETB (24815)
// and MAMO (24707) products of 2026-10-10.

const CDN = 'https://tcgplayer-cdn.tcgplayer.com/product';
const products = (groupId: number) =>
  results<TcgProduct>(tcgcsvFixture(`2/${groupId}/products.json`), 'products');

describe('artworkFlag (VB-119)', () => {
  it('reads the artwork from the product name, the image only when the product has one', () => {
    const flags = [...products(24815), ...products(24707)].map((p) => [p.name, artworkFlag(p)]);
    expect(flags).toEqual([
      ['The Great Gallant Bandit', null],
      [
        'The Great Gallant Bandit (Extended Art)',
        { alt: 'EA', productId: 719865, url: `${CDN}/719865_in_1000x1000.jpg` },
      ],
      [
        'The Great Gallant Bandit (Starlight Rare) (Extended Art)',
        { alt: 'EA', productId: 719866, url: `${CDN}/719866_in_1000x1000.jpg` },
      ],
      ['Red-Eyes Black Dragon Exceed', null],
      [
        'Red-Eyes Black Dragon Exceed (Extended Art)',
        { alt: 'EA', productId: 719878, url: `${CDN}/719878_in_1000x1000.jpg` },
      ],
      // `imageCount: 0`: the CDN answers 403.
      [
        'Red-Eyes Black Dragon Exceed (Starlight Rare) (Extended Art)',
        { alt: 'EA', productId: 719879, url: null },
      ],
      [
        "Dark Magician, the Pharaoh's Servant (Starlight Rare)  (Extended Art)",
        { alt: 'EA', productId: 714655, url: `${CDN}/714655_in_1000x1000.jpg` },
      ],
      ["Dark Magician, the Pharaoh's Servant", null],
      [
        "Dark Magician, the Pharaoh's Servant (Extended Art)",
        { alt: 'EA', productId: 714702, url: `${CDN}/714702_in_1000x1000.jpg` },
      ],
      ['Artmage Academic Arcane Arts Acropolis', null],
    ]);
    const named = (name: string) => artworkFlag({ productId: 1, name, imageCount: 1 })?.alt;
    expect(named('Aleister the Invoker (Alternate Art)')).toBe('AA');
    expect(named('Aleister the Invoker (Alternate Artwork)')).toBe('AA');
    // VB-113's artwork variants stay its own.
    expect(named('Harpie Lady (New Artwork)')).toBeUndefined();
    expect(named('Harpie Lady (Original Artwork)')).toBeUndefined();
  });
});

describe.skipIf(!databaseUrl)('Extended Art from TCGplayer (Postgres, VB-119)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  const ids: Record<string, string> = {};
  const passcodeKey = (id: number) => `images/yugioh/${id}/en/orig.jpg`;
  const scan = 'DarkMagicianthePharaohsServant-MAMO-EN-UR-1E-EA';
  const run = () =>
    runTcgcsvImport(
      {
        fetch: fakeTcgcsv({ files: { '2/groups': tcgcsvFixture('2/groups-vb119.json') } }),
        raw: new MemoryBlobStore(),
        withDb: (fn) => fn(db),
      },
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-10', delayMs: 0, games: ['yugioh'], force: true },
    );
  const artwork = async (id: string) =>
    (await db.select().from(prints).where(eq(prints.id, id)))[0]?.externalIds.artwork;

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
    const set = async (code: string, name: string) =>
      (await db.insert(sets).values({ gameId: 'yugioh', code, name }).returning({ id: sets.id }))[0]
        ?.id ?? '';
    const betb = await set('betb', 'Beyond the Brave');
    const mamo = await set('mamo', 'Magnificent Monsters');
    const print = async (
      name: string,
      key: number,
      setId: string,
      number: string,
      rarity: string,
      extra: Record<string, unknown> = {},
      imageKey = passcodeKey(key),
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
          finishes: ['normal'],
          imageKey,
          externalIds: {
            image_url: `https://images.ygoprodeck.com/images/cards/${key}.jpg`,
            ...extra,
          },
        })
        .returning({ id: prints.id });
      return p?.id ?? '';
    };
    const bandit = (rarity: string) =>
      print('The Great Gallant Bandit', 24203749, betb, 'EN027', rarity);
    ids.banditScr = await bandit('Secret Rare');
    ids.banditUr = await bandit('Ultra Rare');
    ids.banditStr = await bandit('Starlight Rare');
    ids.exceedUr = await print('Red-Eyes Black Dragon Exceed', 1, betb, 'EN036', 'Ultra Rare');
    ids.exceedStr = await print('Red-Eyes Black Dragon Exceed', 1, betb, 'EN036', 'Starlight Rare');
    const servant = "Dark Magician, the Pharaoh's Servant";
    ids.servantUr = await print(servant, 2, mamo, 'EN001', 'Ultra Rare');
    // The gallery's alt code and the Ultra Rare's scan (VB-117's sibling): never overwritten.
    const gallery = { file: `${scan}.png`, url: `https://ms.yugipedia.com/a/ab/${scan}.png` };
    ids.servantStr = await print(
      servant,
      2,
      mamo,
      'EN001',
      'Starlight Rare',
      { artwork: { ...gallery, alt: 'EA', sibling: true } },
      `images/yugioh/${scan}/en/orig.png`,
    );
    ids.artmage = await print(
      'Artmage Academic Arcane Arts Acropolis',
      3,
      mamo,
      'EN101',
      'Ultra Rare',
    );
  });
  afterAll(() => drop());

  it('flags the prints of Extended Art products and takes their image where no scan is', async () => {
    const { stats } = await run();
    expect(stats).toMatchObject({ games: { yugioh: { artworks: 3 } } });
    const tcgplayer = (product: number, url = true) => ({
      alt: 'EA',
      alt_source: 'tcgplayer',
      tcgplayer_product: product,
      ...(url ? { url: `${CDN}/${product}_in_1000x1000.jpg` } : {}),
    });
    expect(await artwork(ids.banditScr ?? '')).toBeUndefined();
    expect(await artwork(ids.banditUr ?? '')).toEqual(tcgplayer(719865));
    expect(await artwork(ids.banditStr ?? '')).toEqual(tcgplayer(719866));
    // Two Ultra Rare products, one print: the plain product prices it (VB-113), no flag.
    expect(await artwork(ids.exceedUr ?? '')).toBeUndefined();
    // A product without an image: the flag alone, the render stays.
    expect(await artwork(ids.exceedStr ?? '')).toEqual(tcgplayer(719879, false));
    expect(await artwork(ids.servantUr ?? '')).toBeUndefined();
    expect(await artwork(ids.servantStr ?? '')).toMatchObject({ alt: 'EA', sibling: true });
    expect(await artwork(ids.servantStr ?? '')).not.toHaveProperty('alt_source');
    expect(await artwork(ids.artmage ?? '')).toBeUndefined();

    // The next run changes nothing.
    expect((await run()).stats).toMatchObject({ games: { yugioh: { artworks: 0 } } });
  });

  it('mirrors the product image at TCGplayer’s own rate and labels the prints', async () => {
    const fetched: string[] = [];
    const slept: number[] = [];
    const blobs = new MemoryBlobStore();
    const deps: MirrorDeps = {
      fetch: async (url) => {
        fetched.push(url);
        return new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/jpeg' } });
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
    expect(mirrored).toMatchObject({ images: 2, uploaded: 2, failed: 0 });
    expect(fetched.sort()).toEqual([
      `${CDN}/719865_in_1000x1000.jpg`,
      `${CDN}/719866_in_1000x1000.jpg`,
    ]);
    // Two a second.
    expect(slept).toEqual([500]);
    const key = async (id: string) =>
      (await db.select().from(prints).where(eq(prints.id, id)))[0]?.imageKey;
    expect(await key(ids.banditStr ?? '')).toBe('images/yugioh/719866_in_1000x1000/en/orig.jpg');
    expect(await key(ids.exceedStr ?? '')).toBe(passcodeKey(1));

    const app = testApp({ cardStore: new DrizzleCardStore(db) });
    const shown = async (id: string) =>
      PrintResponseSchema.parse(await (await app.request(`/catalog/prints/${id}`)).json()).print;
    expect((await shown(ids.banditStr ?? '')).extendedArt).toBe(true);
    expect((await shown(ids.banditUr ?? '')).extendedArt).toBe(true);
    expect((await shown(ids.exceedStr ?? '')).extendedArt).toBe(true);
    expect((await shown(ids.banditScr ?? '')).extendedArt).toBeUndefined();
    expect((await shown(ids.banditStr ?? '')).externalIds).not.toHaveProperty('artwork');
  });

  it('gives way to the gallery’s scan, keeping the code a gallery row lacks', async () => {
    const yugipedia = (file: string) => ({ file, url: `https://ms.yugipedia.com/x/${file}` });
    // BETB's gallery: no alt code on the Starlight Rare's row; an EA row for the Ultra Rare.
    await writeArtworks(db, [
      { printId: ids.banditStr ?? '', lang: 'en', artwork: yugipedia('Bandit-StR.png') },
      {
        printId: ids.banditUr ?? '',
        lang: 'en',
        artwork: { ...yugipedia('Bandit-UR-EA.png'), alt: 'EA' },
      },
    ]);
    expect(await artwork(ids.banditStr ?? '')).toEqual({
      ...yugipedia('Bandit-StR.png'),
      alt: 'EA',
      alt_source: 'tcgplayer',
      tcgplayer_product: 719866,
    });
    expect(await artwork(ids.banditUr ?? '')).toEqual({
      ...yugipedia('Bandit-UR-EA.png'),
      alt: 'EA',
    });
    // Written once: the same rows again change nothing, and neither does the next price run.
    expect(
      await writeArtworks(db, [
        { printId: ids.banditStr ?? '', lang: 'en', artwork: yugipedia('Bandit-StR.png') },
      ]),
    ).toBe(0);
    expect((await run()).stats).toMatchObject({ games: { yugioh: { artworks: 0 } } });
    expect(await artwork(ids.banditStr ?? '')).toMatchObject(yugipedia('Bandit-StR.png'));
  });

  it('removes the flag of a print its product no longer prices', async () => {
    // An admin moves both Starlight Rare products to a print no product prices.
    const remap = async (product: number, from: string) => {
      const [p] = await db.select().from(prints).where(eq(prints.id, from));
      if (!p) throw new Error(`no print ${from}`);
      const [to] = await db
        .insert(prints)
        .values({
          ...p,
          id: undefined,
          externalIds: {},
          variant: 'qcsr',
          rarity: 'Quarter Century Secret Rare',
        })
        .returning({ id: prints.id });
      await db
        .update(priceMappings)
        .set({ printId: to?.id ?? '', method: 'manual' })
        .where(eq(priceMappings.externalId, String(product)));
      return to?.id ?? '';
    };
    const exceedQcr = await remap(719879, ids.exceedStr ?? '');
    const banditQcr = await remap(719866, ids.banditStr ?? '');
    expect((await run()).stats).toMatchObject({ games: { yugioh: { artworks: 4 } } });
    // The flag alone was TCGplayer's: the artwork goes; the gallery's scan stays.
    expect(await artwork(ids.exceedStr ?? '')).toBeUndefined();
    expect(await artwork(ids.banditStr ?? '')).toEqual({
      file: 'Bandit-StR.png',
      url: 'https://ms.yugipedia.com/x/Bandit-StR.png',
    });
    expect(await artwork(exceedQcr)).toMatchObject({ alt: 'EA', tcgplayer_product: 719879 });
    expect(await artwork(banditQcr)).toMatchObject({ alt: 'EA', tcgplayer_product: 719866 });
  });
});
