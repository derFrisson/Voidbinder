import { and, eq, inArray } from 'drizzle-orm';
import { cards, printLocalizations, prints, sets } from './db/schema';
import type { Db } from './import/scryfall/write';

/**
 * A small catalog of the three games for the search tests (VB-79) and the search index parity
 * test (VB-98), written straight into a fresh database.
 */
export async function seedSearchCatalog(db: Db): Promise<void> {
  const set = async (
    gameId: string,
    code: string,
    name: string,
    releasedOn: string,
    cardCount: number,
  ) =>
    (
      await db
        .insert(sets)
        .values({ gameId, code, name, releasedOn, cardCount })
        .returning({ id: sets.id })
    )[0]?.id ?? '';
  const print = async (
    setId: string,
    gameId: string,
    name: string,
    number: string,
    de?: string,
    fr?: string,
  ) => {
    const [card] = await db
      .insert(cards)
      .values({ gameId, name, oracleKey: `${gameId}-${name}` })
      .onConflictDoUpdate({ target: [cards.gameId, cards.oracleKey], set: { name } })
      .returning({ id: cards.id });
    const [p] = await db
      .insert(prints)
      .values({ cardId: card?.id ?? '', setId, number, rarity: 'common' })
      .returning({ id: prints.id });
    await db
      .insert(printLocalizations)
      .values([
        { printId: p?.id ?? '', lang: 'en', name },
        ...(de ? [{ printId: p?.id ?? '', lang: 'de', name: de }] : []),
        ...(fr ? [{ printId: p?.id ?? '', lang: 'fr', name: fr }] : []),
      ]);
  };
  const lds3 = await set('yugioh', 'lds3', 'Legendary Duelists: Season 3', '2022-07-14', 391);
  await print(lds3, 'yugioh', 'Satellite Warrior', 'EN121', 'Satellitenkrieger');
  await print(lds3, 'yugioh', 'Stardust Dragon', 'EN012');
  for (const n of [120, 122, 123, 124, 125])
    await print(lds3, 'yugioh', `Duelist Filler ${n}`, `EN${n}`);
  const blgg = await set('yugioh', 'blgg', 'Battles of Legend: Chapter 1', '2024-01-11', 100);
  await print(blgg, 'yugioh', 'Ghostrick Angel of Mischief', 'EN024');
  // VB-94: a language the set lists dropped (no Portuguese print): shown as `BLGG-EN024`.
  const [ghostrick] = await db
    .select({ id: prints.id })
    .from(prints)
    .where(and(eq(prints.setId, blgg), eq(prints.number, 'EN024')));
  await db.insert(printLocalizations).values({
    printId: ghostrick?.id ?? '',
    lang: 'pt',
    name: 'Anjo Fantasmagórico da Travessura',
    externalIds: { set_code_source: 'yugipedia' },
  });
  // VB-102: a name search shows the language that matched.
  await print(blgg, 'yugioh', 'Lev Shaddoll', 'EN025', 'Lev-Schattenpuppen');
  // VB-102: a typed language token without a number names the language of a set's prints.
  const lc01 = await set('yugioh', 'lc01', 'Legendary Collection', '2010-10-12', 6);
  await print(lc01, 'yugioh', 'Blue-Eyes White Dragon', 'EN004', 'Blauäugiger w. Drache');
  await print(lc01, 'yugioh', 'Dark Magician', 'EN005', 'Dunkler Magier');
  await print(lc01, 'yugioh', 'Red-Eyes Black Dragon', 'EN006', 'Rotäugiger schwarzer Drache');
  // VB-94: localized codes the rule does not derive from `LON-065`, verified on Yugipedia.
  const lon = await set('yugioh', 'lon', 'Labyrinth of Nightmare', '2002-03-01', 105);
  await print(lon, 'yugioh', 'Dark Necrofear', '065', 'Dunkler Nekrofeind', 'Nécrofear Sombre');
  for (const [lang, code] of [
    ['de', 'LON-G065'],
    ['fr', 'LDC-F065'],
  ] as const)
    await db
      .update(printLocalizations)
      .set({ externalIds: { set_code: code, set_code_source: 'yugipedia' } })
      .where(
        and(
          eq(printLocalizations.lang, lang),
          inArray(
            printLocalizations.printId,
            db.select({ id: prints.id }).from(prints).where(eq(prints.setId, lon)),
          ),
        ),
      );
  const sv01 = await set('pokemon', 'sv01', 'Scarlet & Violet', '2023-03-31', 198);
  await print(sv01, 'pokemon', 'Pineco', '001', 'Tannza');
  await print(sv01, 'pokemon', 'Forretress ex', '005');
  // The same name in three languages.
  await print(sv01, 'pokemon', 'Pikachu', '063', 'Pikachu', 'Pikachu');
  const sv10 = await set('pokemon', 'sv10', 'Destined Rivals', '2025-05-30', 182);
  await print(sv10, 'pokemon', 'Ethan’s Pinsir', '001');
  // Pineco's newest print has no German name.
  await print(sv10, 'pokemon', 'Pineco', '090');
  // TCGdex numbers older sets without padding: `swsh1 25` could also be swsh12 #5.
  const swsh1 = await set('pokemon', 'swsh1', 'Sword & Shield', '2020-02-07', 202);
  await print(swsh1, 'pokemon', 'Flapple', '25');
  const swsh12 = await set('pokemon', 'swsh12', 'Silver Tempest', '2022-11-11', 195);
  await print(swsh12, 'pokemon', 'Scyther', '5');
  const base1 = await set('pokemon', 'base1', 'Base', '1999-01-09', 102);
  await print(base1, 'pokemon', 'Alakazam', '1');
  await print(base1, 'pokemon', 'Midas Touch', '50');
  const war = await set('mtg', 'war', 'War of the Spark', '2019-05-03', 264);
  await print(war, 'mtg', 'Finale of Promise', '97★');
  await print(war, 'mtg', 'Tamiyo, Collector of Tales', '123a');
  const mid = await set('mtg', 'mid', 'Innistrad: Midnight Hunt', '2021-09-24', 277);
  await print(mid, 'mtg', 'Midnight Reaper', '123');
  await print(mid, 'mtg', 'Adeline, Resplendent Cathar', '1');
  for (let i = 0; i < 10; i++) await print(mid, 'mtg', `Satyr Wayfinder ${i}`, `${200 + i}`);
}
