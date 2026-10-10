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
// - Card Nexus `https://cardnexus.com/en/search?q=<name> <set code>`: the site's search (the bare
//   /search redirects 307 to /en/search).
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
 * Games Card Nexus has offers for. Yu-Gi-Oh! is "coming soon" there, so it gets no link.
 * VB-121 replaces this constant with the live per-product offer check.
 */
export const CARDNEXUS_GAMES: readonly Game[] = ['mtg', 'pokemon', 'onepiece'];

/**
 * Card Nexus (search by name and set code; a product link follows with VB-121), TCGplayer (one
 * product: the one mapped to the print's listed finish, normal else the first, else the first
 * product), Cardmarket (product, else a search by name) and eBay (a search by name and set code).
 */
export function marketplaceLinks(print: {
  game: Game;
  name: string;
  setCode: string;
  finishes?: readonly string[];
  mappings: readonly ProductMapping[];
}): MarketplaceLink[] {
  const search = encodeURIComponent(`${print.name} ${print.setCode.toUpperCase()}`);
  const own = (source: string) => print.mappings.filter((m) => m.source === source);
  const listed = print.finishes?.includes('normal') ? 'normal' : print.finishes?.[0];
  const tcgplayer = own('tcgplayer');
  const tcgplayerProduct = (tcgplayer.find((m) => m.finish === listed) ?? tcgplayer[0])?.externalId;
  const cardmarket = `https://www.cardmarket.com/en/${CARDMARKET_GAME[print.game]}/Products`;
  const cardmarketIds = [...new Set(own('cardmarket').map((m) => m.externalId))];
  return [
    ...(CARDNEXUS_GAMES.includes(print.game)
      ? [{ portal: 'cardnexus' as const, url: `https://cardnexus.com/en/search?q=${search}` }]
      : []),
    ...(tcgplayerProduct
      ? [
          {
            portal: 'tcgplayer' as const,
            url: `https://www.tcgplayer.com/product/${encodeURIComponent(tcgplayerProduct)}`,
          },
        ]
      : []),
    ...(cardmarketIds.length
      ? cardmarketIds.map((id) => ({
          portal: 'cardmarket' as const,
          url: `${cardmarket}?idProduct=${encodeURIComponent(id)}`,
        }))
      : [
          {
            portal: 'cardmarket' as const,
            url: `${cardmarket}/Search?searchString=${encodeURIComponent(print.name)}`,
          },
        ]),
    { portal: 'ebay' as const, url: `https://www.ebay.com/sch/i.html?_nkw=${search}` },
  ];
}
