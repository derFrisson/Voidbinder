import { describe, expect, it } from 'vitest';
import { cacheTags } from './catalog-cache';

describe('cacheTags', () => {
  it('tags modules, prices and the catalog', () => {
    expect(cacheTags('/catalog/modules')).toBe('modules');
    expect(cacheTags('/catalog/prints/0a1b/prices')).toBe('prices');
    expect(cacheTags('/catalog/prints/0a1b/prices/history')).toBe('prices');
    expect(cacheTags('/catalog/games')).toBe('catalog');
    expect(cacheTags('/catalog/cards/0a1b')).toBe('catalog');
    expect(cacheTags('/catalog/sets/mtg/prices')).toBe('catalog');
    expect(cacheTags('/catalog/search')).toBe('catalog');
  });
});
