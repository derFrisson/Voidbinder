import { describe, expect, it } from 'vitest';
import {
  GROUP_ALIASES,
  matchGroups,
  matchProducts,
  normName,
  normNumber,
  rarityKey,
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

  it('matches Yu-Gi-Oh! groups by abbreviation, `LOB-EN` as `LOB` (VB-111)', () => {
    const sets = [set('lob', 'Legend of Blue Eyes White Dragon')];
    // TCGplayer: `LOB` (the North American prints), `LOB-EN` and its 25th Anniversary Edition.
    const lob = [
      { groupId: 330, name: 'The Legend of Blue Eyes White Dragon', abbreviation: 'LOB' },
      {
        groupId: 22881,
        name: 'Legend of Blue Eyes White Dragon (Worldwide English)',
        abbreviation: 'LOB-EN',
      },
      {
        groupId: 23050,
        name: 'Legend of Blue Eyes White Dragon (25th Anniversary Edition)',
        abbreviation: 'LOB-EN',
      },
    ];
    expect(matchGroups(lob, sets, { regional: true })).toEqual([
      { groupId: 330, setId: 'set-lob' },
      { groupId: 22881, setId: 'set-lob' },
      { groupId: 23050, setId: 'set-lob' },
    ]);
    // Pokémon and Magic keep the abbreviation whole.
    expect(matchGroups(lob, sets)).toEqual([{ groupId: 330, setId: 'set-lob' }]);
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

  it('strips a series name on a word boundary only, never down to `Base Set`', () => {
    const sets = [
      tcgdex('base1', 'Base Set', null, 'Base'),
      tcgdex('ex3', 'Dragon', null, 'EX'),
      tcgdex('pedition', 'Pedition', null, 'EX'),
    ];
    expect(
      matchGroups(
        [
          pokemon(1, 'EX Dragon', null),
          // `EX` is the start of the word, not a series before it.
          pokemon(2, 'Expedition', null),
          // `EX Base Set` would read `Base Set`, the first set of all.
          pokemon(3, 'EX Base Set', null),
        ],
        sets,
      ),
    ).toEqual([{ groupId: 1, setId: 'set-ex3' }]);
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

  it('leaves a Pokémon print out that two products of its number claim', () => {
    const p = (productId: number, name: string): TcgProduct => ({
      productId,
      name,
      extendedData: [
        { name: 'Number', value: '25/102' },
        { name: 'Rarity', value: 'Common' },
      ],
    });
    const pikachu = [print('pikachu', '25', 'Pikachu')];
    expect(matchProducts([p(1, 'Pikachu'), p(2, 'Raichu')], pikachu, { byId: false })).toEqual([]);
    // `(Full Art)` is no artwork suffix, not even for Yu-Gi-Oh!.
    const fullArt = [p(1, 'Pikachu'), p(2, 'Pikachu (Full Art)')];
    expect(matchProducts(fullArt, pikachu, { byId: false })).toEqual([]);
    expect(matchProducts(fullArt, pikachu, { byId: false, regional: true })).toEqual([]);
  });
});

describe('Yu-Gi-Oh! price mapping gaps (VB-113)', () => {
  // TCGCSV's MRD and LOB groups as of 2026-10-10 (test/fixtures/tcgcsv/2/, a few products each):
  // 255 / 330 the token-less North American prints, 22882 / 22881 `-EN` (Worldwide English),
  // 23052 / 23050 `-EN` again (25th Anniversary Edition).
  const ygo = (set: string, number: string, name: string, variant: string, artwork?: string) => ({
    ...print(`${set}-${number}-${variant}`, number, name, variant),
    setId: `set-${set}`,
    setCode: set,
    ...(artwork ? { artwork } : {}),
  });
  const regional = { byId: false, regional: true };
  const rows = (matches: ReturnType<typeof matchProducts>) =>
    matches
      .map((m) => [m.printId, m.productId, m.method, m.confidence] as const)
      .sort((a, b) => a[0].localeCompare(b[0]));

  it('compares rarities through one alias table, both sides normalized', () => {
    expect(rarityKey('Short Print')).toBe('common');
    expect(rarityKey('super-short-print')).toBe(rarityKey('Common'));
    expect(rarityKey('Ultimate Rare')).toBe(rarityKey('Prismatic Ultimate Rare'));
    expect(rarityKey("Collector's Rare")).toBe(rarityKey('Prismatic Collector’s Rare'));
    expect(rarityKey("Ultra Rare (Pharaoh's Rare)")).toBe(rarityKey('Ultra Pharaoh’s Rare'));
    expect(rarityKey('Duel Terminal Normal Parallel Rare')).toBe(
      rarityKey('Duel Terminal Technology Common'),
    );
    expect(rarityKey('PLatinum Secret Rare')).toBe(rarityKey('Platinum Secret Rare'));
    // Distinct rarities stay apart.
    expect(rarityKey('Rare')).not.toBe(rarityKey('Common'));
    expect(rarityKey('Duel Terminal Normal Parallel Rare')).not.toBe(rarityKey('Common'));
  });

  it('prices `Short Print` and `Super Short Print` prints with TCGplayer’s `Common`', () => {
    const prints = [
      ygo('mrd', '011', 'Cocoon of Evolution', 'super-short-print'),
      ygo('mrd', 'E011', 'Cocoon of Evolution', 'super-short-print'),
      ygo('mrd', 'EN011', 'Cocoon of Evolution', 'common'),
      ygo('mrd', 'EN011', 'Cocoon of Evolution', 'short-print'),
      ygo('mrd', 'EN011', 'Cocoon of Evolution', 'super-short-print'),
    ];
    const cocoon = [...products('2/255'), ...products('2/22882')].filter(
      (p) => p.name === 'Cocoon of Evolution',
    );
    expect(rows(matchProducts(cocoon, prints, regional))).toEqual([
      ['mrd-011-super-short-print', 21835, 'number_match', 70],
      ['mrd-E011-super-short-print', 476271, 'region_match', 60],
      ['mrd-EN011-common', 476271, 'number_match', 70],
      ['mrd-EN011-short-print', 476271, 'number_match', 70],
      ['mrd-EN011-super-short-print', 476271, 'number_match', 70],
    ]);
  });

  it('maps the original of two artwork products, the other one for a print with an alt code', () => {
    const harpie = products('2/255').filter((p) => p.name.startsWith('Harpie Lady'));
    expect(harpie.map((p) => p.name)).toEqual([
      'Harpie Lady (Original Artwork)',
      'Harpie Lady (New Artwork)',
    ]);
    const matches = matchProducts(harpie, [ygo('mrd', '008', 'Harpie Lady', 'common')], regional);
    expect(matches).toEqual([
      {
        productId: 22062,
        printId: 'mrd-008-common',
        method: 'number_match',
        confidence: 65,
        artwork: true,
      },
    ]);
    // Yugipedia names the print's artwork (VB-106): the other product.
    const alt = ygo('mrd', '008', 'Harpie Lady', 'common', 'AA');
    expect(rows(matchProducts(harpie, [alt], regional))).toEqual([
      ['mrd-008-common', 173924, 'number_match', 65],
    ]);
  });

  it('reads only alternate-art codes as another artwork, and picks none of two others', () => {
    const harpie = products('2/255').filter((p) => p.name.startsWith('Harpie Lady'));
    // `B` (a further scan) and `L` (a deck letter) are the print's own artwork: the original.
    for (const code of ['B', 'L'])
      expect(
        rows(matchProducts(harpie, [ygo('mrd', '008', 'Harpie Lady', 'common', code)], regional)),
      ).toEqual([['mrd-008-common', 22062, 'number_match', 65]]);
    const alternate = { ...(harpie[0] as TcgProduct), productId: 1 };
    const three = [...harpie, { ...alternate, name: 'Harpie Lady (Alternate Art)' }];
    const aa = ygo('mrd', '008', 'Harpie Lady', 'common', 'AA');
    expect(matchProducts(three, [aa], regional)).toEqual([]);
    expect(
      rows(matchProducts(three, [ygo('mrd', '008', 'Harpie Lady', 'common')], regional)),
    ).toEqual([['mrd-008-common', 22062, 'number_match', 65]]);
  });

  it('takes the product with the print’s name over a misprint of the same number', () => {
    // TCGplayer lists LOB-012 twice: Trial of Nightmare and its misprint Trial of Hell.
    const trial = products('2/330-vb113').filter((p) => p.name.startsWith('Trial of'));
    expect(
      rows(matchProducts(trial, [ygo('lob', '012', 'Trial of Nightmare', 'common')], regional)),
    ).toEqual([['lob-012-common', 22539, 'number_match', 70]]);
  });

  it('prices a regional print TCGplayer names otherwise through its card’s EN print', () => {
    // `B. Skull Dragon` and `Red-Eyes B. Dragon`: the original names; the catalog has the new.
    const prints = [
      ygo('mrd', '018', 'Black Skull Dragon', 'ultra-rare'),
      ygo('mrd', 'E018', 'Black Skull Dragon', 'ultra-rare'),
      ygo('mrd', 'EN018', 'Black Skull Dragon', 'ultra-rare'),
    ];
    const skull = [...products('2/255'), ...products('2/22882')].filter((p) =>
      p.name.includes('Skull'),
    );
    expect(rows(matchProducts(skull, prints, regional))).toEqual([
      ['mrd-018-ultra-rare', 21762, 'number_match', 70],
      ['mrd-E018-ultra-rare', 476288, 'region_match', 60],
      ['mrd-EN018-ultra-rare', 476288, 'number_match', 70],
    ]);
    const lob = [
      ygo('lob', '070', 'Red-Eyes Black Dragon', 'ultra-rare'),
      ygo('lob', 'E056', 'Red-Eyes Black Dragon', 'ultra-rare'),
      ygo('lob', 'EN070', 'Red-Eyes Black Dragon', 'ultra-rare'),
    ];
    const redEyes = [...products('2/330-vb113'), ...products('2/22881')].filter((p) =>
      p.name.startsWith('Red-Eyes'),
    );
    expect(rows(matchProducts(redEyes, lob, regional))).toEqual([
      ['lob-070-ultra-rare', 22341, 'number_match', 70],
      ['lob-E056-ultra-rare', 476395, 'region_match', 60],
      ['lob-EN070-ultra-rare', 476395, 'number_match', 70],
    ]);
  });

  it('matches a product to the prints of the set its number names', () => {
    // LC03's group holds LC03-EN001 (the box promo) and the mega pack's LCYW-EN001.
    const product = (productId: number, number: string, name: string): TcgProduct => ({
      productId,
      name,
      extendedData: [
        { name: 'Number', value: number },
        { name: 'Rarity', value: 'Ultra Rare' },
      ],
    });
    const lc03 = [
      product(1, 'LC03-EN001', 'The Seal of Orichalcos'),
      product(2, 'LCYW-EN001', 'Dark Magician'),
    ];
    const prints = [
      ygo('lc03', 'EN001', 'The Seal of Orichalcos', 'ultra-rare'),
      ygo('lcyw', 'EN001', 'Dark Magician', 'ultra-rare'),
    ];
    expect(rows(matchProducts(lc03, prints, regional))).toEqual([
      ['lc03-EN001-ultra-rare', 1, 'number_match', 70],
      ['lcyw-EN001-ultra-rare', 2, 'number_match', 70],
    ]);
  });

  it('name-matches a product without a set-naming number among its own set’s prints only', () => {
    const prints = [
      ygo('lc03', 'EN002', 'Dark Magician', 'ultra-rare'),
      ygo('lcyw', 'EN001', 'Dark Magician', 'ultra-rare'),
    ];
    const product: TcgProduct = {
      productId: 3,
      name: 'Dark Magician',
      extendedData: [{ name: 'Rarity', value: 'Ultra Rare' }],
    };
    expect(rows(matchProducts([product], prints, { ...regional, setId: 'set-lc03' }))).toEqual([
      ['lc03-EN002-ultra-rare', 3, 'name_match', 40],
    ]);
  });

  it('matches special editions, decks and Shonen Jump promos to their set (VB-113)', () => {
    const sets = [
      set('lob', 'Legend of Blue Eyes White Dragon'),
      set('mrd', 'Metal Raiders'),
      set('lc03', "Legendary Collection 3: Yugi's World"),
      set('jump', 'Shonen Jump May 2006 subscription bonus'),
      set('ys15', '2-Player Starter Deck: Yuya & Declan'),
      set('mvp1', 'Yu-Gi-Oh! The Dark Side of Dimensions Movie Pack'),
      set('lart', 'The Lost Art Promotion A'),
    ];
    const code = new Map(sets.map((s) => [s.id, s.code]));
    expect(
      matchGroups(results<TcgGroup>(tcgcsvFixture('2/groups-vb113.json'), 'groups'), sets, {
        regional: true,
      }).map((m) => [m.groupId, code.get(m.setId)]),
    ).toEqual([
      [330, 'lob'],
      [22881, 'lob'],
      [23050, 'lob'],
      [255, 'mrd'],
      [22882, 'mrd'],
      [23052, 'mrd'],
      [584, 'lc03'],
      [281, 'jump'],
      [1544, 'ys15'],
      [1545, 'ys15'],
      [1877, 'mvp1'],
      [2577, 'mvp1'],
      [2322, 'mvp1'],
      [1820, 'mvp1'],
      [2196, 'lart'],
    ]);
  });
});
