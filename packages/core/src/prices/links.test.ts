import { describe, expect, it } from 'vitest';
import { marketplaceLinks } from './links.js';

describe('marketplaceLinks', () => {
  it('links one TCGplayer product: the listed finish, else the first product', () => {
    const mappings = [
      { source: 'tcgplayer', externalId: '21697', finish: 'first_edition' },
      { source: 'tcgplayer', externalId: '99', finish: 'normal' },
      { source: 'tcgplayer', externalId: '98', finish: 'foil' },
      // Another source's id is not a TCGplayer product.
      { source: 'tcgplayer_scryfall', externalId: '5', finish: 'normal' },
    ];
    const tcg = (finishes: string[]) =>
      marketplaceLinks({ game: 'mtg', name: 'X', setCode: 'a', finishes, mappings }).filter(
        (l) => l.portal === 'tcgplayer',
      );
    const url = (id: string) => [
      { portal: 'tcgplayer', url: `https://www.tcgplayer.com/product/${id}` },
    ];
    expect(tcg(['foil', 'normal'])).toEqual(url('99'));
    expect(tcg(['foil'])).toEqual(url('98'));
    expect(tcg(['holo'])).toEqual(url('21697'));
    expect(tcg([])).toEqual(url('21697'));
  });

  it('puts Card Nexus first, except for Yu-Gi-Oh!', () => {
    const portals = (game: 'mtg' | 'yugioh') =>
      marketplaceLinks({ game, name: 'Bolt & Co', setCode: 'lea', mappings: [] }).map(
        (l) => l.portal,
      );
    expect(portals('mtg')).toEqual(['cardnexus', 'cardmarket', 'ebay']);
    expect(portals('yugioh')).toEqual(['cardmarket', 'ebay']);
    expect(
      marketplaceLinks({ game: 'mtg', name: 'Bolt & Co', setCode: 'lea', mappings: [] })[0],
    ).toEqual({
      portal: 'cardnexus',
      url: 'https://cardnexus.com/en/search?q=Bolt%20%26%20Co%20LEA',
    });
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
    expect(links.filter((l) => l.portal !== 'cardnexus')).toEqual([
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
    expect(links.filter((l) => l.portal !== 'cardnexus')).toEqual([
      {
        portal: 'cardmarket',
        url: `https://www.cardmarket.com/en/${path}/Products/Search?searchString=Pikachu%20%26%20Co`,
      },
      { portal: 'ebay', url: 'https://www.ebay.com/sch/i.html?_nkw=Pikachu%20%26%20Co%20BASE1' },
    ]);
  });
});
