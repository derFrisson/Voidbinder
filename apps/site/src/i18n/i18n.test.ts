import { describe, expect, it } from 'vitest';
import {
  legalPath,
  legalPages,
  legalSlugs,
  localePath,
  locales,
  negotiateLocale,
  t,
} from './index';

// Every key path, including array indices, so a list item missing a field also shows up.
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

// Every leaf as [key path, value].
function leaves(value: unknown, prefix = ''): [string, string][] {
  if (typeof value === 'string') return [[prefix, value]];
  if (value === null || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([k, v]) => leaves(v, prefix ? `${prefix}.${k}` : k));
}

// Values that may read the same in both languages: proper names, codes, numbers, URLs and
// words German and English share.
const SAME_IN_BOTH = new Set([
  'Pokémon',
  'Yu-Gi-Oh!',
  'Magic: The Gathering',
  'One Piece',
  'Streamer Kit',
  'Scanner',
  'Live',
  'GitHub',
  'Twitch',
  'Normal',
  'Holo',
  'TCGplayer',
  'Cardmarket',
  // Grading and variant terms, mock app labels and the footer's "Powered by" read the same in both.
  'Offline',
  'Near Mint',
  'Reverse Holo',
  'Decks',
  'Scan',
  'Powered by',
]);

const FORBIDDEN = ['verfügbar jetzt', 'available now', 'revolution', 'seamless', 'nahtlos'];

describe('i18n', () => {
  it('has identical key sets in de and en', () => {
    expect(keyPaths(t('en')).sort()).toEqual(keyPaths(t('de')).sort());
  });

  it('has no empty value in either locale', () => {
    for (const locale of ['de', 'en'] as const) {
      for (const [key, value] of leaves(t(locale))) {
        expect(value.trim(), `${locale}:${key}`).not.toBe('');
      }
    }
  });

  it('translates every value that is not a proper name or a URL', () => {
    const en = new Map(leaves(t('en')));
    const same = leaves(t('de')).filter(
      ([key, value]) =>
        en.get(key) === value &&
        !SAME_IN_BOTH.has(value) &&
        !/^https?:\/\//.test(value) &&
        !/^[\d\s.,€$%×]+$/.test(value),
    );
    expect(same).toEqual([]);
  });

  it('uses none of the forbidden words, no dashes as punctuation and no exclamation marks', () => {
    for (const locale of ['de', 'en'] as const) {
      for (const [key, value] of leaves(t(locale))) {
        const lower = value.toLowerCase();
        for (const word of FORBIDDEN) expect(lower, `${locale}:${key}`).not.toContain(word);
        expect(value, `${locale}:${key}`).not.toMatch(/[\u2013\u2014]| - /);
        // Only the game name Yu-Gi-Oh! may carry an exclamation mark.
        expect(
          value.replaceAll('Yu-Gi-Oh!', '').replaceAll('Yu\u2011Gi\u2011Oh!', ''),
          `${locale}:${key}`,
        ).not.toContain('!');
      }
    }
  });

  it('swaps the locale segment of a path', () => {
    expect(localePath('/de/', 'en')).toBe('/en/');
    expect(localePath('/en/waitlist/pending', 'de')).toBe('/de/waitlist/pending');
    expect(localePath('/de', 'en')).toBe('/en');
  });

  it('swaps the slug of a legal page with the locale', () => {
    expect(localePath('/de/impressum/', 'en')).toBe('/en/imprint/');
    expect(localePath('/en/imprint/', 'de')).toBe('/de/impressum/');
    expect(localePath('/de/datenschutz', 'en')).toBe('/en/privacy');
    expect(localePath('/en/privacy/', 'en')).toBe('/en/privacy/');
  });

  it('builds the locale-specific legal paths of the footer', () => {
    expect(legalPath('de', 'imprint')).toBe('/de/impressum/');
    expect(legalPath('en', 'privacy')).toBe('/en/privacy/');
    for (const l of locales) {
      for (const p of legalPages) expect(legalSlugs[l][p]).toMatch(/^[a-z]+$/);
    }
  });
});

describe('negotiateLocale', () => {
  it('matches the language subtag, so a bare region tag still finds its locale', () => {
    expect(negotiateLocale('en-US')).toBe('en');
    expect(negotiateLocale('de-AT')).toBe('de');
  });
  it('honours q weights and order, and falls back to German', () => {
    expect(negotiateLocale('fr-FR,fr;q=0.9,en;q=0.8')).toBe('en');
    expect(negotiateLocale('en;q=0.5,de;q=0.9')).toBe('de');
    expect(negotiateLocale('fr')).toBe('de');
    expect(negotiateLocale(null)).toBe('de');
    expect(negotiateLocale('')).toBe('de');
    expect(negotiateLocale('*')).toBe('de');
  });
});
