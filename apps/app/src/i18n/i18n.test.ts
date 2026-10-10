import { describe, expect, it } from 'vitest';
import { de } from './de';
import { en } from './en';
import { fmt } from './index';

// Same checks as the site's dictionaries (apps/site/src/i18n/i18n.test.ts).
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

function leaves(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

// Proper names and words both languages share.
const SAME_IN_BOTH = new Set([
  // Ban-list badge: a placeholder-only template, the same in both languages (VB-81).
  '{format}: {status}',
  'Pokémon',
  'Yu‑Gi‑Oh!',
  'Magic: The Gathering',
  'One Piece',
  'Decks',
  'Powered by',
  'Name',
  'Code',
  'Set',
  'Normal',
  // The trade name of a Yu-Gi-Oh! print, as Konami and Cardmarket write it in German too (VB-106).
  'Extended Art',
  'Foil',
  'Holo',
  'Reverse',
  'Bonus',
  'Deutsch',
  'English',
  'Euro (€)',
  // The collection's short game names (VB-31).
  'Magic',
  // Card page and search (VB-35): terms the German card trade uses as they are.
  'Set',
  'Normal',
  // The trade name of a Yu-Gi-Oh! print, as Konami and Cardmarket write it in German too (VB-106).
  'Extended Art',
  'Foil',
  'Holo',
  'legal',
  'Near Mint',
  'Trend',
  'Market',
  'ATK',
  'ATK/DEF',
  'Link',
  'Illustration',
  'Illustration: {artist}',
  // Deck formats (VB-34): the games' own names, and the curve's bar label.
  'Standard',
  'Pioneer',
  'Modern',
  'Legacy',
  'Vintage',
  'Commander',
  'Pauper',
  'Expanded',
  'Advanced',
  '{label}: {count}',
  'Format',
  'Extra',
  'Side',
]);

describe('i18n', () => {
  it('has identical key sets in de and en', () => {
    expect(keyPaths(en).sort()).toEqual(keyPaths(de).sort());
  });

  it('has no empty value', () => {
    for (const dict of [de, en]) {
      for (const [key, value] of leaves(dict)) expect(value.trim(), key).not.toBe('');
    }
  });

  it('translates every value that is not a proper name or a URL', () => {
    const english = new Map(leaves(en));
    const same = leaves(de).filter(
      ([key, value]) =>
        english.get(key) === value && !SAME_IN_BOTH.has(value) && !/^https?:\/\//.test(value),
    );
    expect(same).toEqual([]);
  });

  it('keeps the same placeholders in both languages', () => {
    const english = new Map(leaves(en));
    for (const [key, value] of leaves(de)) {
      const names = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
      expect(names(english.get(key) ?? ''), key).toEqual(names(value));
    }
  });

  it('uses no dashes as punctuation and no exclamation marks', () => {
    for (const dict of [de, en]) {
      for (const [key, value] of leaves(dict)) {
        expect(value, key).not.toMatch(/[–—]| - /);
        expect(value.replaceAll(/Yu[-‑]Gi[-‑]Oh!/g, ''), key).not.toContain('!');
      }
    }
  });

  it('fills placeholders and leaves unknown ones alone', () => {
    expect(fmt('{count} Sets', { count: 3 })).toBe('3 Sets');
    expect(fmt('{a} {b}', { a: 1 })).toBe('1 {b}');
  });
});
