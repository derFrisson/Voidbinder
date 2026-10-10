import { describe, expect, it } from 'vitest';
import { cacheTags } from './catalog-cache';

describe('cacheTags', () => {
  it('tags modules, prices and the catalog, with the game where the request names it', () => {
    expect(cacheTags('/catalog/modules', undefined)).toBe('modules');
    expect(cacheTags('/catalog/prints/0a1b/prices', undefined)).toBe('prices');
    expect(cacheTags('/catalog/prints/0a1b/prices/history', undefined)).toBe('prices');
    expect(cacheTags('/catalog/games', undefined)).toBe('catalog');
    expect(cacheTags('/catalog/cards/0a1b', undefined)).toBe('catalog');
    expect(cacheTags('/catalog/sets/mtg/prices', 'mtg')).toBe('catalog,game:mtg');
    expect(cacheTags('/catalog/search', 'pokemon')).toBe('catalog,game:pokemon');
  });
});
