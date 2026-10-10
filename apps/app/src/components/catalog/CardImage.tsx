import { cardAspect, type CardFormat, type Game } from '@voidbinder/shared';
import { useState } from 'react';
import { Image, Platform, View } from 'react-native';
import { imageHost } from '../../security-headers';
import { CardBack } from '../card/CardBack';
import { FoilSheen } from '../card/FoilSheen';

const frame: Record<Game, string> = {
  pokemon: 'border-pk bg-pk-soft',
  yugioh: 'border-yg bg-yg-soft',
  mtg: 'border-mg bg-mg-soft',
  onepiece: 'border-op bg-op-soft',
};

/** Width of the R2 `sm` renditions. */
const SM_WIDTH = 320;

/** Only our own image host: any other URL would be a CSP violation per tile, so it gets the frame. */
function isAllowedImage(uri: string): boolean {
  try {
    const url = new URL(uri);
    return url.protocol === 'https:' && url.host === imageHost;
  } catch {
    return false;
  }
}

/**
 * A card's picture, or the game's card back when there is none (or it fails to load: sources can
 * be missing, and the CSP admits only our own image host; VB-120). On the web a real
 * `<img>` so it can load lazily and reserve its size; react-native-web's Image has neither.
 */
export function CardImage({ uri, ...props }: CardImageProps) {
  // A new uri (the grid re-uses the tile on a page change) starts over instead of keeping the failure.
  return <Picture key={uri} uri={uri} {...props} />;
}

interface CardImageProps {
  uri: string | null;
  alt: string;
  game: Game;
  /** The box's aspect (`CARD_FORMATS`); the image is contained, never cropped. */
  format: CardFormat;
  /** A foil copy (`isFoil`): the picture gets the static sheen (VB-112). */
  foil?: boolean;
  className?: string;
}

function Picture({ uri, alt, game, format, foil, className = '' }: CardImageProps) {
  const [failed, setFailed] = useState(false);
  const shown = uri && !failed && isAllowedImage(uri);
  // The R2 `sm` rendition's size (320 px wide, 466 high for Yu-Gi-Oh!): `<img>` reserves the
  // box before it loads.
  const width = SM_WIDTH;
  const height = Math.round(SM_WIDTH / cardAspect(format));
  return (
    <View
      style={{ aspectRatio: cardAspect(format) }}
      className={`w-full overflow-hidden rounded-lg border-2 ${frame[game]} ${className}`}
    >
      {shown && Platform.OS === 'web' ? (
        <img
          src={uri}
          alt={alt}
          width={width}
          height={height}
          loading="lazy"
          decoding="async"
          onError={() => setFailed(true)}
          style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
        />
      ) : shown ? (
        <Image
          source={{ uri, width, height }}
          accessibilityLabel={alt}
          onError={() => setFailed(true)}
          className="h-full w-full"
          resizeMode="contain"
        />
      ) : (
        <CardBack game={game} format={format} />
      )}
      {shown && foil && <FoilSheen />}
    </View>
  );
}
