import { describe, expect, it } from 'vitest';
import { displayCode, displayNumber, matchLanguage, typedLanguage } from './index.js';

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
