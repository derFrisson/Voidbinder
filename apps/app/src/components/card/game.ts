import type { Game } from '@voidbinder/shared';
import type { usePalette } from '../palette';

// The game's colour field (docs/app/design.md): the soft tint behind a card, the full colour as a
// shape (fill or edge), never as text.
export const fieldClass: Record<Game, { soft: string; solid: string; edge: string }> = {
  pokemon: { soft: 'bg-pk-soft', solid: 'bg-pk', edge: 'border-l-pk' },
  yugioh: { soft: 'bg-yg-soft', solid: 'bg-yg', edge: 'border-l-yg' },
  mtg: { soft: 'bg-mg-soft', solid: 'bg-mg', edge: 'border-l-mg' },
  onepiece: { soft: 'bg-op-soft', solid: 'bg-op', edge: 'border-l-op' },
};

const key = { pokemon: 'pk', yugioh: 'yg', mtg: 'mg', onepiece: 'op' } as const;

/** The game's colour as a value, for SVG fills. */
export const fieldColor = (game: Game, palette: ReturnType<typeof usePalette>) =>
  palette[key[game]];
