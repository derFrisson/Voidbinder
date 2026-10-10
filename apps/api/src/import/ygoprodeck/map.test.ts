import { describe, expect, it } from 'vitest';
import {
  mapCard,
  mapLocalization,
  mapPrints,
  mapSets,
  parseSetCode,
  raritySlug,
  ruleCode,
  setKey,
} from './map';
import { fixture } from './test-fixtures';
import type { YgoCard, YgoSet } from './types';

const cards = (JSON.parse(fixture('cardinfo_en.json')) as { data: YgoCard[] }).data;
const sets = JSON.parse(fixture('cardsets.json')) as YgoSet[];
const card = (name: string) => {
  const c = cards.find((x) => x.name === name);
  if (!c) throw new Error(`fixture ${name} missing`);
  return c;
};

describe('parseSetCode', () => {
  it.each([
    ['LOB-EN005', { setCode: 'LOB', number: 'EN005', language: null, englishNumber: null }],
    ['LOB-DE005', { setCode: 'LOB', number: 'DE005', language: 'de', englishNumber: 'EN005' }],
    ['OP13-PT006', { setCode: 'OP13', number: 'PT006', language: 'pt', englishNumber: 'EN006' }],
    // EN plus a letter: the region is the first two letters only.
    ['SGX3-ENE10', { setCode: 'SGX3', number: 'ENE10', language: null, englishNumber: null }],
    ['SD1-ENDE1', { setCode: 'SD1', number: 'ENDE1', language: null, englishNumber: null }],
    // Old codes without a region, and a code without a dash.
    ['DOR-001', { setCode: 'DOR', number: '001', language: null, englishNumber: null }],
    ['PSV-E088', { setCode: 'PSV', number: 'E088', language: null, englishNumber: null }],
    ['DB49', { setCode: 'DB49', number: 'DB49', language: null, englishNumber: null }],
  ])('%s', (code, expected) => expect(parseSetCode(code)).toEqual(expected));
});

describe('YGOPRODeck card mapping', () => {
  it('maps a monster: stats, attribute, race, archetype and TCG/OCG legality', () => {
    expect(mapCard(card('Blue-Eyes White Dragon'))).toMatchObject({
      oracleKey: '89631139',
      name: 'Blue-Eyes White Dragon',
      typeLine: 'Normal Monster',
      attributes: {
        atk: 3000,
        def: 2500,
        level: 8,
        attribute: 'LIGHT',
        race: 'Dragon',
        archetype: 'Blue-Eyes',
        frameType: 'normal',
      },
      legalities: { tcg: 'Unlimited', ocg: 'Unlimited' },
    });
  });

  it('maps a spell without monster fields and with its ban list status per format', () => {
    const mapped = mapCard(card('Pot of Greed'));
    expect(mapped.text).toBe('Draw 2 cards.');
    expect(mapped.attributes).toEqual({
      race: 'Normal',
      archetype: 'Greed',
      frameType: 'spell',
    });
    expect(mapped.legalities).toEqual({ tcg: 'Forbidden', ocg: 'Forbidden', goat: 'Limited' });
    expect(mapCard(card('Ash Blossom & Joyous Spring')).legalities).toEqual({
      tcg: 'Unlimited',
      ocg: 'Semi-Limited',
    });
  });

  it('keeps the scale of a pendulum monster next to its level', () => {
    expect(mapCard(card('Abyss Actor - Comic Relief')).attributes).toMatchObject({
      level: 3,
      scale: 8,
      frameType: 'effect_pendulum',
    });
  });

  it('maps a link monster: link value and markers, no level, DEF or null', () => {
    const { attributes } = mapCard(card('A Bao A Qu, the Lightless Shadow'));
    expect(attributes).toMatchObject({
      atk: 2800,
      linkval: 4,
      linkmarkers: ['Left', 'Right', 'Bottom-Left', 'Bottom-Right'],
    });
    expect(attributes).not.toHaveProperty('def');
    expect(attributes).not.toHaveProperty('level');
  });

  it('gives an Xyz monster a rank, and a `?` ATK as `?`', () => {
    expect(mapCard(card('Tornado Dragon')).attributes).toMatchObject({ rank: 4 });
    expect(mapCard(card('Tornado Dragon')).attributes).not.toHaveProperty('level');
    expect(mapCard(card('Aegaion the Sea Castrum')).attributes).toMatchObject({
      atk: '?',
      def: 3000,
      rank: 8,
    });
  });

  it('names the language of a localization and keeps the text', () => {
    const c = card('Dark Magician');
    expect(mapLocalization(c, 'de')).toEqual({
      lang: 'de',
      name: 'Dark Magician',
      text: c.desc,
      externalIds: {},
    });
    // VB-94: with the print's English code, its code in that language by rule.
    expect(mapLocalization(c, 'es', 'LOB-EN005').externalIds).toEqual({
      set_code: 'LOB-SP005',
      set_code_source: 'rule',
    });
    expect(mapLocalization(c, 'en', 'LOB-EN005').externalIds).toEqual({});
  });
});

describe('localized codes by rule (VB-94)', () => {
  it.each([
    ['BLGG-EN024', 'de', 'BLGG-DE024'],
    ['BLGG-EN024', 'fr', 'BLGG-FR024'],
    ['BLGG-EN024', 'it', 'BLGG-IT024'],
    ['BLGG-EN024', 'es', 'BLGG-SP024'],
    ['BLGG-EN024', 'pt', 'BLGG-PT024'],
    ['RA05-ENA26', 'de', 'RA05-DEA26'],
    ['YS15-ENF27', 'fr', 'YS15-FRF27'],
    // A token-less number gets the token inserted.
    ['LON-065', 'de', 'LON-DE065'],
    ['LON-065', 'es', 'LON-SP065'],
    ['AST-081', 'pt', 'AST-PT081'],
  ])('%s in %s is %s', (code, lang, localized) => expect(ruleCode(code, lang)).toBe(localized));

  it('has none for English, Japanese, other numbers and codes without a number', () => {
    expect(ruleCode('BLGG-EN024', 'en')).toBeNull();
    expect(ruleCode('BLGG-EN024', 'ja')).toBeNull();
    expect(ruleCode('LON-E006', 'de')).toBeNull();
    expect(ruleCode('LOB-DE001', 'fr')).toBeNull();
    expect(ruleCode('DB49', 'de')).toBeNull();
    expect(ruleCode(null, 'de')).toBeNull();
  });
});

describe('YGOPRODeck print mapping', () => {
  it('maps a card in several sets to one print per set and number', () => {
    const prints = mapPrints(card('Backup Soldier'));
    expect(prints.map((p) => [p.setCode, p.print.number])).toEqual([
      ['DB1', 'EN082'],
      ['DB49', 'DB49'],
      ['LDK2', 'ENY39'],
    ]);
    expect(prints[0]?.print).toMatchObject({
      rarity: 'Common',
      finishes: ['normal'],
      externalIds: {
        ygoprodeck: 36280194,
        set_code: 'DB1-EN082',
        image_url: 'https://images.ygoprodeck.com/images/cards/36280194.jpg',
        image_url_small: 'https://images.ygoprodeck.com/images/cards_small/36280194.jpg',
      },
    });
  });

  it('maps each rarity of a code to a print of its own, the rarity slug as its variant', () => {
    const bp02 = mapPrints(card('Pot of Greed')).filter((p) => p.setCode === 'BP02');
    expect(bp02.map((p) => [p.print.number, p.print.variant, p.print.rarity])).toEqual([
      ['EN129', 'mosaic-rare', 'Mosaic Rare'],
      ['EN129', 'rare', 'Rare'],
    ]);
    expect(bp02[0]?.print).toMatchObject({
      finishes: ['normal'],
      externalIds: { set_code: 'BP02-EN129' },
    });
    expect(mapPrints(card('A Bao A Qu, the Lightless Shadow')).map((p) => p.print.variant)).toEqual(
      ['secret-rare', 'starlight-rare', 'ultra-rare'],
    );
  });

  it.each([
    ['Secret Rare', 'secret-rare'],
    ['Quarter Century Secret Rare', 'quarter-century-secret-rare'],
    ["Collector's Rare", 'collectors-rare'],
    ['Duel Terminal Normal Parallel Rare', 'duel-terminal-normal-parallel-rare'],
    ['', ''],
  ])('slugs the rarity %j as %j', (rarity, slug) => expect(raritySlug(rarity)).toBe(slug));

  it('keeps one print for a code and rarity listed twice, in any case', () => {
    // LOB-EN001 again in the 25th Anniversary Edition; CT13-EN003 once more as `ct13-EN003`.
    const lob = mapPrints(card('Blue-Eyes White Dragon')).filter((p) => p.setCode === 'LOB');
    expect(lob).toHaveLength(1);
    const ct13 = mapPrints(card('Dark Magician')).filter((p) => setKey(p.setCode) === 'ct13');
    expect(ct13.map((p) => [p.setCode, p.print.externalIds.set_code])).toEqual([
      ['CT13', 'CT13-EN003'],
    ]);
  });

  it('folds a language variant into the English print of the same number', () => {
    const lob = mapPrints(card('Blue-Eyes White Dragon')).find((p) => p.setCode === 'LOB');
    expect(lob?.print).toMatchObject({
      number: 'EN001',
      externalIds: { set_code: 'LOB-EN001', variants: ['LOB-DE001'] },
    });
    expect(mapPrints(card('ABC-Dragon Buster'))).toHaveLength(1);
  });

  it('counts the artworks of a card that has several (VB-106)', () => {
    const lob = mapPrints(card('Blue-Eyes White Dragon')).find((p) => p.setCode === 'LOB');
    expect(lob?.print.externalIds.artworks).toBe(2);
    expect(mapPrints(card('Raigeki'))[0]?.print.externalIds).not.toHaveProperty('artworks');
  });

  it('keeps a variant without an English print as a print of its own', () => {
    const own = mapPrints(card('Raigeki')).find((p) => p.setCode === 'LOB');
    expect(own?.print).toMatchObject({
      number: 'DE099',
      externalIds: { set_code: 'LOB-DE099', language: 'de' },
    });
    expect(own?.print.externalIds).not.toHaveProperty('variants');
  });

  it('maps a card in no set to no prints', () => {
    expect(mapPrints(card('Absolute King - Megaplunder'))).toEqual([]);
  });
});

describe('YGOPRODeck set mapping', () => {
  it('maps one row per set code with the earliest edition as the set', () => {
    const rows = mapSets(sets);
    // `LOB` and `lob` are one set.
    expect(rows).toHaveLength(new Set(sets.map((s) => setKey(s.set_code))).size);
    // Lowercase like every set code of the catalog; the printed code is in external_ids.
    expect(rows.find((r) => r.code === 'lob')).toEqual({
      code: 'lob',
      name: 'Legend of Blue Eyes White Dragon',
      releasedOn: '2002-03-08',
      cardCount: 355,
      kind: null,
      externalIds: {
        set_code: 'LOB',
        set_image: 'https://images.ygoprodeck.com/images/sets/LOB.jpg',
        editions: [
          {
            name: 'Legend of Blue Eyes White Dragon (25th Anniversary Edition)',
            date: '2023-04-20',
            cards: 14,
          },
        ],
      },
    });
    // No release date: null, not an invented one.
    expect(rows.find((r) => r.code === 'crc1')).toMatchObject({ releasedOn: null, cardCount: 1 });
  });
});
