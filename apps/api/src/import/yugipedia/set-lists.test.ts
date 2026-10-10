import { readFileSync } from 'node:fs';
import { and, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMeta, cards, importRuns, printLocalizations, prints, sets } from '../../db/schema';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import { MemoryBlobStore } from '../scryfall/test-fixtures';
import type { Db } from '../scryfall/write';
import { importLocalizationLines } from '../ygoprodeck/write';
import { parseGalleryTitle, type GalleryPage } from './galleries';
import { writeLocalizations, type ImportDeps } from './pipeline';
import { parseSetList, planCodes, runSetListImport } from './set-lists';
import { USER_AGENT } from './source';

// Real answers (Yugipedia, 2026-10-10): ten set list titles from Labyrinth of Nightmare on (the
// answer without its `continue`), and the wikitext of Labyrinth of Nightmare's TCG lists (DE, EN,
// EU, FR, IT, NA; there is no Spanish or Portuguese one).
const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../test/fixtures/yugipedia/${name}`, import.meta.url).pathname,
    'utf8',
  );
const LON = (region: string) => `Set Card Lists:Labyrinth of Nightmare (TCG-${region})`;
const wikitext = (title: string) => {
  const answer = JSON.parse(fixture('set_lists_revisions.json')) as {
    query: { pages: Record<string, { title: string; revisions: { '*': string }[] }> };
  };
  return (
    Object.values(answer.query.pages).find((p) => p.title === title)?.revisions[0]?.['*'] ?? ''
  );
};
const list = (region: string) => ({
  page: parseGalleryTitle(LON(region)) as GalleryPage,
  codes: parseSetList(wikitext(LON(region))),
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
        params.get('list') === 'allpages' ? 'set_lists_allpages.json' : 'set_lists_revisions.json',
      ),
    );
  };

describe('Yugipedia set lists', () => {
  it('reads the codes of every row', () => {
    const de = parseSetList(wikitext(LON('DE')));
    expect(de).toHaveLength(105);
    expect(de.slice(0, 2)).toEqual(['LON-G000', 'LON-G001']);
    expect(de).toContain('LON-G065');
    expect(parseSetList(wikitext(LON('FR')))).toContain('LDC-F065');
    expect(
      parseSetList('{{Set list|region=DE|\n; No number; C\nLOB-G001; Blue-Eyes; UR // x\n}}'),
    ).toEqual(['LOB-G001']);
  });

  it('takes a set list title as a gallery title', () => {
    expect(parseGalleryTitle(LON('SP'))).toMatchObject({
      set: 'Labyrinth of Nightmare',
      lang: 'es',
    });
    expect(parseGalleryTitle('Set Card Lists:Labyrinth of Nightmare (OCG-JP)')).toBeNull();
  });

  it('confirms, replaces and drops codes per language', () => {
    const pages = ['DE', 'EN', 'EU', 'FR', 'IT', 'NA'].map(list);
    const langs = ['de', 'fr', 'it', 'es', 'pt'];
    expect(
      planCodes(
        'lon',
        [
          // Our code `LON-065`, the rule's `LON-DE065`.
          { id: 'necrofear', number: '065', langs, language: null },
          { id: 'jam', number: 'E006', langs: ['de'], language: null },
          // Not on the wiki's lists (our code is not theirs): left alone.
          { id: 'unknown', number: 'EN999', langs: ['de'], language: null },
          // A print of one language only.
          { id: 'german', number: 'DE001', langs: ['de'], language: 'de' },
        ],
        pages,
      ),
    ).toEqual([
      { printId: 'necrofear', lang: 'de', code: 'LON-G065' },
      // Early French and Italian sets have a set code of their own.
      { printId: 'necrofear', lang: 'fr', code: 'LDC-F065' },
      { printId: 'necrofear', lang: 'it', code: 'LDI-I065' },
      // No Spanish or Portuguese list: never printed so.
      { printId: 'necrofear', lang: 'es', code: null },
      { printId: 'necrofear', lang: 'pt', code: null },
      { printId: 'jam', lang: 'de', code: 'LON-G006' },
    ]);
  });
});

describe.skipIf(!databaseUrl)('Yugipedia set list import (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshDatabase()));
  afterAll(() => drop());

  const requests: string[] = [];
  const blobs = new MemoryBlobStore();
  const run = (date = '2026-10-10') =>
    runSetListImport(
      { fetch: fakeYugipedia(requests), raw: blobs, withDb: (fn) => fn(db) } satisfies ImportDeps,
      (_name, fn) => fn(),
      { env: 'dev', date, delayMs: 0 },
    );
  const ids: Record<string, string> = {};
  const card = (id: number, name: string, desc = `${name} text`) =>
    JSON.stringify({ id, name, type: 'Effect Monster', desc, name_en: name });
  const codes = async (printId: string) =>
    Object.fromEntries(
      (
        await db
          .select({ lang: printLocalizations.lang, ids: printLocalizations.externalIds })
          .from(printLocalizations)
          .where(eq(printLocalizations.printId, printId))
      ).map((r) => [r.lang, r.ids]),
    );

  beforeAll(async () => {
    const set = async (code: string, name: string) =>
      (await db.insert(sets).values({ gameId: 'yugioh', code, name }).returning({ id: sets.id }))[0]
        ?.id ?? '';
    const lon = await set('lon', 'Labyrinth of Nightmare');
    const print = async (key: number, name: string, number: string, code: string) => {
      const [c] = await db
        .insert(cards)
        .values({ gameId: 'yugioh', oracleKey: `${key}`, name })
        .returning({ id: cards.id });
      const [p] = await db
        .insert(prints)
        .values({
          setId: lon,
          cardId: c?.id ?? '',
          number,
          variant: 'ultra-rare',
          rarity: 'Ultra Rare',
          externalIds: { ygoprodeck: key, set_code: code },
        })
        .returning({ id: prints.id });
      await db.insert(printLocalizations).values({ printId: p?.id ?? '', lang: 'en', name });
      return p?.id ?? '';
    };
    ids.necrofear = await print(31829185, 'Dark Necrofear', '065', 'LON-065');
    ids.jam = await print(31709826, 'Revival Jam', 'E006', 'LON-E006');
    ids.unknown = await print(99999999, 'Not Listed', 'EN999', 'LON-EN999');
    // The YGOPRODeck language passes and the Yugipedia names seed the codes by rule.
    for (const lang of ['de', 'fr', 'it', 'pt'])
      await importLocalizationLines(
        db,
        [card(31829185, `Nekrofeind ${lang}`), card(31709826, `Jam ${lang}`)],
        lang,
      );
    await importLocalizationLines(db, [card(99999999, 'Nicht gelistet')], 'de');
    await writeLocalizations(
      db,
      new Map([
        [
          '31829185',
          {
            title: 'Dark Necrofear',
            passwords: ['31829185'],
            englishName: 'Dark Necrofear',
            localizations: [{ lang: 'es', name: 'Necrodemonio Oscuro', text: 'Texto' }],
          },
        ],
      ]),
    );
  });

  it('seeds every localization with its code by rule', async () => {
    expect(await codes(ids.necrofear ?? '')).toEqual({
      en: {},
      de: { set_code: 'LON-DE065', set_code_source: 'rule' },
      fr: { set_code: 'LON-FR065', set_code_source: 'rule' },
      it: { set_code: 'LON-IT065', set_code_source: 'rule' },
      pt: { set_code: 'LON-PT065', set_code_source: 'rule' },
      es: { yugipedia: 'Dark Necrofear', set_code: 'LON-SP065', set_code_source: 'rule' },
    });
    // `E006` has no token to swap or insert.
    expect((await codes(ids.jam ?? '')).de).toEqual({});
  });

  it('verifies the codes against the set lists', async () => {
    const { stats } = (await run()) ?? {};
    expect(stats).toEqual({ sets: 1, pages: 6, planned: 9, dropped: 3, written: 9 });
    // The listing, then the six lists in one request.
    expect(requests).toHaveLength(2);
    const yugipedia = (set_code?: string) => ({
      ...(set_code ? { set_code } : {}),
      set_code_source: 'yugipedia',
    });
    expect(await codes(ids.necrofear ?? '')).toEqual({
      en: {},
      de: yugipedia('LON-G065'),
      fr: yugipedia('LDC-F065'),
      it: yugipedia('LDI-I065'),
      pt: yugipedia(),
      es: { yugipedia: 'Dark Necrofear', ...yugipedia() },
    });
    expect(await codes(ids.jam ?? '')).toEqual({
      en: {},
      de: yugipedia('LON-G006'),
      fr: yugipedia('LDC-F006'),
      it: yugipedia('LDI-I006'),
      // Portuguese LON does not exist.
      pt: yugipedia(),
    });
    // A number the lists do not name keeps the rule's code.
    expect((await codes(ids.unknown ?? '')).de).toEqual({
      set_code: 'LON-DE999',
      set_code_source: 'rule',
    });

    expect([...blobs.objects.keys()].sort()).toEqual([
      'raw/dev/yugipedia/set-lists/2026-10-10/sets-00000.json',
      'raw/dev/yugipedia/set-lists/2026-10-10/titles.json',
    ]);
    const [runRow] = await db
      .select()
      .from(importRuns)
      .where(eq(importRuns.source, 'yugipedia-set-lists'));
    expect(runRow).toMatchObject({ status: 'ok', kind: 'full' });
    const [checked] = await db
      .select()
      .from(appMeta)
      .where(eq(appMeta.key, 'yugipedia_set_lists_checked'));
    expect(JSON.parse(checked?.value ?? '{}')).toEqual({ lon: '2026-10-10' });
  });

  it('keeps a verified or dropped code through the daily imports', async () => {
    // YGOPRODeck's passes again: the names change, the verified codes stay.
    expect(await importLocalizationLines(db, [card(31829185, 'Dunkler Nekrofeind')], 'de')).toEqual(
      { written: 1, noCard: 0 },
    );
    expect(await importLocalizationLines(db, [card(31829185, 'Nekrofeind pt')], 'pt')).toEqual({
      written: 0,
      noCard: 0,
    });
    // A Yugipedia name row rewritten with a new text.
    await writeLocalizations(
      db,
      new Map([
        [
          '31829185',
          {
            title: 'Dark Necrofear',
            passwords: ['31829185'],
            englishName: 'Dark Necrofear',
            localizations: [{ lang: 'es', name: 'Necrodemonio Oscuro', text: 'Texto nuevo' }],
          },
        ],
      ]),
    );
    const [de] = await db
      .select({ name: printLocalizations.name, ids: printLocalizations.externalIds })
      .from(printLocalizations)
      .where(
        and(eq(printLocalizations.printId, ids.necrofear ?? ''), eq(printLocalizations.lang, 'de')),
      );
    expect(de).toEqual({
      name: 'Dunkler Nekrofeind',
      ids: { set_code: 'LON-G065', set_code_source: 'yugipedia' },
    });
    const all = await codes(ids.necrofear ?? '');
    expect(all.pt).toEqual({ set_code_source: 'yugipedia' });
    expect(all.es).toEqual({ yugipedia: 'Dark Necrofear', set_code_source: 'yugipedia' });
  });

  it('does not read a set again within the cool-down', async () => {
    requests.length = 0;
    expect((await run('2026-10-20'))?.stats).toEqual({
      sets: 0,
      pages: 0,
      planned: 0,
      dropped: 0,
      written: 0,
    });
    expect(requests).toHaveLength(1);
  });
});
