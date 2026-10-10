import { View } from 'react-native';
import Svg, { Polyline } from 'react-native-svg';
import type { PricePoint } from '../../api/queries/cards';
import { usePalette } from '../palette';

const W = 600;
const H = 120;

/**
 * The polyline's points in a `width` × `height` box: x by date (weekly points before 180 days sit
 * further apart), y from the lowest price at the bottom to the highest at the top; a flat series
 * runs through the middle. Fewer than two points draw nothing.
 */
export function linePoints(points: PricePoint[], width = W, height = H): string {
  if (points.length < 2) return '';
  const times = points.map((p) => Date.parse(p.date));
  const t0 = times[0] ?? 0;
  const span = (times.at(-1) ?? 0) - t0;
  const values = points.map((p) => p.cents);
  const min = Math.min(...values);
  const range = Math.max(...values) - min;
  const round = (n: number) => Math.round(n * 10) / 10;
  return points
    .map((p, i) => {
      const x = span ? (((times[i] ?? t0) - t0) / span) * width : (i / (points.length - 1)) * width;
      const y = range ? height - ((p.cents - min) / range) * height : height / 2;
      return `${round(x)},${round(y)}`;
    })
    .join(' ');
}

/** One quiet line, no grid, no axes, no red or green (docs/app/design.md); a dot marks today. */
export function PriceLine({ points }: { points: PricePoint[] }) {
  const palette = usePalette();
  const last = linePoints(points).split(' ').at(-1)?.split(',');
  const top = last ? (Number(last[1]) / H) * 100 : 50;
  return (
    <View aria-hidden className="relative h-[120px]">
      <Svg width="100%" height="100%" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <Polyline
          points={linePoints(points)}
          fill="none"
          stroke={palette.blue}
          strokeWidth={1.5}
          strokeLinejoin="round"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </Svg>
      <View
        style={{ top: `${top}%` }}
        className="absolute -right-1.5 -mt-1.5 h-3 w-3 rounded-full border-[2.5px] border-blue bg-surface"
      />
    </View>
  );
}
