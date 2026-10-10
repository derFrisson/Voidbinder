import { useState } from 'react';
import { Image, Text, View } from 'react-native';
import { useT } from '../../i18n';

/**
 * A card image at the card's 63:88 ratio, or an empty frame when there is none or it fails to
 * load. `label` is the alt text; without it the image is decorative (the link around it is named).
 */
export function CardImage({
  uri,
  label,
  className = '',
}: {
  uri: string | null;
  label?: string;
  className?: string;
}) {
  const t = useT();
  const [failed, setFailed] = useState<string | null>(null);
  const a11y = label ? { role: 'img' as const, 'aria-label': label } : { 'aria-hidden': true };
  if (!uri || failed === uri) {
    return (
      <View
        {...a11y}
        className={`aspect-[63/88] w-full items-center justify-center rounded-lg border border-dashed border-line bg-surface-2 ${className}`}
      >
        <Text className="px-2 text-center font-display text-xs font-semibold text-ink-2">
          {t.card.noImage}
        </Text>
      </View>
    );
  }
  return (
    <Image
      {...a11y}
      source={{ uri }}
      onError={() => setFailed(uri)}
      resizeMode="cover"
      className={`aspect-[63/88] w-full rounded-lg ${className}`}
    />
  );
}
