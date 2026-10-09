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

// Proper names, words both languages share, and the Wizards notice, which the Fan Content
// Policy requires verbatim (English) in every locale.
const SAME_IN_BOTH = new Set([
  'Pokémon',
  'Yu‑Gi‑Oh!',
  'Magic: The Gathering',
  'One Piece',
  'Decks',
  'Powered by',
  'Name',
  'Deutsch',
  'English',
  'Euro (€)',
  de.notices.mtg,
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
