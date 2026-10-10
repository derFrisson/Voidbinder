import { cardAspect, type CardFormat } from '@voidbinder/shared';
import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useT } from '../../i18n';
import { FoilSheen } from './FoilSheen';

/**
 * A card image in its format's box (`CARD_FORMATS`, standard 63:88 when unknown), contained so
 * no edge is cut, or an empty frame when there is none or it fails to load. `label` is the alt
 * text; without it the image is decorative (the link around it is named). A `foil` copy gets the
 * sheen (VB-112), `live` on the card page's large image.
 */
export function CardImage({
  uri,
  label,
  format,
  foil = false,
  live = false,
  className = '',
}: {
  uri: string | null;
  label?: string;
  format?: CardFormat | undefined;
  foil?: boolean;
  live?: boolean;
  className?: string;
}) {
  const t = useT();
  const box = { aspectRatio: cardAspect(format) };
  const [failed, setFailed] = useState<string | null>(null);
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true };
  if (!uri || failed === uri) {
    return (
      <View
        {...a11y}
        style={box}
        className={`w-full items-center justify-center rounded-lg border border-dashed border-line bg-surface-2 ${className}`}
      >
        <Text className="px-2 text-center font-display text-xs font-semibold text-ink-2">
          {t.card.noImage}
        </Text>
      </View>
    );
  }
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
