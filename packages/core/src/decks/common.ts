import type { DeckAnalysis, DeckProblem, DeckRules, DeckZone } from '@voidbinder/shared/api';

// What every game's rules share: the card shape they read, zone sizes and copies by name.

/** A deck line as the rules read it: the card's catalog fields, its zone and its copies. */
export interface DeckCard {
  cardId: string;
  /** English canonical name: copies are counted by it. */
  name: string;
  /** The name the user reads (their language); in the problems' params. */
  label?: string;
  typeLine: string | null;
  text: string | null;
  attributes: Record<string, unknown>;
  legalities: Record<string, string>;
  zone: DeckZone;
  quantity: number;
}

/** A card's own list stat: level, rank, link rating, mana value or HP. */
export interface DeckStat {
  kind: 'level' | 'rank' | 'link' | 'mana' | 'hp';
  value: number;
}

export interface Curve {
  kind: 'mana' | 'energy' | 'level';
  buckets: { label: string; count: number }[];
}

/** One game's rules (magic.ts, pokemon.ts, yugioh.ts). */
export interface GameRules {
  rules(format: string): DeckRules;
  problems(cards: readonly DeckCard[], format: string): DeckProblem[];
  /** Copies of the card's name the format allows (Infinity: any number, 0: banned). */
  limit(card: DeckCard, format: string): number;
  group(card: DeckCard): string;
  stat(card: DeckCard): DeckStat | null;
  curve(cards: readonly DeckCard[]): Curve;
}

export const label = (card: DeckCard) => card.label ?? card.name;

export const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;

export function zoneCounts(cards: readonly DeckCard[]): DeckAnalysis['counts'] {
  const counts: DeckAnalysis['counts'] = {};
  for (const c of cards) counts[c.zone] = (counts[c.zone] ?? 0) + c.quantity;
  return counts;
}

/** Each zone against its limits: `wrong_size` where min equals max, else `too_few` / `too_many`. */
export function sizeProblems(cards: readonly DeckCard[], rules: DeckRules): DeckProblem[] {
  const counts = zoneCounts(cards);
  const out: DeckProblem[] = [];
  for (const [zone, limit] of Object.entries(rules.zones)) {
    if (!limit) continue;
    const { min, max } = limit;
    const count = counts[zone as DeckZone] ?? 0;
    if (min !== undefined && min === max) {
      if (count !== min) out.push({ code: 'wrong_size', params: { zone, count, size: min } });
    } else if (min !== undefined && count < min) {
      out.push({ code: 'too_few', params: { zone, count, min } });
    } else if (max !== undefined && count > max) {
      out.push({ code: 'too_many', params: { zone, count, max } });
    }
  }
  return out;
}

/** A card in a zone the format has not got (a sideboard in Pokémon, a commander in Modern). */
export function zoneProblems(cards: readonly DeckCard[], rules: DeckRules): DeckProblem[] {
  return cards
    .filter((c) => !(c.zone in rules.zones))
    .map((c) => ({
      code: 'wrong_zone' as const,
      cardId: c.cardId,
      params: { name: label(c), zone: c.zone },
    }));
}

/** Copies per name across every zone, over `limit(card)`; one problem per name. */
export function copyProblems(
  cards: readonly DeckCard[],
  limit: (card: DeckCard) => number,
): DeckProblem[] {
  const byName = new Map<string, { card: DeckCard; count: number }>();
  for (const c of cards) {
    const seen = byName.get(c.name);
    if (seen) seen.count += c.quantity;
    else byName.set(c.name, { card: c, count: c.quantity });
  }
  const out: DeckProblem[] = [];
  for (const { card, count } of byName.values()) {
    const max = limit(card);
    if (count > max)
      out.push({
        code: 'too_many_copies',
        cardId: card.cardId,
        params: { name: label(card), count, limit: max },
      });
  }
  return out;
}

/** One problem per card name (a name in two zones is one card). */
export function perName(
  cards: readonly DeckCard[],
  problem: (card: DeckCard) => DeckProblem | null,
): DeckProblem[] {
  const seen = new Set<string>();
  const out: DeckProblem[] = [];
  for (const c of cards) {
    if (seen.has(c.name)) continue;
    seen.add(c.name);
    const p = problem(c);
    if (p) out.push(p);
  }
  return out;
}

/** Counts per bucket: `labels` in order, values past the last one go into it ("7+"). */
export function buckets(
  values: { value: number; quantity: number }[],
  labels: readonly string[],
  first: number,
): Curve['buckets'] {
  const out = labels.map((l) => ({ label: l, count: 0 }));
  for (const { value, quantity } of values) {
    const at = Math.min(Math.max(Math.floor(value) - first, 0), out.length - 1);
    const bucket = out[at];
    if (bucket) bucket.count += quantity;
  }
  return out;
}
