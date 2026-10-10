import { describe, expect, it } from 'vitest';
import {
  matchGroups,
  matchProducts,
  normName,
  normNumber,
  type CandidatePrint,
  type CatalogSet,
} from './match';
import { results, type TcgGroup, type TcgProduct } from './tcgcsv';
import { tcgcsvFixture } from './test-fixtures';

const groups = (category: number) =>
  results<TcgGroup>(tcgcsvFixture(`${category}/groups.json`), 'groups');
const products = (path: string) =>
  results<TcgProduct>(tcgcsvFixture(`${path}/products.json`), 'products');
const set = (code: string, name: string, group: number | null = null): CatalogSet => ({
  id: `set-${code}`,
  code,
  name,
  tcgplayerGroupId: group,
});
const print = (id: string, number: string, name: string, variant = ''): CandidatePrint => ({
  id,
  number,
  variant,
  name,
  tcgplayer: null,
  tcgplayerEtched: null,
});

describe('normNumber / normName', () => {
  it('compares collector numbers across TCGplayer and the catalog sources', () => {
    expect(normNumber('001/102')).toBe(normNumber('1'));
    expect(normNumber('LOB-001')).toBe(normNumber('EN001'));
    expect(normNumber('LOB-EN027')).toBe('27');
    expect(normNumber('SWSH001')).toBe('swsh1');
    expect(normNumber('TG05/TG30')).toBe('tg5');
  });

  it('ignores case, accents, punctuation and `&`', () => {
    expect(normName('Pokémon Trainer & Ally!')).toBe(normName('pokemon trainer and ally'));
  });
});

describe('matchGroups', () => {
  it('matches Magic groups by Scryfall’s group id, then by abbreviation', () => {
    const sets = [set('mid', 'Innistrad: Midnight Hunt', 2864), set('neo', 'Neon', null)];
    expect(matchGroups(groups(1), sets)).toEqual([
      { groupId: 2864, setId: 'set-mid' },
      { groupId: 2965, setId: 'set-neo' },
    ]);
  });

  it('matches Yu-Gi-Oh! groups by abbreviation, not the anniversary edition', () => {
    const sets = [set('lob', 'Legend of Blue Eyes White Dragon')];
    expect(matchGroups(groups(2), sets)).toEqual([{ groupId: 330, setId: 'set-lob' }]);
  });

  it('matches Pokémon groups by name without the series prefix', () => {
    const sets = [set('base1', 'Base Set'), set('swsh3', 'Darkness Ablaze')];
    expect(matchGroups(groups(3), sets)).toEqual([
      { groupId: 604, setId: 'set-base1' },
      { groupId: 2675, setId: 'set-swsh3' },
    ]);
  });
});

describe('matchProducts', () => {
  it('maps Magic products by Scryfall’s TCGplayer ids, etched ones to the etched finish', () => {
    const prints: CandidatePrint[] = [
      { ...print('adeline', '1', 'Adeline, Resplendent Cathar'), tcgplayer: '248137' },
      { ...print('champion', '385', 'Champion'), tcgplayer: '1', tcgplayerEtched: '249991' },
      // Same number as a product, but Magic never matches by number.
      print('other', '999', 'Mystery Card'),
    ];
    expect(matchProducts(products('1/2864'), prints, { byId: true })).toEqual([
      { productId: 248137, printId: 'adeline', method: 'scryfall_id', confidence: 100 },
      {
        productId: 249991,
        printId: 'champion',
        finish: 'etched',
        method: 'scryfall_id',
        confidence: 100,
      },
    ]);
  });

  it('drops a TCGplayer id that Scryfall gives two prints, like a tie', () => {
    const prints: CandidatePrint[] = [
      { ...print('adeline', '1', 'Adeline, Resplendent Cathar'), tcgplayer: '248137' },
      { ...print('adeline-promo', '1p', 'Adeline, Resplendent Cathar'), tcgplayer: '248137' },
      { ...print('champion', '385', 'Champion'), tcgplayerEtched: '249991' },
    ];
    expect(matchProducts(products('1/2864'), prints, { byId: true })).toEqual([
      {
        productId: 249991,
        printId: 'champion',
        finish: 'etched',
        method: 'scryfall_id',
        confidence: 100,
      },
    ]);
  });

  it('maps Yu-Gi-Oh! products by number and rarity', () => {
    const prints = [
      print('bewd-ur', 'EN001', 'Blue-Eyes White Dragon', 'ultra-rare'),
      print('bewd-scr', 'EN001', 'Blue-Eyes White Dragon', 'secret-rare'),
      print('madoor', 'EN027', 'Aqua Madoor', 'rare'),
    ];
    const matches = matchProducts(products('2/330'), prints, { byId: false });
    expect(matches.map((m) => [m.productId, m.printId, m.confidence])).toEqual([
      [21800, 'bewd-ur', 70],
      [21801, 'bewd-scr', 70],
      [21747, 'madoor', 70],
    ]);
  });

  it('maps by number (70), else a unique name (40), and leaves ambiguous ones out', () => {
    const prints = [
      print('alakazam', '1', 'Alakazam'),
      print('pikachu', '58', 'Pikachu'),
      print('energy-removal', '92', 'Energy Removal'),
      // Two prints named Potion: a product without a number cannot tell them apart.
      print('potion', '94', 'Potion'),
      print('potion-promo', 'P1', 'Potion'),
    ];
    const matches = matchProducts(products('3/604'), prints, { byId: false });
    expect(matches).toEqual([
      { productId: 42346, printId: 'alakazam', method: 'number_match', confidence: 70 },
      { productId: 42500, printId: 'energy-removal', method: 'name_match', confidence: 40 },
    ]);
  });

  describe('Yu-Gi-Oh! regional prints (VB-110)', () => {
    const product = (
      productId: number,
      number: string,
      rarity: string,
      name = 'Blue-Eyes White Dragon',
    ): TcgProduct => ({
      productId,
      name,
      extendedData: [
        { name: 'Number', value: number },
        { name: 'Rarity', value: rarity },
      ],
    });
    const bewd = (id: string, number: string, variant = 'ultra-rare') =>
      print(id, number, 'Blue-Eyes White Dragon', variant);
    const lob = [bewd('na', '001'), bewd('eu', 'E001'), bewd('en', 'EN001')];
    const regional = { byId: false, regional: true };
    const rows = (matches: ReturnType<typeof matchProducts>) =>
      matches.map((m) => [m.productId, m.printId, m.method, m.confidence]);

    it('prices the token-less and `E` prints with the EN product, less confidently', () => {
      expect(rows(matchProducts([product(1, 'LOB-EN001', 'Ultra Rare')], lob, regional))).toEqual([
        [1, 'en', 'number_match', 70],
        [1, 'na', 'region_match', 60],
        [1, 'eu', 'region_match', 60],
      ]);
    });

    it('takes an exact regional product over the EN one', () => {
      const products = [
        product(1, 'LOB-EN001', 'Ultra Rare'),
        product(2, 'LOB-E001', 'Ultra Rare'),
      ];
      expect(rows(matchProducts(products, lob, regional))).toEqual([
        [1, 'en', 'number_match', 70],
        [2, 'eu', 'number_match', 70],
        [1, 'na', 'region_match', 60],
      ]);
    });

    it('goes by name, not digits: European numbers differ from the EN ones', () => {
      // LOB-E053 is Curse of Dragon (LOB-EN066); LOB-EN053 is Raigeki, also a Super Rare.
      const prints = [print('curse-eu', 'E053', 'Curse of Dragon', 'super-rare')];
      const products = [
        product(1, 'LOB-EN053', 'Super Rare', 'Raigeki'),
        product(2, 'LOB-EN066', 'Super Rare', 'Curse of Dragon'),
      ];
      expect(rows(matchProducts(products, prints, regional))).toEqual([
        [2, 'curse-eu', 'region_match', 60],
      ]);
    });

    it('keeps the rarity apart: a Starlight and an Ultra of one number', () => {
      const prints = [
        bewd('en-ur', 'EN001'),
        bewd('en-slr', 'EN001', 'starlight-rare'),
        bewd('na', '001'),
      ];
      const products = [
        product(1, 'LOB-EN001', 'Ultra Rare'),
        product(2, 'LOB-EN001', 'Starlight Rare'),
      ];
      expect(rows(matchProducts(products, prints, regional))).toEqual([
        [1, 'en-ur', 'number_match', 70],
        [2, 'en-slr', 'number_match', 70],
        [1, 'na', 'region_match', 60],
      ]);
    });

    it('leaves a regional print out when two products of its rarity fit', () => {
      const products = [
        product(1, 'LOB-EN001', 'Ultra Rare'),
        product(2, 'LOB-EN001', 'Ultra Rare'),
      ];
      expect(matchProducts(products, [bewd('na', '001')], regional)).toEqual([]);
    });

    it('does nothing of the sort without `regional` (Pokémon, Magic)', () => {
      expect(
        rows(matchProducts([product(1, 'LOB-EN001', 'Ultra Rare')], lob, { byId: false })),
      ).toEqual([[1, 'en', 'number_match', 70]]);
    });
  });

  it('prefers the more confident of two products that claim one print', () => {
    const p = (productId: number, ext: [string, string][]): TcgProduct => ({
      productId,
      name: 'Pikachu',
      extendedData: ext.map(([name, value]) => ({ name, value })),
    });
    const matches = matchProducts(
      [p(1, [['Number', '58/102']]), p(2, [['Rarity', 'Common']])],
      [print('pikachu', '58', 'Pikachu')],
      { byId: false },
    );
    expect(matches.map((m) => [m.productId, m.method])).toEqual([[1, 'number_match']]);
  });
});
