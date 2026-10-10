import { describe, expect, it } from 'vitest';
import { banLimit, banStatus } from './api/banlist.js';
import { EmailSchema, isFoil, LocaleSchema } from './index.js';
import { CC_BY_SA_URL, YUGIPEDIA_ATTRIBUTION } from './notices.js';

describe('EmailSchema', () => {
  it('normalizes a valid address', () => {
    expect(EmailSchema.parse('  Ash@Example.COM ')).toBe('ash@example.com');
  });

  it('rejects invalid addresses', () => {
    expect(EmailSchema.safeParse('not-an-email').success).toBe(false);
    expect(EmailSchema.safeParse(`${'a'.repeat(250)}@x.de`).success).toBe(false);
  });
});

describe('LocaleSchema', () => {
  it('accepts supported locales only', () => {
    expect(LocaleSchema.parse('de')).toBe('de');
    expect(LocaleSchema.safeParse('fr').success).toBe(false);
  });
});

describe('ban list statuses (VB-81)', () => {
  it('maps a status to the copies it allows and the restricted ones to themselves', () => {
    expect(['Forbidden', 'banned', 'Limited', 'Semi-Limited', 'Unlimited'].map(banLimit)).toEqual([
      0, 0, 1, 2, 3,
    ]);
    expect(banLimit(undefined)).toBeNull();
    expect(['forbidden', 'Semi-Limited', 'Unlimited', null].map(banStatus)).toEqual([
      'Forbidden',
      'Semi-Limited',
      null,
      null,
    ]);
  });
});

describe('Yugipedia attribution (VB-93)', () => {
  it('names the source and its licence in both locales', () => {
    expect(YUGIPEDIA_ATTRIBUTION.de).toBe(
      'Yu-Gi-Oh!-Kartennamen und -texte in weiteren Sprachen: Yugipedia (CC BY-SA 4.0)',
    );
    for (const text of Object.values(YUGIPEDIA_ATTRIBUTION))
      expect(text).toMatch(/: Yugipedia \(CC BY-SA 4\.0\)$/);
    expect(CC_BY_SA_URL).toBe('https://creativecommons.org/licenses/by-sa/4.0/');
  });
});

describe('isFoil (VB-112)', () => {
  it.each([
    ['Common', false],
    ['Short Print', false],
    ['Super Short Print', false],
    [null, false],
    ['New', false],
    ['Rare', true],
    ['Super Rare', true],
    ['Quarter Century Secret Rare', true],
    ['Duel Terminal Normal Parallel Rare', true],
    ['Starfoil', true],
  ])('Yu-Gi-Oh! %j: %s', (rarity, foil) => expect(isFoil('yugioh', rarity)).toBe(foil));

  it.each([
    ['Common', 'normal', false],
    ['Uncommon', 'normal', false],
    ['Rare', 'normal', false],
    ['None', 'normal', false],
    [null, 'normal', false],
    ['Rare Holo', 'normal', true],
    ['Double rare', 'normal', true],
    ['Special illustration rare', 'normal', true],
    ['ACE SPEC Rare', 'normal', true],
    ['Common', 'reverse', true],
    ['Rare', 'holo', true],
  ])('Pokémon %j in %s: %s', (rarity, finish, foil) =>
    expect(isFoil('pokemon', rarity, finish)).toBe(foil),
  );

  it.each([
    ['mythic', 'normal', false],
    ['common', 'foil', true],
    ['rare', 'etched', true],
    ['special', undefined, false],
  ])('Magic %j in %s: %s', (rarity, finish, foil) =>
    expect(isFoil('mtg', rarity, finish)).toBe(foil),
  );

  it('counts an Extended Art print as foil', () => {
    expect(isFoil('yugioh', 'Common', 'normal', true)).toBe(true);
  });
});
