import type { Game } from '@voidbinder/shared';
import { Text, View } from 'react-native';

export const field: Record<Game, { tint: string; dot: string }> = {
  pokemon: { tint: 'bg-pk-soft', dot: 'bg-pk' },
  yugioh: { tint: 'bg-yg-soft', dot: 'bg-yg' },
  mtg: { tint: 'bg-mg-soft', dot: 'bg-mg' },
  onepiece: { tint: 'bg-op-soft', dot: 'bg-op' },
};

/** The game's name on a pill with its colour dot: the header of a set and of a game's sets list. */
export function GameChip({ game, name }: { game: Game; name: string }) {
  return (
    <View className="flex-row items-center gap-2 self-start rounded-full bg-surface px-3.5 py-1.5">
      <View className={`h-2.5 w-2.5 rounded-full ${field[game].dot}`} />
      <Text className="font-display text-sm font-semibold text-ink">{name}</Text>
    </View>
  );
}
