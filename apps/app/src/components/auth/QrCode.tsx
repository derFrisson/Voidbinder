import { tokens } from '@voidbinder/tokens';
import { View } from 'react-native';
import Svg, { Path, Rect } from 'react-native-svg';
import { encode } from 'uqr';

/**
 * A QR code drawn in the app (uqr + react-native-svg): the otpauth URL holds the 2FA secret, so it
 * never goes to a QR service. Always dark on light, also in the dark scheme, so every scanner reads it.
 */
export function QrCode({
  value,
  label,
  size = 192,
}: {
  value: string;
  label: string;
  size?: number;
}) {
  const { data, size: n } = encode(value, { ecc: 'M', border: 2 });
  const d = data
    .flatMap((row, y) => row.map((dark, x) => (dark ? `M${x} ${y}h1v1h-1z` : '')))
    .join('');
  const { surface, ink } = tokens.color.light;
  return (
    <View
      role="img"
      aria-label={label}
      className="self-start overflow-hidden rounded-xl border border-line"
    >
      <Svg width={size} height={size} viewBox={`0 0 ${n} ${n}`}>
        <Rect width={n} height={n} fill={surface} />
        <Path d={d} fill={ink} />
      </Svg>
    </View>
  );
}
