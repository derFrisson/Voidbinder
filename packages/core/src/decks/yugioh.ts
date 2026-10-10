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

// Yu-Gi-Oh! (Advanced, the TCG list): main 40 to 60, extra and side up to 15, three of a card,
// fewer by the ban list (`cards.legalities.tcg`, YGOPRODeck's `ban_tcg`).

/** Fusion, Synchro, Xyz and Link monsters (Pendulum ones too) live in the Extra Deck. */
export const isExtraDeck = (card: DeckCard) =>
  /\b(Fusion|Synchro|XYZ|Link)\b/i.test(card.typeLine ?? '');

/** Copies the TCG list allows; null: not on the TCG list at all (an OCG-only card). */
function allowed(card: DeckCard): number | null {
  const status = card.legalities.tcg?.toLowerCase();
  if (status === undefined) return null;
  if (status === 'banned' || status === 'forbidden') return 0;
  if (status === 'limited') return 1;
  if (status === 'semi-limited') return 2;
  return 3;
}

const rules = (): DeckRules => ({
  zones: { main: { min: 40, max: 60 }, extra: { max: 15 }, side: { max: 15 } },
  copies: 3,
});

function problems(cards: readonly DeckCard[]): DeckProblem[] {
  const r = rules();
  return [
    ...zoneProblems(cards, r),
    ...sizeProblems(cards, r),
    // Extra Deck monsters never go into the main deck, nothing else into the extra one.
    ...cards
      .filter(
        (c) => (c.zone === 'main' && isExtraDeck(c)) || (c.zone === 'extra' && !isExtraDeck(c)),
      )
      .map((c) => ({
        code: 'wrong_zone' as const,
        cardId: c.cardId,
        params: { name: label(c), zone: c.zone },
      })),
    ...perName(cards, (c) => {
      const n = allowed(c);
      if (n === null) return { code: 'not_legal', cardId: c.cardId, params: { name: label(c) } };
      return n === 0 ? { code: 'banned', cardId: c.cardId, params: { name: label(c) } } : null;
    }),
    // A banned or unlisted card is said above; the limit counts the others.
    ...copyProblems(cards, (c) => allowed(c) || Infinity),
  ];
}

function group(card: DeckCard): string {
  const type = card.typeLine ?? '';
  if (/\bSpell\b/.test(type)) return 'spell';
  if (/\bTrap\b/.test(type)) return 'trap';
  return 'monster';
}

export const yugioh: GameRules = {
  rules,
  problems,
  group,
  stat: (card) => {
    const a = card.attributes;
    const link = num(a.linkval);
    if (link !== null) return { kind: 'link', value: link };
    const rank = num(a.rank);
    if (rank !== null) return { kind: 'rank', value: rank };
    const level = num(a.level);
    return level === null ? null : { kind: 'level', value: level };
  },
  curve: (cards) => ({
    kind: 'level',
    buckets: buckets(
      cards.flatMap((c) => {
        const level = c.zone === 'main' ? num(c.attributes.level) : null;
        return level === null ? [] : [{ value: level, quantity: c.quantity }];
      }),
      ['1', '2', '3', '4', '5', '6', '7', '8+'],
      1,
    ),
  }),
};
