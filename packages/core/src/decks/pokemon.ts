import type { DeckProblem, DeckRules } from '@voidbinder/shared/api';
import {
  buckets,
  copyProblems,
  label,
  num,
  perName,
  sizeProblems,
  zoneProblems,
  type DeckCard,
  type GameRules,
} from './common.js';

// Pokémon TCG: 60 cards exactly, four of a name, at least one Basic Pokémon. Legality is TCGdex's
// `legal.standard` / `legal.expanded` (`cards.legalities`); without it, the regulation mark.

/**
 * Regulation marks legal in Standard, for a card TCGdex gives no flag. ponytail: the marks after
 * the 2026 rotation as far as known; TCGdex's own flag (every card on dev has one) always wins,
 * so this only matters for a card imported without it. Update with each rotation.
 */
export const STANDARD_MARKS: readonly string[] = ['H', 'I', 'J'];

const category = (card: DeckCard) => String(card.attributes.category ?? '').toLowerCase();

/** Basic Energy: any number, legal in every format. */
const isBasicEnergy = (card: DeckCard) =>
  category(card) === 'energy' && card.attributes.energyType === 'Normal';

const isBasicPokemon = (card: DeckCard) =>
  category(card) === 'pokemon' && card.attributes.stage === 'Basic';

function legal(card: DeckCard, format: string): boolean {
  if (isBasicEnergy(card)) return true;
  const status = card.legalities[format];
  if (status !== undefined) return status === 'legal';
  const mark = card.attributes.regulationMark;
  // Expanded reaches back to Black & White, before regulation marks: no flag, no verdict.
  return format !== 'standard' || (typeof mark === 'string' && STANDARD_MARKS.includes(mark));
}

const rules = (): DeckRules => ({ zones: { main: { min: 60, max: 60 } }, copies: 4 });

function problems(cards: readonly DeckCard[], format: string): DeckProblem[] {
  const r = rules();
  const main = cards.filter((c) => c.zone === 'main');
  return [
    ...zoneProblems(cards, r),
    ...sizeProblems(cards, r),
    ...(main.length && !main.some(isBasicPokemon)
      ? [{ code: 'no_basic_pokemon' as const, params: {} }]
      : []),
    ...perName(cards, (c) =>
      legal(c, format) ? null : { code: 'not_legal', cardId: c.cardId, params: { name: label(c) } },
    ),
    ...copyProblems(cards, (c) => (isBasicEnergy(c) ? Infinity : r.copies)),
  ];
}

/** The energy the cheapest attack costs; null for a card without attacks. */
function attackCost(card: DeckCard): number | null {
  const attacks = card.attributes.attacks;
  if (!Array.isArray(attacks) || !attacks.length) return null;
  return Math.min(
    ...attacks.map((a: { cost?: unknown }) => (Array.isArray(a.cost) ? a.cost.length : 0)),
  );
}

export const pokemon: GameRules = {
  rules,
  problems,
  group: (card) => category(card) || 'other',
  stat: (card) => {
    const hp = num(card.attributes.hp);
    return hp === null ? null : { kind: 'hp', value: hp };
  },
  curve: (cards) => ({
    kind: 'energy',
    buckets: buckets(
      cards.flatMap((c) => {
        const cost = c.zone === 'main' ? attackCost(c) : null;
        return cost === null ? [] : [{ value: cost, quantity: c.quantity }];
      }),
      ['0', '1', '2', '3', '4+'],
      0,
    ),
  }),
};
