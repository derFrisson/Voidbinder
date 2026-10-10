import type { Game } from '@voidbinder/shared';

/** Builds a stable, game-scoped card key, e.g. `pokemon:sv1-25`. */
export function cardKey(game: Game, setCode: string, number: string): string {
  const set = setCode.trim().toLowerCase();
  const num = number.trim().toLowerCase();
  if (!set || !num) throw new Error('setCode and number are required');
  return `${game}:${set}-${num}`;
}

export * from './prices/index.js';
export type * from './platform/index.js';
export * from './collection/index.js';
export * from './decks/index.js';
