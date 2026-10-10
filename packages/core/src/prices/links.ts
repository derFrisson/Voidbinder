import type { Game } from '@voidbinder/shared';
import type { MarketplaceLink } from '@voidbinder/shared/api';

// Marketplace links of a print (VB-115), built here so the app never composes marketplace URLs.
// Formats (checked 2026-10-10):
// - TCGplayer `https://www.tcgplayer.com/product/<productId>`: GET 200.
// - Cardmarket `https://www.cardmarket.com/en/<Game>/Products?idProduct=<id>`: the form of
//   Scryfall's `purchase_uris.cardmarket` (without its referrer parameters), whose id is the
//   `cardmarket_id` the price importer maps; `…/Products/Search?searchString=<name>` is the
//   site's own search form. Both answer a scripted GET with 403 (bot wall), so not verified by
//   request.
// - eBay `https://www.ebay.com/sch/i.html?_nkw=<name> <set code>`: the site's search form, also
//   403 to a script. Plain, no affiliate parameters.

/** Cardmarket's path segment per game. */
const CARDMARKET_GAME: Record<Game, string> = {
  mtg: 'Magic',
  yugioh: 'YuGiOh',
  pokemon: 'Pokemon',
  onepiece: 'OnePiece',
};

/** A `price_mappings` row: which product at `source` is the print in `finish`. */
export interface ProductMapping {
  source: string;
  externalId: string;
  finish: string;
}

/**
 * One link per distinct product (finishes sharing a product get one link without `finish`);
 * Cardmarket without a product falls back to a search by name, eBay is always a search by name
 * and set code.
 */
export function marketplaceLinks(print: {
  game: Game;
  name: string;
  setCode: string;
  mappings: readonly ProductMapping[];
}): MarketplaceLink[] {
  const products = (source: string) => {
    const finishes = new Map<string, Set<string>>();
    for (const m of print.mappings)
      if (m.source === source)
        finishes.set(m.externalId, (finishes.get(m.externalId) ?? new Set()).add(m.finish));
    return [...finishes].map(([id, f]) => ({
      id: encodeURIComponent(id),
      ...(f.size === 1 ? { finish: [...f][0] } : {}),
    }));
  };
  const cardmarket = `https://www.cardmarket.com/en/${CARDMARKET_GAME[print.game]}/Products`;
  const cardmarketProducts = products('cardmarket');
  return [
    ...products('tcgplayer').map(({ id, ...f }) => ({
      portal: 'tcgplayer' as const,
      url: `https://www.tcgplayer.com/product/${id}`,
      ...f,
    })),
    ...(cardmarketProducts.length
      ? cardmarketProducts.map(({ id, ...f }) => ({
          portal: 'cardmarket' as const,
          url: `${cardmarket}?idProduct=${id}`,
          ...f,
        }))
      : [
          {
            portal: 'cardmarket' as const,
            url: `${cardmarket}/Search?searchString=${encodeURIComponent(print.name)}`,
          },
        ]),
    {
      portal: 'ebay',
      url: `https://www.ebay.com/sch/i.html?_nkw=${encodeURIComponent(`${print.name} ${print.setCode.toUpperCase()}`)}`,
    },
  ];
}
