import { describe, expect, it } from 'vitest';
import { legalPath, legalPages, legalSlugs, localePath, locales, t } from './index';

// Every key path, including array indices, so a list item missing a field also shows up.
function keyPaths(value: unknown, prefix = ''): string[] {
  if (value === null || typeof value !== 'object') return [prefix];
  return Object.entries(value).flatMap(([k, v]) => keyPaths(v, prefix ? `${prefix}.${k}` : k));
}

describe('i18n', () => {
  it('has identical key sets in de and en', () => {
    expect(keyPaths(t('en')).sort()).toEqual(keyPaths(t('de')).sort());
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
