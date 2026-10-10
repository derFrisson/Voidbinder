import { describe, expect, it } from 'vitest';
import { yugiohRarityAbbr, yugiohScanBacks } from './yugioh-rarities.js';

describe('Yu-Gi-Oh! rarities', () => {
  it("tells YGOPRODeck's placeholders from rarities", () => {
    expect(
      ['Starlight Rare', 'StR', 'starlight', 'PLatinum Secret Rare', 'Cr'].map(yugiohRarityAbbr),
    ).toEqual(['StR', 'StR', 'StR', 'PlScR', 'CR']);
    for (const placeholder of ['New', 'New artwork', '2', 'Reprint', 'European & Oceanian debut'])
      expect(yugiohRarityAbbr(placeholder), placeholder).toBeNull();
  });

  it('lets a scan stand in for a print of the same or a fancier tier only', () => {
    // Allowed: the Extended Art Ultra Rare for a Grand Master Rare, plain for plain or Starlight.
    expect(yugiohScanBacks('UR', 'GMR')).toBe(true);
    expect(yugiohScanBacks('StR', 'GMR')).toBe(true);
    expect(yugiohScanBacks('UR', 'ScR')).toBe(true);
    expect(yugiohScanBacks('ScR', 'UR')).toBe(true);
    expect(yugiohScanBacks('UR', 'StR')).toBe(true);
    expect(yugiohScanBacks('StR', 'StR')).toBe(true);
    // Refused: a special foil for anything plainer.
    expect(yugiohScanBacks('GMR', 'UR')).toBe(false);
    expect(yugiohScanBacks('GMR', 'StR')).toBe(false);
    expect(yugiohScanBacks('StR', 'UR')).toBe(false);
    expect(yugiohScanBacks('CR', 'ScR')).toBe(false);
    expect(yugiohScanBacks('QCScR', 'StR')).toBe(false);
    // A rarity outside the tiers: backed by plain ones only, backs none.
    expect(yugiohScanBacks('UR', 'MSR')).toBe(true);
    expect(yugiohScanBacks('StR', 'MSR')).toBe(false);
    expect(yugiohScanBacks('MSR', 'SFR')).toBe(false);
  });
});
