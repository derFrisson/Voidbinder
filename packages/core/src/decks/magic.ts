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

// Magic: The Gathering. Legality is Scryfall's per format (`cards.legalities`: legal, restricted,
// banned, not_legal); colour identity is `attributes.color_identity`.

/** The first face's type line ("Creature — Elf // Sorcery" → "Creature — Elf"). */
const frontType = (card: DeckCard) => (card.typeLine ?? '').split(' // ')[0] ?? '';

const isBasicLand = (card: DeckCard) => /\bBasic\b.*\bLand\b/.test(frontType(card));

const NUMBER_WORDS: Record<string, number> = {
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};

/**
 * The copies the card's own text allows: "A deck can have any number of cards named …"
 * (Relentless Rats) is Infinity, "… up to seven cards named …" (Seven Dwarves, Nazgûl's nine) the
 * number; null without such a line.
 */
function printedLimit(card: DeckCard): number | null {
  const m = /A deck can have (any number of|up to (\w+)) cards named/i.exec(card.text ?? '');
  if (!m) return null;
  return m[2] ? (NUMBER_WORDS[m[2].toLowerCase()] ?? null) : Infinity;
}

const canCommand = (card: DeckCard) =>
  /\bLegendary\b.*\bCreature\b/.test(frontType(card)) ||
  /can be your commander/i.test(card.text ?? '');

const identity = (card: DeckCard): string[] | null => {
  const v = card.attributes.color_identity;
  return Array.isArray(v) ? (v as string[]) : null;
};

function rules(format: string): DeckRules {
  // ponytail: one commander; partners and backgrounds (two in the zone, 98 in the deck) are a
  // follow-up.
  if (format === 'commander')
    return { zones: { commander: { min: 1, max: 1 }, main: { min: 99, max: 99 } }, copies: 1 };
  return { zones: { main: { min: 60 }, side: { max: 15 } }, copies: 4 };
}

function problems(cards: readonly DeckCard[], format: string): DeckProblem[] {
  const r = rules(format);
  const commanders = cards.filter((c) => c.zone === 'commander');
  const out: DeckProblem[] = [...zoneProblems(cards, r)];

  if (format === 'commander') {
    if (!commanders.length) out.push({ code: 'commander_missing', params: {} });
    for (const c of commanders)
      if (!canCommand(c))
        out.push({ code: 'commander_invalid', cardId: c.cardId, params: { name: label(c) } });
    // The commander zone's own size: a missing commander is said above already.
    out.push(
      ...sizeProblems(cards, r).filter(
        (p) => !(p.params.zone === 'commander' && commanders.length === 0),
      ),
    );
    // Colour identity, when the data has it for the commander.
    const allowed = commanders.length === 1 ? identity(commanders[0] as DeckCard) : null;
    if (allowed)
      out.push(
        ...perName(cards, (c) =>
          c.zone !== 'commander' && identity(c)?.some((colour) => !allowed.includes(colour))
            ? { code: 'colour_identity', cardId: c.cardId, params: { name: label(c) } }
            : null,
        ),
      );
  } else {
    out.push(...sizeProblems(cards, r));
  }

  out.push(
    ...perName(cards, (c) => {
      const status = c.legalities[format];
      if (status === 'legal' || status === 'restricted') return null;
      return {
        code: status === 'banned' ? 'banned' : 'not_legal',
        cardId: c.cardId,
        params: { name: label(c) },
      };
    }),
    // A banned card is reported as banned above; its copy limit of 0 is for the stepper only.
    ...copyProblems(
      cards.filter((c) => c.legalities[format] !== 'banned'),
      (c) => limit(c, format),
    ),
  );
  return out;
}

function limit(card: DeckCard, format: string): number {
  if (isBasicLand(card)) return Infinity;
  const status = card.legalities[format];
  if (status === 'banned') return 0;
  return printedLimit(card) ?? (status === 'restricted' ? 1 : rules(format).copies);
}

const GROUPS = [
  'creature',
  'planeswalker',
  'battle',
  'instant',
  'sorcery',
  'artifact',
  'enchantment',
  'land',
] as const;

function group(card: DeckCard): string {
  const type = frontType(card).toLowerCase();
  return GROUPS.find((g) => type.includes(g)) ?? 'other';
}

export const magic: GameRules = {
  rules,
  problems,
  limit,
  group,
  stat: (card) => {
    const cmc = num(card.attributes.cmc);
    return group(card) === 'land' || cmc === null ? null : { kind: 'mana', value: cmc };
  },
  curve: (cards) => ({
    kind: 'mana',
    buckets: buckets(
      cards.flatMap((c) => {
        const cmc = num(c.attributes.cmc);
        return (c.zone === 'main' || c.zone === 'commander') && cmc !== null && group(c) !== 'land'
          ? [{ value: cmc, quantity: c.quantity }]
          : [];
      }),
      ['0', '1', '2', '3', '4', '5', '6', '7+'],
      0,
    ),
  }),
};
