import { cardAspect, type CardFormat, type Game } from '@voidbinder/shared';
import { Image, View, type ImageSourcePropType } from 'react-native';
import mtg from '../../../assets/backs/mtg.webp';
import onepiece from '../../../assets/backs/onepiece.webp';
import pokemon from '../../../assets/backs/pokemon.webp';
import yugioh from '../../../assets/backs/yugioh.webp';
import { useT } from '../../i18n';

// Bundled, so the placeholder shows offline and before the network answers (VB-120); the same
// files are on img.voidbinder.de under images/backs/<game>/ (apps/api/scripts/fetch-card-backs.ts).
const backs: Record<Game, ImageSourcePropType> = { mtg, onepiece, pokemon, yugioh };

/**
 * The game's card back in the print's format box: the picture while a print has none (VB-120).
 * `className` replaces the default width and corners.
 */
export function CardBack({
  game,
  format,
  className = 'w-full rounded-lg',
}: {
  game: Game;
  format?: CardFormat | undefined;
  className?: string;
}) {
  const t = useT();
  // The box carries the size: a bundled source brings its pixel size as the Image's own width
  // and height, which would win over a class.
  return (
    <View
      role="img"
      aria-label={t.card.noImage}
      style={{ aspectRatio: cardAspect(format) }}
      className={`overflow-hidden ${className}`}
    >
      <Image
        aria-hidden
        source={backs[game]}
        resizeMode="contain"
        style={{ width: '100%', height: '100%' }}
      />
    </View>
  );
}
