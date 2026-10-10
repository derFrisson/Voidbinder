import type { Game } from '@voidbinder/shared';
import type { usePalette } from '../palette';

// The game's colour field (docs/app/design.md): the soft tint behind a card, the full colour as a
// shape, never as text.
export const fieldClass: Record<Game, { soft: string; solid: string }> = {
  pokemon: { soft: 'bg-pk-soft', solid: 'bg-pk' },
  yugioh: { soft: 'bg-yg-soft', solid: 'bg-yg' },
  mtg: { soft: 'bg-mg-soft', solid: 'bg-mg' },
  onepiece: { soft: 'bg-op-soft', solid: 'bg-op' },
};

const key = { pokemon: 'pk', yugioh: 'yg', mtg: 'mg', onepiece: 'op' } as const;

/** The game's colour as a value, for SVG fills. */
export const fieldColor = (game: Game, palette: ReturnType<typeof usePalette>) =>
  palette[key[game]];
