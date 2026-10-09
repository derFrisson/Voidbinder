import { describe, expect, it } from 'vitest';
import { cardKey } from './index.js';

describe('cardKey', () => {
  it('normalizes set code and number', () => {
    expect(cardKey('pokemon', ' SV1 ', '025')).toBe('pokemon:sv1-025');
  });

  it('rejects empty parts', () => {
    expect(() => cardKey('mtg', ' ', '1')).toThrow();
  });
});
