import { cardAspect, type CardFormat, type Game } from '@voidbinder/shared';
import { useState } from 'react';
import { Image, View } from 'react-native';
import { CardBack } from './CardBack';
import { FoilSheen } from './FoilSheen';

/**
 * A card image in its format's box (`CARD_FORMATS`, standard 63:88 when unknown), contained so
 * no edge is cut, or the game's card back when there is none or it fails to load (VB-120, no sheen). `label` is the alt
 * text; without it the image is decorative (the link around it is named). A `foil` copy gets the
 * sheen (VB-112), `live` on the card page's large image.
 */
export function CardImage({
  uri,
  game,
  label,
  format,
  foil = false,
  live = false,
  className = '',
}: {
  uri: string | null;
  game: Game;
  label?: string;
  format?: CardFormat | undefined;
  foil?: boolean;
  live?: boolean;
  className?: string;
}) {
  const box = { aspectRatio: cardAspect(format) };
  const [failed, setFailed] = useState<string | null>(null);
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true };
  if (!uri || failed === uri)
    return <CardBack game={game} format={format} className={`w-full rounded-lg ${className}`} />;
  const image = (
    <Image
      {...a11y}
      source={{ uri }}
      onError={() => setFailed(uri)}
      resizeMode="contain"
      style={box}
      className={`w-full rounded-lg ${className}`}
    />
  );
  if (!foil) return image;
  return (
    <View className={`w-full overflow-hidden rounded-lg ${className}`}>
      {image}
      <FoilSheen live={live} />
    </View>
  );
}
