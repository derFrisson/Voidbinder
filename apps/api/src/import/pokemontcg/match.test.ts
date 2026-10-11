import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { matchCards, matchSets, normName, normNumber, type OurPrint, type OurSet } from './match';
import type { PtcgCard, PtcgSet } from './source';

// Recorded files of pokemontcg.io's data repository (test/fixtures/pokemontcg/, 2026-10-10) and our Pokémon sets
// with prints without a picture as TCGdex describes them (id, name, release day, codes).

const fixture = <T>(name: string) =>
  JSON.parse(
    readFileSync(
      new URL(`../../../test/fixtures/pokemontcg/${name}`, import.meta.url).pathname,
      'utf8',
    ),
  ) as T[];
export const PTCG_SETS = fixture<PtcgSet>('sets.json');
export const ptcgCards = (set: string) => fixture<PtcgCard>(`cards-${set}.json`);

/** Every TCGdex set that had prints without a picture on 2026-10-10, plus Shining Fates itself. */
export const OUR_SETS: OurSet[] = (
  [
    ['2011bw', "McDonald's Collection 2011", '2011-06-17', ['MCD11']],
    ['2012bw', "McDonald's Collection 2012", '2012-06-15', ['MCD12']],
    ['2014xy', "McDonald's Collection 2014", '2014-05-23', ['MCD14']],
    ['2015xy', "McDonald's Collection 2015", '2015-11-27', ['MCD15']],
    ['2016xy', "McDonald's Collection 2016", '2016-08-20', ['MCD16']],
    ['2017sm', "McDonald's Collection 2017", '2017-08-03', ['MCD17']],
    ['2018sm', "McDonald's Collection 2018", '2018-10-19', ['MCD18']],
    ['2019sm', "McDonald's Collection 2019", '2019-10-15', ['MCD19']],
    ['2021swsh', "McDonald's Collection 2021", '2021-02-09', ['MCD21']],
    ['2022swsh', "McDonald's Collection 2022", '2022-08-03', ['MCD22']],
    ['2023sv', "McDonald's Collection 2023", '2023-08-01', ['MCD23']],
    ['2024sv', "McDonald's Collection 2024", '2024-12-04', ['MCD24']],
    ['30th-c', '30th Classic Collection', '2026-09-16', ['30C']],
    ['30th', '30th Celebration', '2026-09-16', ['30C']],
    ['bog', 'Best of game', '2002-12-01', []],
    ['bwp', 'BW Black Star Promos', '2011-04-26', ['BWP', 'PR-BLW']],
    ['cel25', 'Celebrations', '2021-10-08', ['CEL']],
    ['cel25cc', 'Celebrations Classic Collection', '2021-10-08', ['CEL:CC', 'CEL']],
    ['dc1', 'Double Crisis', '2015-03-25', ['DCR']],
    ['ecard2', 'Aquapolis', '2003-01-15', ['AQ']],
    ['ecard3', 'Skyridge', '2003-05-12', ['SK']],
    ['ex14', 'Crystal Guardians', '2006-08-30', ['CG']],
    ['ex5.5', 'Poké Card Creator Pack', '2004-07-01', []],
    ['exu', 'Unseen Forces Unown Collection', '2005-08-22', []],
    ['hgssp', 'HGSS Black Star Promos', '2010-02-11', ['PR-HS']],
    ['mee', 'Mega Evolution Energy', '2025-09-25', ['MEE']],
    ['mep', 'MEP Black Star Promos', '2025-09-26', ['MEP']],
    ['mfb', 'My First Battle', '2023-09-29', ['MFB']],
    ['miscp', 'Miscellaneous Promos', '1996-01-01', []],
    ['pl2', 'Rising Rivals', '2009-05-16', ['RR']],
    ['pop6', 'POP Series 6', '2007-09-01', ['P6']],
    ['sm2', 'Guardians Rising', '2017-05-05', ['GRI']],
    ['sm3.5', 'Shining Legends', '2017-10-06', ['SLG']],
    ['sm6', 'Forbidden Light', '2018-05-04', ['FLI']],
    ['sm7.5', 'Dragon Majesty', '2018-09-07', ['DRM']],
    ['smp', 'SM Black Star Promos', '2017-02-03', ['SMP', 'PR-SM']],
    ['sv03.5', '151', '2023-09-22', ['MEW']],
    ['sve', 'Scarlet & Violet Energy', '2023-03-31', ['SVE']],
    ['svp', 'SVP Black Star Promos', '2023-03-31', ['SVP']],
    ['swsh10tg', 'Astral Radiance Trainer Gallery', '2022-05-27', ['ASR:TG', 'ASR']],
    ['swsh11tg', 'Lost Origin Trainer Gallery', '2022-09-09', ['LOR:TG', 'LOR']],
    ['swsh12.5gg', 'Crown Zenith Galarian Gallery', '2023-01-20', ['CRZ:GG', 'CRZ']],
    ['swsh12tg', 'Silver Tempest Trainer Gallery', '2022-11-11', ['SIT:TG', 'SIT']],
    ['swsh4.5sv', 'Shining Fates Shiny Vault', '2021-02-19', ['SHF:SV', 'SHF']],
    ['swsh9tg', 'Brilliant Stars Trainer Gallery', '2022-02-25', ['BRS:TG', 'BRS']],
    ['swshp', 'SWSH Black Star Promos', '2019-11-15', []],
    ['tk-bw-e', 'BW trainer Kit (Excadrill)', '2011-09-01', ['TK5E']],
    ['tk-bw-z', 'BW trainer Kit (Zoroark)', '2011-09-01', ['TK5Z']],
    ['tk-dp-l', 'DP trainer Kit (Lucario)', '2007-09-01', ['TK3L']],
    ['tk-dp-m', 'DP trainer Kit (Manaphy)', '2007-09-01', ['TK3M']],
    ['tk-ex-latia', 'EX trainer Kit (Latias)', '2004-07-01', ['TK1A']],
    ['tk-ex-latio', 'EX trainer Kit (Latios)', '2004-07-01', ['TK1O']],
    ['tk-ex-m', 'EX trainer Kit 2 (Minun)', '2006-03-01', ['TK2M']],
    ['tk-ex-p', 'EX trainer Kit 2 (Plusle)', '2006-03-01', ['TK2P']],
    ['tk-hs-g', 'HS trainer Kit (Gyarados)', '2010-05-01', ['TK4G']],
    ['tk-hs-r', 'HS trainer Kit (Raichu)', '2010-05-01', ['TK4R']],
    ['tk-sm-l', 'SM trainer Kit (Lycanroc)', '2017-04-21', ['TK10L']],
    ['tk-sm-r', 'SM trainer Kit (Alolan Raichu)', '2017-04-21', ['TK10A']],
    ['tk-xy-b', 'XY trainer Kit (Bisharp)', '2014-11-01', ['TK7A']],
    ['tk-xy-latia', 'XY trainer Kit (Latias)', '2015-04-29', ['TK8A']],
    ['tk-xy-latio', 'XY trainer Kit (Latios)', '2015-04-29', ['TK8O']],
    ['tk-xy-n', 'XY trainer Kit (Noivern)', '2014-03-12', ['TK6N']],
    ['tk-xy-p', 'XY trainer Kit (Pikachu Libre)', '2016-04-27', ['TK9P']],
    ['tk-xy-su', 'XY trainer Kit (Suicune)', '2016-04-27', ['TK9S']],
    ['tk-xy-sy', 'XY trainer Kit (Sylveon)', '2014-03-12', ['TK6S']],
    ['tk-xy-w', 'XY trainer Kit (Wigglytuff)', '2014-11-01', ['TK7B']],
    ['xy8', 'BREAKthrough', '2015-11-04', ['BKT']],
    ['xya', 'Yellow A Alternate', '2014-02-05', []],
    ['xyp', 'XY Black Star Promos', '2013-10-12', ['XYP', 'PR-XY']],
    ['swsh4.5', 'Shining Fates', '2021-02-19', ['SHF']],
  ] as [string, string, string, string[]][]
).map(([code, name, releasedOn, codes]) => ({ code, name, releasedOn, codes }));

describe('matchSets', () => {
  const matched = matchSets(OUR_SETS, PTCG_SETS);

  it('matches our picture-less sets by alias, code and name, or name and date', () => {
    expect(Object.fromEntries(matched)).toEqual({
      // aliases: McDonald's years, EX trainer kits, the Unown collection, the SV promos, 30th-c
      '2011bw': 'mcd11',
      '2012bw': 'mcd12',
      '2014xy': 'mcd14',
      '2015xy': 'mcd15',
      '2016xy': 'mcd16',
      '2017sm': 'mcd17',
      '2018sm': 'mcd18',
      '2019sm': 'mcd19',
      '2021swsh': 'mcd21',
      '2022swsh': 'mcd22',
      'tk-ex-latia': 'tk1a',
      'tk-ex-latio': 'tk1b',
      'tk-ex-p': 'tk2a',
      'tk-ex-m': 'tk2b',
      exu: 'ex10',
      svp: 'svp',
      '30th-c': 'me55c',
      // a shared code and the name (SHF, CEL, the gallery codes, 30C)
      'swsh4.5': 'swsh45',
      'swsh4.5sv': 'swsh45sv',
      cel25: 'cel25',
      cel25cc: 'cel25c',
      swsh9tg: 'swsh9tg',
      swsh10tg: 'swsh10tg',
      swsh11tg: 'swsh11tg',
      swsh12tg: 'swsh12tg',
      'swsh12.5gg': 'swsh12pt5gg',
      '30th': 'me55',
      hgssp: 'hsp',
      bwp: 'bwp',
      smp: 'smp',
      xyp: 'xyp',
      'sv03.5': 'sv3pt5',
      // the only set with the code
      'sm3.5': 'sm35',
      'sm7.5': 'sm75',
      sm2: 'sm2',
      sm6: 'sm6',
      sve: 'sve',
      dc1: 'dc1',
      ecard2: 'ecard2',
      ecard3: 'ecard3',
      ex14: 'ex14',
      pl2: 'pl2',
      xy8: 'xy8',
      // name and release day
      bog: 'bp',
      pop6: 'pop6',
      swshp: 'swshp',
    });
  });

  it('leaves the sets pokemontcg.io does not have unmatched', () => {
    const unmatched = OUR_SETS.map((s) => s.code).filter((c) => !matched.has(c));
    expect(unmatched).toEqual([
      '2023sv',
      '2024sv',
      'ex5.5',
      'mee',
      'mep',
      'mfb',
      'miscp',
      'tk-bw-e',
      'tk-bw-z',
      'tk-dp-l',
      'tk-dp-m',
      'tk-hs-g',
      'tk-hs-r',
      'tk-sm-l',
      'tk-sm-r',
      'tk-xy-b',
      'tk-xy-latia',
      'tk-xy-latio',
      'tk-xy-n',
      'tk-xy-p',
      'tk-xy-su',
      'tk-xy-sy',
      'tk-xy-w',
      'xya',
    ]);
  });

  it('drops an alias whose set pokemontcg.io no longer lists', () => {
    const without = PTCG_SETS.filter((s) => s.id !== 'mcd21');
    expect(matchSets(OUR_SETS, without).has('2021swsh')).toBe(false);
  });
});

describe('normNumber and normName', () => {
  it.each([
    ['SV001', 'SV1'],
    ['001', '1'],
    ['1', '1'],
    ['TG01', 'TG1'],
    ['GG70', 'GG70'],
    ['B', 'B'],
    ['24a', '24A'],
    ['%3F', '?'],
    ['100%', '100%'],
    ['SWSH020', 'SWSH20'],
    ['0', '0'],
  ])('%s → %s', (number, normalized) => expect(normNumber(number)).toBe(normalized));

  it('compares names by letters and digits', () => {
    expect(normName('Mewtwo EX')).toBe(normName('Mewtwo-EX'));
    expect(normName('Umbreon ☆')).toBe(normName('Umbreon ★'));
    expect(normName('Gardevoir ex')).toBe(normName('Gardevoir ex δ'));
    expect(normName('Celebrations: Classic Collection')).toBe(
      normName('Celebrations Classic Collection'),
    );
  });
});

describe('matchCards', () => {
  const print = (number: string, name: string): OurPrint => ({ id: `p-${number}`, number, name });

  it('matches by number and name: SV001 = SV001, 001 = 1', () => {
    const matched = matchCards(
      [print('SV001', 'Rowlet'), print('SV002', 'Dartrix'), print('SV050', 'Pikachu')],
      ptcgCards('swsh45sv'),
    );
    expect(Object.fromEntries(matched)).toEqual({
      'p-SV001': {
        pokemontcg: 'swsh45sv-SV001',
        pokemontcg_images: {
          small: 'https://images.pokemontcg.io/swsh45sv/SV001.png',
          large: 'https://images.pokemontcg.io/swsh45sv/SV001_hires.png',
        },
      },
      'p-SV002': {
        pokemontcg: 'swsh45sv-SV002',
        pokemontcg_images: {
          small: 'https://images.pokemontcg.io/swsh45sv/SV002.png',
          large: 'https://images.pokemontcg.io/swsh45sv/SV002_hires.png',
        },
      },
    });
    const mcd = matchCards([print('01', 'Bulbasaur'), print('25', 'Pikachu')], ptcgCards('mcd21'));
    expect([...mcd.values()].map((v) => v.pokemontcg)).toEqual(['mcd21-1', 'mcd21-25']);
  });

  it('never takes a card whose number agrees and name does not', () => {
    // Bulbasaur is 1 there: Squirtle gets the one Squirtle (17) by name, Bulbasaur nothing.
    const matched = matchCards([print('1', 'Squirtle'), print('9', 'Ivysaur')], ptcgCards('mcd21'));
    expect(Object.fromEntries([...matched].map(([id, v]) => [id, v.pokemontcg]))).toEqual({
      'p-1': 'mcd21-17',
    });
  });

  it('matches the rest by a name only one print and one card carry (Classic Collection)', () => {
    const ours = [
      print('CC001', 'Blastoise'),
      print('CC002', 'Charizard'),
      print('CC015', 'Umbreon ☆'),
      print('CC022', 'Mewtwo EX'),
    ];
    const matched = matchCards(ours, ptcgCards('cel25c'));
    expect(Object.fromEntries([...matched].map(([id, v]) => [id, v.pokemontcg]))).toEqual({
      'p-CC001': 'cel25c-2_A',
      'p-CC002': 'cel25c-4_A',
      'p-CC015': 'cel25c-17_A',
      'p-CC022': 'cel25c-54_A',
    });
    // Two prints of one name: neither is guessed.
    expect(
      matchCards([print('X1', 'Charizard'), print('X2', 'Charizard')], ptcgCards('cel25c')).size,
    ).toBe(0);
  });

  it('never gives a picture-less print the card of a pictured sibling (146a vs 146)', () => {
    const cards: PtcgCard[] = [
      {
        id: 'xy8-146',
        name: 'Gardevoir',
        number: '146',
        images: { large: 'https://images.pokemontcg.io/xy8/146_hires.png' },
      },
    ];
    const ours = [{ ...print('146', 'Gardevoir'), hasPicture: true }, print('146a', 'Gardevoir')];
    expect(matchCards(ours, cards).size).toBe(0);
    // Without the pictured sibling the name match still applies.
    expect(matchCards([print('146a', 'Gardevoir')], cards).size).toBe(1);
  });

  it('skips a card without a picture the mirror can store', () => {
    const cards: PtcgCard[] = [
      {
        id: 'me55-B',
        name: 'Mew',
        number: 'B',
        images: { large: 'https://images.scrydex.com/pokemon/me55-B/large' },
      },
      { id: 'me55-G', name: 'Mew', number: 'G' },
      {
        id: 'me55-R',
        name: 'Mew',
        number: 'R',
        images: { large: 'https://images.pokemontcg.io/me55/R_hires.png' },
      },
    ];
    const matched = matchCards([print('B', 'Mew'), print('G', 'Mew'), print('R', 'Mew')], cards);
    expect([...matched.keys()]).toEqual(['p-R']);
  });
});
