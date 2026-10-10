import type { Game } from '@voidbinder/shared';
import { useState } from 'react';
import { Image, Platform, Text, View } from 'react-native';

const frame: Record<Game, string> = {
  pokemon: 'border-pk bg-pk-soft',
  yugioh: 'border-yg bg-yg-soft',
  mtg: 'border-mg bg-mg-soft',
  onepiece: 'border-op bg-op-soft',
};

/** Card art is 5:7; the R2 `sm` renditions are 250 x 350. */
const WIDTH = 250;
const HEIGHT = 350;

/**
 * A card's picture, or the game-coloured frame with the number when there is none (or it fails to
 * load: sources can be missing, and the CSP admits only our own image host). On the web a real
 * `<img>` so it can load lazily and reserve its size; react-native-web's Image has neither.
 */
export function CardImage({
  uri,
  alt,
  game,
  number,
  className = '',
}: {
  uri: string | null;
  alt: string;
  game: Game;
  number: string;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);
  const shown = uri && !failed;
  return (
    <View
      className={`aspect-[5/7] w-full overflow-hidden rounded-lg border-2 ${frame[game]} ${className}`}
    >
      {shown && Platform.OS === 'web' ? (
        <img
          src={uri}
          alt={alt}
          width={WIDTH}
          height={HEIGHT}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
        />
      ) : shown ? (
        <Image
          source={{ uri, width: WIDTH, height: HEIGHT }}
          accessibilityLabel={alt}
          onError={() => setFailed(true)}
          className="h-full w-full"
          resizeMode="cover"
        />
      ) : (
        <View className="flex-1 items-center justify-center p-1">
          <Text aria-hidden className="font-mono text-xs font-medium text-ink-2">
            {number}
          </Text>
        </View>
      )}
    </View>
  );
}
