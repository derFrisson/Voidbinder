import { describe, expect, it } from 'vitest';
import {
  displayCode,
  displayNumber,
  matchLanguage,
  printNumbers,
  storedCode,
  typedLanguage,
  typedToken,
} from './index.js';

const ygo = ['en', 'de', 'fr', 'it', 'es', 'pt', 'ja'];

describe('displayNumber', () => {
  it.each([
    ['de', 'DE024'],
    ['fr', 'FR024'],
    ['it', 'IT024'],
    ['es', 'SP024'],
    ['pt', 'PT024'],
    ['ja', 'JP024'],
    ['en', 'EN024'],
  ])('swaps the Yu-Gi-Oh! token for %s', (lang, shown) => {
    expect(displayNumber('yugioh', 'EN024', lang, ygo)).toBe(shown);
  });

  it('keeps EN without a localization in the language', () => {
    expect(displayNumber('yugioh', 'EN024', 'de', ['en', 'fr'])).toBe('EN024');
  });

  it('keeps numbers without an English token and unknown languages', () => {
    expect(displayNumber('yugioh', 'DE005', 'fr', ygo)).toBe('DE005');
    expect(displayNumber('yugioh', '001', 'de', ygo)).toBe('001');
    expect(displayNumber('yugioh', 'EN024', 'zhs', ['zhs'])).toBe('EN024');
  });

  it('leaves Pokémon and Magic numbers unchanged', () => {
    expect(displayNumber('pokemon', '053', 'de', ['de'])).toBe('053');
    expect(displayNumber('mtg', 'EN1', 'de', ['de'])).toBe('EN1');
  });
});

describe('displayCode', () => {
  it('prints the code per game', () => {
    expect(displayCode('yugioh', 'blgg', 'DE024', 60)).toBe('BLGG-DE024');
    expect(displayCode('yugioh', 'db49', 'DB49', null)).toBe('DB49');
    expect(displayCode('pokemon', 'sv01', '053', 128)).toBe('053/128');
    expect(displayCode('pokemon', 'svp', 'SVP001', null)).toBe('SVP001');
    expect(displayCode('mtg', 'mid', '123', 277)).toBe('MID 123');
  });
});

describe('typedLanguage', () => {
  it('reads the token of a typed Yu-Gi-Oh! code', () => {
    expect(typedLanguage('yugioh', 'blggde024', 'blgg', 'EN024')).toBe('de');
    // A set plus token without a number names nothing, not even EN000.
    expect(typedLanguage('yugioh', 'lobde', 'lob', 'EN000')).toBeNull();
    expect(typedLanguage('yugioh', 'blggsp024', 'blgg', 'EN024')).toBe('es');
    expect(typedLanguage('yugioh', 'blggjp024', 'blgg', 'EN024')).toBe('ja');
    expect(typedLanguage('yugioh', 'blggen024', 'blgg', 'EN024')).toBe('en');
  });

  it('ignores leading zeros of the typed number', () => {
    expect(typedLanguage('yugioh', 'blggde24', 'blgg', 'EN024')).toBe('de');
    expect(typedLanguage('yugioh', 'blggjp0024', 'blgg', 'EN024')).toBe('ja');
    expect(typedLanguage('yugioh', 'blggde240', 'blgg', 'EN024')).toBeNull();
  });

  it('is null for other numbers, sets, games and plain queries', () => {
    expect(typedLanguage('yugioh', 'blggde025', 'blgg', 'EN024')).toBeNull();
    expect(typedLanguage('yugioh', 'lds3de024', 'blgg', 'EN024')).toBeNull();
    expect(typedLanguage('yugioh', 'blggxx024', 'blgg', 'EN024')).toBeNull();
    expect(typedLanguage('yugioh', null, 'blgg', 'EN024')).toBeNull();
    expect(typedLanguage('mtg', 'midde123', 'mid', 'EN123')).toBeNull();
  });
});

describe('typedToken (VB-102)', () => {
  it('reads the token after the set code, with or without a number', () => {
    expect(typedToken('yugioh', 'lc01en', 'lc01')).toBe('en');
    expect(typedToken('yugioh', 'lc01en0', 'lc01')).toBe('en');
    expect(typedToken('yugioh', 'lc01de004', 'lc01')).toBe('de');
    expect(typedToken('yugioh', 'lc01sp', 'lc01')).toBe('es');
    expect(typedToken('yugioh', 'lc01jp', 'lc01')).toBe('ja');
    expect(typedToken('yugioh', 'lobde', 'lob')).toBe('de');
  });

  it('is null without a known token, for other sets and games', () => {
    expect(typedToken('yugioh', 'lc01', 'lc01')).toBeNull();
    expect(typedToken('yugioh', 'lc01004', 'lc01')).toBeNull();
    expect(typedToken('yugioh', 'lc01xx', 'lc01')).toBeNull();
    expect(typedToken('yugioh', 'lc01ende', 'lc01')).toBeNull();
    expect(typedToken('yugioh', 'lds3de', 'lc01')).toBeNull();
    expect(typedToken('yugioh', null, 'lc01')).toBeNull();
    expect(typedToken('mtg', 'midde', 'mid')).toBeNull();
  });

  it('picks the language of a print without claiming it (matchedCode needs the number)', () => {
    const lc01 = { game: 'yugioh' as const, setCode: 'lc01', number: 'EN004', cardCount: 6 };
    expect(matchLanguage(lc01, [], 'de', 'lc01en')).toBe('en');
    expect(matchLanguage(lc01, [], 'en', 'lc01de0')).toBe('de');
    expect(matchLanguage(lc01, [], 'de', 'lc01')).toBe('de');
    expect(matchLanguage(lc01, [], 'de', 'lc01004')).toBe('de');
    expect(printNumbers(lc01, 'de', true, 'lc01en')).toEqual({
      displayNumber: 'EN004',
      displayCode: 'LC01-EN004',
    });
    expect(printNumbers(lc01, 'en', false, 'lc01jp')).toEqual({
      displayNumber: 'JP004',
      displayCode: 'LC01-JP004',
    });
    expect(printNumbers(lc01, 'de', true, 'lc01en4')).toMatchObject({
      matchedCode: 'LC01-EN004',
    });
  });
});

describe('printNumbers with a stored localized code (VB-94)', () => {
  const lon = { game: 'yugioh' as const, setCode: 'lon', number: '065', cardCount: 105 };

  it('prefers the stored code over the rule, also under another set code', () => {
    expect(printNumbers({ ...lon, localizedCode: 'LON-G065' }, 'de', true)).toEqual({
      displayNumber: 'G065',
      displayCode: 'LON-G065',
    });
    expect(printNumbers({ ...lon, localizedCode: 'LDC-F065' }, 'fr', true)).toEqual({
      displayNumber: 'F065',
      displayCode: 'LDC-F065',
    });
    // Without one, the rule (a token-less number stays as it is).
    expect(printNumbers({ ...lon, localizedCode: null }, 'de', true).displayCode).toBe('LON-065');
    expect(
      printNumbers({ ...lon, number: 'EN065', localizedCode: null }, 'de', true).displayCode,
    ).toBe('LON-DE065');
  });

  it('marks a query naming the stored code as matched, and ignores it for another language', () => {
    expect(printNumbers({ ...lon, localizedCode: 'LON-G065' }, 'de', true, 'long065')).toEqual({
      displayNumber: 'G065',
      displayCode: 'LON-G065',
      matchedCode: 'LON-G065',
    });
    expect(
      printNumbers({ ...lon, localizedCode: 'LON-G065' }, 'de', true, 'long06'),
    ).not.toHaveProperty('matchedCode');
    // A typed French token is not the German row's code.
    const blgg = { game: 'yugioh' as const, setCode: 'blgg', number: 'EN024', cardCount: 100 };
    expect(
      printNumbers({ ...blgg, localizedCode: 'BLGG-DE024' }, 'de', true, 'blggfr024').displayCode,
    ).toBe('BLGG-FR024');
    // Other games have no such codes.
    expect(
      printNumbers(
        { game: 'mtg', setCode: 'mid', number: '123', cardCount: 277, localizedCode: 'X-1' },
        'de',
        true,
      ).displayCode,
    ).toBe('MID 123');
  });

  it('reads the code from a localization’s external_ids', () => {
    expect(storedCode({ set_code: 'LON-G065', set_code_source: 'yugipedia' })).toBe('LON-G065');
    expect(storedCode({ set_code_source: 'yugipedia' })).toBeNull();
    expect(storedCode(null)).toBeNull();
  });
});

describe('matchLanguage (VB-102)', () => {
  const blgg = { game: 'yugioh' as const, setCode: 'blgg', number: 'EN024' };
  const pineco = { game: 'pokemon' as const, setCode: 'sv01', number: '001' };

  it('follows the name that matched, whatever the requested language', () => {
    expect(matchLanguage(blgg, [''], 'de')).toBe('en');
    expect(matchLanguage(blgg, ['de'], 'en')).toBe('de');
    expect(matchLanguage(pineco, ['de'], 'en')).toBe('de');
  });

  it('takes the requested language, else English, else the first among several matches', () => {
    expect(matchLanguage(pineco, ['', 'de'], 'de')).toBe('de');
    expect(matchLanguage(pineco, ['en', 'de'], 'fr')).toBe('en');
    expect(matchLanguage(pineco, ['fr', 'de'], 'ja')).toBe('de');
  });

  it('a code token names the language; a match without a name keeps the requested one', () => {
    expect(matchLanguage(blgg, [], 'de', 'blggen024')).toBe('en');
    expect(matchLanguage(blgg, [], 'en', 'blggde024')).toBe('de');
    expect(matchLanguage(blgg, [], 'de', 'blgg024')).toBe('de');
    expect(matchLanguage(pineco, [], 'fr', 'sv1001')).toBe('fr');
  });
});
