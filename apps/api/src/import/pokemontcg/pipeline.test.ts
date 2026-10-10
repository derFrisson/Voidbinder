import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMeta, importRuns, prints, sets } from '../../db/schema';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import { MemoryBlobStore } from '../scryfall/test-fixtures';
import type { Db } from '../scryfall/write';
import { card, testClient } from '../tcgdex/test-fixtures';
import { importCardChunk } from '../tcgdex/write';
import { runPokemontcgImport, writeImages } from './pipeline';

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../test/fixtures/pokemontcg/${name}`, import.meta.url).pathname,
    'utf8',
  );

/** pokemontcg.io from the recorded answers: the set list and two sets' cards; 404 otherwise. */
const fakePtcg = (calls: string[]) => async (url: string) => {
  const u = new URL(url);
  calls.push(`${u.pathname}${u.search}`);
  if (u.pathname === '/v2/sets') return new Response(fixture('sets.json'));
  const set = /^set\.id:(\w+)$/.exec(u.searchParams.get('q') ?? '')?.[1];
  if (u.pathname === '/v2/cards' && (set === 'mcd21' || set === 'swsh45sv'))
    return new Response(fixture(`cards-${set}.json`));
  return new Response('not found', { status: 404 });
};

describe.skipIf(!databaseUrl)('pokemontcg.io import (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshDatabase()));
  afterAll(() => drop());

  const calls: string[] = [];
  const blobs = new MemoryBlobStore();
  const run = (date: string) =>
    runPokemontcgImport(
      { client: testClient(fakePtcg(calls)), blobs, withDb: (fn) => fn(db) },
      (_name, fn) => fn(),
      { env: 'dev', date },
    );
  const ids = async (code: string) =>
    Object.fromEntries(
      (
        await db
          .select({ number: prints.number, ids: prints.externalIds })
          .from(prints)
          .innerJoin(sets, eq(sets.id, prints.setId))
          .where(eq(sets.code, code))
      ).map((r) => [r.number, r.ids]),
    );
  const version = async () =>
    Number((await db.select().from(appMeta).where(eq(appMeta.key, 'catalog_version')))[0]?.value);

  const TCGDEX = { high: 'https://assets.tcgdex.net/en/swsh/x/25/high.webp' };
  beforeAll(async () => {
    const set = async (code: string, name: string, releasedOn: string, abbr: string) => {
      const [row] = await db
        .insert(sets)
        .values({
          gameId: 'pokemon',
          code,
          name,
          releasedOn,
          externalIds: { tcgdex: code, abbreviation: { official: abbr } },
        })
        .returning({ id: sets.id });
      return row?.id as string;
    };
    const add = async (setId: string, number: string, name: string, extra = {}) => {
      await db.execute(sql`
        with c as (insert into cards (game_id, name, oracle_key)
          values ('pokemon', ${name}, ${`${setId}-${number}`}) returning id)
        insert into prints (card_id, set_id, number, external_ids)
        select c.id, ${setId}, ${number}, ${JSON.stringify({ tcgdex: number, ...extra })}::jsonb
        from c`);
    };
    const mcd = await set('2021swsh', "McDonald's Collection 2021", '2021-02-09', 'MCD21');
    await add(mcd, '1', 'Bulbasaur');
    await add(mcd, '25', 'Pikachu', { tcgdex_images: TCGDEX });
    await add(mcd, '99', 'Missingno');
    const vault = await set('swsh4.5sv', 'Shining Fates Shiny Vault', '2021-02-19', 'SHF:SV');
    await add(vault, 'SV001', 'Rowlet');
    const energy = await set('mee', 'Mega Evolution Energy', '2025-09-25', 'MEE');
    await add(energy, '001', 'Grass Energy');
  });

  it('stores the pictures of the prints TCGdex has none for, raw copies in R2', async () => {
    const before = await version();
    const result = await run('2026-10-12');
    expect(result.stats).toEqual({
      sets: 2,
      prints: 3,
      matched: 2,
      written: 2,
      coolingDown: 0,
      unmatched: ['mee'],
    });
    const mcd = await ids('2021swsh');
    expect(mcd['1']).toMatchObject({
      pokemontcg: 'mcd21-1',
      pokemontcg_images: {
        small: 'https://images.pokemontcg.io/mcd21/1.png',
        large: 'https://images.pokemontcg.io/mcd21/1_hires.png',
      },
    });
    // The TCGdex picture stays the only one; the unknown card gets none.
    expect(mcd['25']).toEqual({ tcgdex: '25', tcgdex_images: TCGDEX });
    expect(mcd['99']).toEqual({ tcgdex: '99' });
    expect((await ids('swsh4.5sv')).SV001).toMatchObject({ pokemontcg: 'swsh45sv-SV001' });

    expect(calls).toEqual([
      '/v2/sets?page=1&pageSize=100',
      '/v2/cards?q=set.id:mcd21&select=id,name,number,images&page=1&pageSize=100',
      '/v2/cards?q=set.id:swsh45sv&select=id,name,number,images&page=1&pageSize=100',
    ]);
    expect([...blobs.objects.keys()].sort()).toEqual([
      'raw/dev/pokemontcg/2026-10-12/cards/mcd21.json',
      'raw/dev/pokemontcg/2026-10-12/cards/swsh45sv.json',
      'raw/dev/pokemontcg/2026-10-12/sets.json',
    ]);
    const [row] = await db.select().from(importRuns).where(eq(importRuns.id, result.runId));
    expect(row).toMatchObject({ source: 'pokemontcg', kind: 'images', status: 'ok' });
    expect(await version()).toBe(before + 1);
  });

  it('waits 30 days before it fetches a set again', async () => {
    calls.length = 0;
    const before = await version();
    const result = await run('2026-10-19');
    // 2021swsh still has Missingno without a picture, but was fetched a week ago.
    expect(result.stats).toMatchObject({ sets: 0, written: 0, coolingDown: 1, unmatched: ['mee'] });
    expect(calls).toEqual(['/v2/sets?page=1&pageSize=100']);
    expect(await version()).toBe(before);

    calls.length = 0;
    expect((await run('2026-11-12')).stats).toMatchObject({ sets: 1, prints: 1, matched: 0 });
    expect(calls).toHaveLength(2);
  });

  it('never writes over a TCGdex picture', async () => {
    const [pikachu] = await db
      .select({ id: prints.id })
      .from(prints)
      .where(eq(prints.number, '25'));
    const ptcg = {
      pokemontcg: 'mcd21-25',
      pokemontcg_images: { large: 'https://images.pokemontcg.io/mcd21/25_hires.png' },
    };
    expect(await writeImages(db, new Map([[pikachu?.id as string, ptcg]]))).toBe(0);
    expect((await ids('2021swsh'))['25']).toEqual({ tcgdex: '25', tcgdex_images: TCGDEX });
  });

  it('keeps the pokemontcg.io picture when TCGdex rewrites the print', async () => {
    await db.insert(sets).values({ gameId: 'pokemon', code: 'swsh3', name: 'Darkness Ablaze' });
    const charizard = card('en', 'swsh3-136');
    // Without its TCGdex picture.
    const image = { ...charizard };
    delete image.image;
    await importCardChunk(db, { setCode: 'swsh3', en: [image], other: {} });
    const ptcg = {
      pokemontcg: 'swsh3-136',
      pokemontcg_images: { large: 'https://images.pokemontcg.io/swsh3/136_hires.png' },
    };
    const [print] = await db
      .select({ id: prints.id })
      .from(prints)
      .where(eq(prints.number, charizard.localId));
    expect(await writeImages(db, new Map([[print?.id as string, ptcg]]))).toBe(1);

    // TCGdex changes the card (a new rarity): its data is replaced, the picture ids stay.
    await importCardChunk(db, {
      setCode: 'swsh3',
      en: [{ ...image, rarity: 'Changed' }],
      other: {},
    });
    const [after] = await db
      .select({ rarity: prints.rarity, ids: prints.externalIds })
      .from(prints)
      .where(eq(prints.id, print?.id as string));
    expect(after?.rarity).toBe('Changed');
    expect(after?.ids).toMatchObject(ptcg);
  });
});
