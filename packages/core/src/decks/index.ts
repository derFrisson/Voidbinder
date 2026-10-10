import type {
  Currency,
  DeckGame,
  DeckProblem,
  DeckRules,
  DeckZone,
  EntryPrice,
  MissingCard,
  ValueGroup,
} from '@voidbinder/shared/api';
import { DECK_FORMATS } from '@voidbinder/shared/api';
import { priceEntry, valueOf, type ValuedItem } from '../collection/value.js';
import { SOURCE_PREFERENCE, type PriceLike } from '../prices/index.js';
import { zoneCounts, type Curve, type DeckCard, type DeckStat, type GameRules } from './common.js';
import { magic } from './magic.js';
import { pokemon } from './pokemon.js';
import { yugioh } from './yugioh.js';

// Deck rules (VB-34): pure, one file per game. The API feeds them the deck's cards, the user's
// collection and the prices, and returns their verdict with the deck.

export type { Curve, DeckCard, DeckStat } from './common.js';
export { STANDARD_MARKS } from './pokemon.js';
export { isExtraDeck } from './yugioh.js';

const GAMES: Record<DeckGame, GameRules> = { mtg: magic, pokemon, yugioh };

export const deckRules = (game: DeckGame, format: string): DeckRules => GAMES[game].rules(format);

export const deckGroup = (game: DeckGame, card: DeckCard): string => GAMES[game].group(card);

export const deckStat = (game: DeckGame, card: DeckCard): DeckStat | null => GAMES[game].stat(card);

/** The rules' verdict on a deck: problems, limits, copies per zone and the curve. */
export function analyzeDeck(
  game: DeckGame,
  format: string,
  cards: readonly DeckCard[],
): {
  valid: boolean;
  problems: DeckProblem[];
  rules: DeckRules;
  counts: Partial<Record<DeckZone, number>>;
  curve: Curve;
} {
  const rules = GAMES[game];
  const problems: DeckProblem[] = (DECK_FORMATS[game] as readonly string[]).includes(format)
    ? rules.problems(cards, format)
    : [{ code: 'unknown_format', params: { format } }];
  return {
    valid: problems.length === 0,
    problems,
    rules: rules.rules(format),
    counts: zoneCounts(cards),
    curve: rules.curve(cards),
  };
}

export interface PrintPrices {
  printId: string;
  finishes: readonly string[];
  prices: readonly (PriceLike & { observedAt: string })[];
}

/**
 * The price a card is bought at: of all its prints, the near-mint display price (core's
 * `pickDisplayPrice`) from the source the currency prefers most that any print has, the
 * cheapest there. null when no print has a price.
 */
export function cheapestPrice(
  prints: readonly PrintPrices[],
  currency: Currency,
): { printId: string; price: EntryPrice } | null {
  const order = SOURCE_PREFERENCE[currency];
  let best: { printId: string; price: EntryPrice } | null = null;
  for (const p of prints) {
    const price = priceEntry(p.prices, { currency, finishes: p.finishes, condition: 'NM' });
    if (!price) continue;
    const rank = order.indexOf(price.source);
    const bestRank = best ? order.indexOf(best.price.source) : Infinity;
    if (!best || rank < bestRank || (rank === bestRank && price.unitCents < best.price.unitCents))
      best = { printId: p.printId, price };
  }
  return best;
}

/** A deck line for the comparison: what the rules read plus the print and price shown. */
export interface PricedDeckCard {
  cardId: string;
  name: string;
  label?: string;
  quantity: number;
  print: { id: string; setCode: string; number: string } | null;
  price: EntryPrice | null;
}

/**
 * The cards the collection lacks: per name (any print counts, every zone together), the copies
 * the deck needs against the copies owned, with the line's price. Ordered as the deck lists them.
 */
export function missingCards(
  cards: readonly PricedDeckCard[],
  ownedByName: ReadonlyMap<string, number>,
): { missing: MissingCard[]; value: ValueGroup } {
  const byName = new Map<string, { card: PricedDeckCard; needed: number }>();
  for (const c of cards) {
    const seen = byName.get(c.name);
    if (seen) seen.needed += c.quantity;
    else byName.set(c.name, { card: c, needed: c.quantity });
  }
  const missing: MissingCard[] = [];
  const priced: ValuedItem[] = [];
  for (const [name, { card, needed }] of byName) {
    const owned = ownedByName.get(name) ?? 0;
    if (owned >= needed) continue;
    priced.push({ quantity: needed - owned, price: card.price });
    missing.push({
      cardId: card.cardId,
      name: card.label ?? name,
      printId: card.print?.id ?? null,
      setCode: card.print?.setCode ?? null,
      number: card.print?.number ?? null,
      needed,
      owned,
      unitPriceCents: card.price?.unitCents ?? null,
      currency: card.price?.currency ?? null,
      source: card.price?.source ?? null,
      observedAt: card.price?.observedAt ?? null,
    });
  }
  return { missing, value: valueOf(priced) };
}
export type * from './store.js';
