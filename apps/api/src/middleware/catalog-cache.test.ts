import { describe, expect, it } from 'vitest';
import { cacheTags } from './catalog-cache';

describe('cacheTags', () => {
  it('tags modules, the catalog, and prices on every response that embeds one', () => {
    expect(cacheTags('/catalog/modules')).toBe('modules');
    expect(cacheTags('/catalog/games')).toBe('catalog');
    expect(cacheTags('/catalog/games/mtg/sets')).toBe('catalog');
    expect(cacheTags('/catalog/prints/0a1b')).toBe('catalog');
    // marketPrice on the set page, the card page and the search hits.
    expect(cacheTags('/catalog/sets/mtg/mid')).toBe('catalog,prices');
    expect(cacheTags('/catalog/sets/mtg/prices')).toBe('catalog,prices');
    expect(cacheTags('/catalog/cards/0a1b')).toBe('catalog,prices');
    expect(cacheTags('/catalog/search')).toBe('catalog,prices');
    expect(cacheTags('/catalog/prints/0a1b/prices')).toBe('catalog,prices');
    expect(cacheTags('/catalog/prints/0a1b/prices/history')).toBe('catalog,prices');
  });
});
