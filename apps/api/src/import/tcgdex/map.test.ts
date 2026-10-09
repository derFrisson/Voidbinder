import { describe, expect, it } from 'vitest';
import { isDigitalSet, mapCard, mapLocalization, mapPrint, mapSet } from './map';
import { card, setDetail } from './test-fixtures';
import { sourceHash } from '../util';

describe('mapSet', () => {
  it('maps the set and keeps the series in kind', () => {
    expect(mapSet(setDetail('en', 'swsh3'))).toMatchObject({
      code: 'swsh3',
      name: 'Darkness Ablaze',
      releasedOn: '2020-08-14',
      cardCount: 189,
      kind: 'swsh',
      externalIds: {
        tcgdex: 'swsh3',
        serie: { id: 'swsh', name: 'Sword & Shield' },
        tcgOnline: 'DAA',
        cardCountTotal: 201,
      },
    });
  });

  it('recognises a Pokémon TCG Pocket set as digital', () => {
    expect(isDigitalSet(setDetail('en', 'A1'))).toBe(true);
    expect(isDigitalSet(setDetail('en', 'swsh3'))).toBe(false);
  });
});

describe('mapCard', () => {
  it('maps a Pokémon card with its attacks and legality', () => {
    const row = mapCard(card('en', 'swsh3-136'));
    expect(row).toMatchObject({
      oracleKey: 'swsh3-136',
      name: 'Furret',
      typeLine: 'Pokemon - Colorless - Stage1',
      legalities: { standard: 'not_legal', expanded: 'legal' },
      attributes: {
        category: 'Pokemon',
        hp: 110,
        types: ['Colorless'],
        stage: 'Stage1',
        evolveFrom: 'Sentret',
        retreat: 1,
        illustrator: 'tetsuya koizumi',
        regulationMark: 'D',
        weaknesses: [{ type: 'Fighting', value: '×2' }],
      },
    });
    expect(row.text).toBe(
      "Feelin' Fine: Draw 3 cards.\nTail Smash 90: Flip a coin. If tails, this attack does nothing.",
    );
  });

  it('puts abilities before attacks', () => {
    const { text, attributes } = mapCard(card('en', 'base1-4'));
    expect(text?.split('\n')[0]).toMatch(/^Pokemon Power Energy Burn: /);
    expect(attributes.abilities).toHaveLength(1);
  });

  it('maps a Trainer by its trainer type and the rules text', () => {
    const row = mapCard(card('en', 'swsh3-171'));
    expect(row.typeLine).toBe('Trainer - Tool');
    expect(row.text).toMatch(/^If the Pokémon this card is attached to/);
    expect(row.attributes).toMatchObject({ category: 'Trainer', trainerType: 'Tool' });
    expect(row.attributes).not.toHaveProperty('hp');
  });

  it('maps an Energy card by its energy type', () => {
    const row = mapCard(card('en', 'swsh3-176'));
    expect(row.typeLine).toBe('Energy - Special');
    expect(row.attributes).toMatchObject({ category: 'Energy', energyType: 'Special' });
  });

  it('has no legalities when TCGdex gives none', () => {
    const bare = card('en', 'swsh3-1');
    delete bare.legal;
    expect(mapCard(bare).legalities).toEqual({});
  });

  it('ignores prices and the update time: the hash does not move with them', async () => {
    const plain = card('en', 'swsh3-136');
    const priced = {
      ...plain,
      updated: '2030-01-01T00:00:00Z',
      pricing: { cardmarket: { avg: 99 } },
      variants_detailed: [{ type: 'normal', pricing: { cardmarket: { avg: 99 } } }],
    };
    expect(await sourceHash(mapCard(priced))).toBe(await sourceHash(mapCard(plain)));
    expect(JSON.stringify(mapCard(priced))).not.toContain('pricing');
  });
});

describe('mapPrint', () => {
  it('maps number, rarity, artist, finishes and the image URLs', () => {
    const print = mapPrint(card('en', 'swsh3-136'), '2020-08-14');
    expect(print).toMatchObject({
      number: '136',
      rarity: 'Uncommon',
      artist: 'tetsuya koizumi',
      finishes: ['normal', 'reverse'],
      releasedOn: '2020-08-14',
    });
    expect(print.externalIds).toMatchObject({
      tcgdex: 'swsh3-136',
      tcgdex_images: {
        high: 'https://assets.tcgdex.net/en/swsh/swsh3/136/high.webp',
        low: 'https://assets.tcgdex.net/en/swsh/swsh3/136/low.webp',
      },
    });
  });

  it('maps all four variants in a fixed order', () => {
    expect(mapPrint(card('en', 'base1-4'), undefined).finishes).toEqual([
      'normal',
      'reverse',
      'holo',
      'first_edition',
    ]);
  });

  it('keeps the marketplace ids as a low-confidence guess, never as tcgplayer/cardmarket keys', () => {
    const { externalIds } = mapPrint(card('en', 'swsh3-136'), undefined);
    expect(externalIds).toMatchObject({
      tcgdex_marketplace: { mapping_confidence: 'low', cardmarket: 483559, tcgplayer: 219333 },
    });
    expect(externalIds).not.toHaveProperty('tcgplayer');
    expect(externalIds).not.toHaveProperty('cardmarket');
  });

  it('has no marketplace entry and no image for a card without them', () => {
    const bare = card('en', 'swsh3-1');
    delete bare.image;
    delete bare.variants_detailed;
    const { externalIds, releasedOn } = mapPrint(bare, undefined);
    expect(externalIds).toEqual({ tcgdex: 'swsh3-1' });
    expect(releasedOn).toBeNull();
  });
});

describe('mapLocalization', () => {
  it('takes name, text and image of the language the card was fetched in', () => {
    const de = mapLocalization(card('de', 'swsh3-136'), 'de');
    expect(de).toMatchObject({ lang: 'de', name: 'Wiesenior' });
    expect(de.text).toMatch(/^Wohl fühlen: Ziehe 3 Karten\./);
    expect(de.externalIds).toMatchObject({
      tcgdex_images: { high: 'https://assets.tcgdex.net/de/swsh/swsh3/136/high.webp' },
    });
  });
});
