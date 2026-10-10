import { readFileSync } from 'node:fs';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { appMeta, cards, importRuns, printLocalizations, prints, sets } from '../../db/schema';
import { databaseUrl, freshDatabase } from '../../test-helpers';
import { MemoryBlobStore } from '../scryfall/test-fixtures';
import type { Db } from '../scryfall/write';
import { planCards, runYugipediaImport, type ImportDeps } from './pipeline';
import { parseAnswer, pickPages } from './source';

const fixture = (name: string) =>
  readFileSync(
    new URL(`../../../test/fixtures/yugipedia/${name}`, import.meta.url).pathname,
    'utf8',
  );

/** The saved answers: the passcode query and the title query, whatever cards they name. */
const fakeYugipedia =
  (requests: string[]) =>
  async (url: string): Promise<Response> => {
    requests.push(url);
    const query = decodeURIComponent(url.split('query=')[1] ?? '');
    return new Response(
      fixture(query.includes('Password::') ? 'ask_passcodes.json' : 'ask_titles.json'),
    );
  };

describe.skipIf(!databaseUrl)('Yugipedia import (Postgres)', () => {
  let db: Db;
  let drop: () => Promise<void>;
  beforeAll(async () => ({ db, drop } = await freshDatabase()));
  afterAll(() => drop());

  const requests: string[] = [];
  const run = (blobs = new MemoryBlobStore()) =>
    runYugipediaImport(
      { fetch: fakeYugipedia(requests), raw: blobs, withDb: (fn) => fn(db) } satisfies ImportDeps,
      (_name, fn) => fn(),
      { env: 'dev', date: '2026-10-10', delayMs: 0 },
    );
  const version = async () =>
    Number((await db.select().from(appMeta).where(eq(appMeta.key, 'catalog_version')))[0]?.value);
  const rows = async (key: string) =>
    db
      .select({
        number: prints.number,
        lang: printLocalizations.lang,
        name: printLocalizations.name,
        ids: printLocalizations.externalIds,
      })
      .from(printLocalizations)
      .innerJoin(prints, eq(prints.id, printLocalizations.printId))
      .innerJoin(cards, eq(cards.id, prints.cardId))
      .where(eq(cards.oracleKey, key))
      .orderBy(prints.number, printLocalizations.lang);

  beforeAll(async () => {
    const [set] = await db
      .insert(sets)
      .values({ gameId: 'yugioh', code: 'blgg', name: 'Battles of Legend: Glorious Gallery' })
      .returning({ id: sets.id });
    const card = async (key: string, name: string, numbers: string[]) => {
      const [c] = await db
        .insert(cards)
        .values({ gameId: 'yugioh', oracleKey: key, name })
        .returning({ id: cards.id });
      const made = await db
        .insert(prints)
        .values(
          numbers.map((number) => ({
            setId: set?.id ?? '',
            cardId: c?.id ?? '',
            number,
            variant: 'secret-rare',
            finishes: ['normal'],
          })),
        )
        .returning({ id: prints.id, number: prints.number });
      await db
        .insert(printLocalizations)
        .values(made.map((p) => ({ printId: p.id, lang: 'en', name })));
      return made;
    };
    await card('34950192', 'Lev Shaddoll Fusion', ['EN024', 'EN124']);
    await card('300104004', 'Cocoon of Ultra Evolution (Skill Card)', ['EN901']);
    await card('99999999', 'Not On The Wiki', ['EN999']);
    // YGOPRODeck has Odd-Eyes in German, but a newer print lacks the row.
    const [old] = await card('16178681', 'Odd-Eyes Pendulum Dragon', ['EN001', 'EN101']);
    await db.insert(printLocalizations).values({
      printId: old?.id ?? '',
      lang: 'de',
      name: 'Buntäugiger Pendeldrache (YGOPRODeck)',
    });
  });

  it('fills every language Yugipedia has for every print of the cards without German', async () => {
    expect((await planCards(db)).map((c) => c.key)).toEqual([
      '16178681',
      '300104004',
      '34950192',
      '99999999',
    ]);
    const before = await version();
    const blobs = new MemoryBlobStore();
    const { stats } = await run(blobs);
    // Lev 2 prints x 5 languages, Odd-Eyes 2 x 5 less YGOPRODeck's German row, the Skill Card 5.
    // One passcode request for the four cards, one title request for the two it did not find.
    expect(requests).toHaveLength(2);
    expect(requests.every((u) => u.startsWith('https://yugipedia.com/api.php?action=ask'))).toBe(
      true,
    );
    expect(stats).toEqual({ planned: 4, found: 3, missing: 1, written: 24 });
    expect(await version()).toBe(before + 1);

    const lev = await rows('34950192');
    expect(lev.filter((r) => r.number === 'EN124').map((r) => [r.lang, r.name])).toEqual([
      ['de', 'Lev-Schattenpuppen-Fusion'],
      ['en', 'Lev Shaddoll Fusion'],
      ['es', 'Fusión Lev Sombrañeca'],
      ['fr', "Fusion Marionnette de l'Ombre Lev"],
      ['it', 'Fusione Lev Bambolaombra'],
      ['pt', 'Fusão Lev Sombraneco'],
    ]);
    expect(lev.find((r) => r.lang === 'de')?.ids).toEqual({ yugipedia: 'Lev Shaddoll Fusion' });
    // The YGOPRODeck row stays; the print without one gets Yugipedia's.
    expect(
      (await rows('16178681')).filter((r) => r.lang === 'de').map((r) => [r.number, r.name]),
    ).toEqual([
      ['EN001', 'Buntäugiger Pendeldrache (YGOPRODeck)'],
      ['EN101', 'Buntäugiger Pendeldrache'],
    ]);
    expect((await rows('300104004')).find((r) => r.lang === 'de')?.name).toBe(
      'Kokon der Ultra-Evolution',
    );
    expect((await rows('99999999')).map((r) => r.lang)).toEqual(['en']);
    // The raw answers stay, the plan goes.
    expect([...blobs.objects.keys()]).toEqual(['raw/dev/yugipedia/2026-10-10/cards-00000.json']);
    const [runRow] = await db.select().from(importRuns).where(eq(importRuns.source, 'yugipedia'));
    expect(runRow).toMatchObject({ status: 'ok', kind: 'full' });
  });

  it('writes nothing twice: the next run only asks for the card Yugipedia lacks', async () => {
    const before = await version();
    const snapshot = () =>
      db
        .select()
        .from(printLocalizations)
        .orderBy(sql`print_id, lang`);
    const rowsBefore = await snapshot();
    requests.length = 0;
    const { stats } = await run();
    expect(stats).toEqual({ planned: 1, found: 0, missing: 1, written: 0 });
    expect(await snapshot()).toEqual(rowsBefore);
    expect(await version()).toBe(before);
  });

  it('rewrites a Yugipedia row only when the page changed', async () => {
    const { writeLocalizations } = await import('./pipeline');
    const pages = pickPages(
      parseAnswer(JSON.parse(fixture('ask_passcodes.json'))),
      [{ key: '34950192', name: 'Lev Shaddoll Fusion' }],
      'passcode',
    );
    expect(await writeLocalizations(db, pages)).toBe(0);
    const lev = pages.get('34950192');
    if (lev?.localizations[0]) lev.localizations[0].name = 'Neu';
    expect(await writeLocalizations(db, pages)).toBe(2);
  });
});
