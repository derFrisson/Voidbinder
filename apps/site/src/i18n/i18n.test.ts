import { describe, expect, it } from 'vitest';
import { localePath, t } from './index';

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
    expect(localePath('/en/impressum/', 'de')).toBe('/de/impressum/');
    expect(localePath('/de', 'en')).toBe('/en');
  });
});
