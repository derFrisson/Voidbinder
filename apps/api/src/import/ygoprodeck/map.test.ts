import { describe, expect, it } from 'vitest';
import { mapCard, mapLocalization, mapPrints, mapSets, parseSetCode } from './map';
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

  it('merges the rarities of one code into its print', () => {
    const [, bp02] = mapPrints(card('Pot of Greed'));
    expect(bp02?.print).toMatchObject({
      number: 'EN129',
      rarity: 'Mosaic Rare',
      finishes: ['normal'],
      externalIds: { rarities: ['Mosaic Rare', 'Rare'] },
    });
  });

  it('folds a language variant into the English print of the same number', () => {
    const lob = mapPrints(card('Blue-Eyes White Dragon')).find((p) => p.setCode === 'LOB');
    expect(lob?.print).toMatchObject({
      number: 'EN001',
      externalIds: { set_code: 'LOB-EN001', variants: ['LOB-DE001'] },
    });
    expect(mapPrints(card('ABC-Dragon Buster'))).toHaveLength(1);
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
    expect(rows).toHaveLength(new Set(sets.map((s) => s.set_code)).size);
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
