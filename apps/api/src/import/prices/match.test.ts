import { describe, expect, it } from 'vitest';
import {
  GROUP_ALIASES,
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

  // TCGCSV's real groups (2026-10-10) against TCGdex's sets (VB-111).
  const pokemon = (groupId: number, name: string, abbreviation: string | null): TcgGroup => ({
    groupId,
    name,
    abbreviation,
  });
  const tcgdex = (code: string, name: string, abbreviation: string | null, series: string) => ({
    ...set(code, name),
    abbreviation,
    series,
  });
  const sv = (code: string, name: string, abbreviation: string | null) =>
    tcgdex(code, name, abbreviation, 'Scarlet & Violet');

  it('matches Pokémon base sets and 151 by TCGdex’s abbreviation', () => {
    const sets = [
      sv('sv01', 'Scarlet & Violet', 'SVI'),
      sv('sv03.5', '151', 'MEW'),
      tcgdex('swsh1', 'Sword & Shield', 'SSH', 'Sword & Shield'),
    ];
    const groups = [
      pokemon(22873, 'SV01: Scarlet & Violet Base Set', 'SVI'),
      pokemon(23237, 'SV: Scarlet & Violet 151', 'MEW'),
      pokemon(2585, 'SWSH01: Sword & Shield Base Set', 'SSH'),
    ];
    expect(matchGroups(groups, sets)).toEqual([
      { groupId: 22873, setId: 'set-sv01' },
      { groupId: 23237, setId: 'set-sv03.5' },
      { groupId: 2585, setId: 'set-swsh1' },
    ]);
    // Without abbreviations: `Base Set` and the leading series name are not part of the name.
    const bare = sets.map((s) => ({ ...s, abbreviation: null }));
    expect(matchGroups(groups, bare)).toHaveLength(3);
  });

  it('takes no abbreviation that names another set or that two groups share', () => {
    const sets = [
      tcgdex('swsh5', 'Battle Styles', 'BST', 'Sword & Shield'),
      tcgdex('base5', 'Team Rocket', 'RO', 'Base'),
      tcgdex('ex7', 'Team Rocket Returns', 'TR', 'EX'),
      tcgdex('xy9', 'BREAKpoint', 'BKP', 'XY'),
    ];
    const groups = [
      pokemon(1853, 'EX Battle Stadium', 'BST'),
      pokemon(1373, 'Team Rocket', 'TR'),
      pokemon(2175, 'Burger King Promos', 'BKP'),
      pokemon(1701, 'XY - BREAKpoint', 'BKP'),
    ];
    expect(matchGroups(groups, sets)).toEqual([
      { groupId: 1373, setId: 'set-base5' },
      { groupId: 1701, setId: 'set-xy9' },
    ]);
  });

  it('matches the groups no rule finds through the alias list', () => {
    const sets = [
      sv('svp', 'SVP Black Star Promos', 'SVP'),
      set('swshp', 'SWSH Black Star Promos'),
    ];
    expect(
      matchGroups(
        [
          pokemon(22872, 'SV: Scarlet & Violet Promo Cards', 'SVP'),
          pokemon(2545, 'SWSH: Sword & Shield Promo Cards', 'SWSD'),
        ],
        sets,
      ),
    ).toEqual([
      { groupId: 22872, setId: 'set-svp' },
      { groupId: 2545, setId: 'set-swshp' },
    ]);
    expect(GROUP_ALIASES[2545]).toBe('swshp');
  });

  it('keeps a match by Scryfall’s group id whatever the abbreviation says', () => {
    const sets = [
      set('mid', 'Innistrad: Midnight Hunt', 2864),
      // The abbreviation and the name would take the group, were the group id not first.
      { ...set('mh', 'Midnight Hunt'), abbreviation: 'MID' },
      set('neo', 'Kamigawa: Neon Dynasty'),
    ];
    expect(matchGroups(groups(1), sets)).toEqual([
      { groupId: 2864, setId: 'set-mid' },
      { groupId: 2965, setId: 'set-neo' },
    ]);
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
