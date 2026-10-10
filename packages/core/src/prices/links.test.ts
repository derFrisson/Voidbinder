import { describe, expect, it } from 'vitest';
import { marketplaceLinks } from './links.js';

describe('marketplaceLinks', () => {
  it('links one TCGplayer product per id, the finish only when the product is its alone', () => {
    const links = marketplaceLinks({
      game: 'yugioh',
      name: 'Dark Magician',
      setCode: 'LOB',
      mappings: [
        { source: 'tcgplayer', externalId: '21697', finish: 'first_edition' },
        { source: 'tcgplayer', externalId: '21697', finish: 'unlimited' },
        { source: 'tcgplayer', externalId: '99', finish: 'normal' },
        // Another source's id is not a TCGplayer product.
        { source: 'tcgplayer_scryfall', externalId: '5', finish: 'normal' },
      ],
    });
    expect(links.filter((l) => l.portal === 'tcgplayer')).toEqual([
      { portal: 'tcgplayer', url: 'https://www.tcgplayer.com/product/21697' },
      { portal: 'tcgplayer', url: 'https://www.tcgplayer.com/product/99', finish: 'normal' },
    ]);
  });

  it('links the Cardmarket product of a mapping, in the game of the print', () => {
    const links = marketplaceLinks({
      game: 'mtg',
      name: 'Lightning Bolt',
      setCode: 'msc',
      mappings: [
        { source: 'cardmarket', externalId: '892161', finish: 'normal' },
        { source: 'cardmarket', externalId: '892161', finish: 'foil' },
      ],
    });
    expect(links).toEqual([
      {
        portal: 'cardmarket',
        url: 'https://www.cardmarket.com/en/Magic/Products?idProduct=892161',
      },
      { portal: 'ebay', url: 'https://www.ebay.com/sch/i.html?_nkw=Lightning%20Bolt%20MSC' },
    ]);
  });

  it.each([
    ['yugioh', 'YuGiOh'],
    ['pokemon', 'Pokemon'],
    ['mtg', 'Magic'],
  ] as const)('searches Cardmarket by name without a product (%s)', (game, path) => {
    const links = marketplaceLinks({ game, name: 'Pikachu & Co', setCode: 'base1', mappings: [] });
    expect(links).toEqual([
      {
        portal: 'cardmarket',
        url: `https://www.cardmarket.com/en/${path}/Products/Search?searchString=Pikachu%20%26%20Co`,
      },
      { portal: 'ebay', url: 'https://www.ebay.com/sch/i.html?_nkw=Pikachu%20%26%20Co%20BASE1' },
    ]);
  });
});
