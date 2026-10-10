import { tokens } from '@voidbinder/tokens';
import Svg, { Circle, G, Path, Rect } from 'react-native-svg';

// Line icons and the mark from the approved mockups (docs/app/mockups), stroke in currentColor.
const paths = {
  binder: (
    <>
      <Rect x={4} y={3} width={15} height={18} rx={2.5} />
      <Path d="M8 3v18M4 8h1.5M4 12h1.5M4 16h1.5M12 8h4" />
    </>
  ),
  deck: (
    <>
      <Rect x={7} y={3} width={12} height={15} rx={2} />
      <Path d="M4 7v11a3 3 0 0 0 3 3h9" />
    </>
  ),
  search: (
    <>
      <Circle cx={11} cy={11} r={6.5} />
      <Path d="M20 20l-4.2-4.2" />
    </>
  ),
  user: (
    <>
      <Circle cx={12} cy={8.5} r={4} />
      <Path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </>
  ),
  scan: (
    <Path d="M4 8V5.5A1.5 1.5 0 0 1 5.5 4H8M16 4h2.5A1.5 1.5 0 0 1 20 5.5V8M20 16v2.5a1.5 1.5 0 0 1-1.5 1.5H16M8 20H5.5A1.5 1.5 0 0 1 4 18.5V16M4 12h16" />
  ),
  chevronLeft: <Path d="M15 5l-7 7 7 7" />,
  chevronRight: <Path d="M9 5l7 7-7 7" />,
  check: <Path d="M5 12.5l4.5 4.5L19 7.5" />,
};

export type IconName = keyof typeof paths;

/** A decorative icon; the control around it carries the label. */
export function Icon({ name, size = 20, color }: { name: IconName; size?: number; color: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" aria-hidden>
      <G fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
        {paths[name]}
      </G>
    </Svg>
  );
}

const { blue, pk, ink, page } = tokens.color.light;

/** The Voidbinder mark: binder with a card (fixed brand colours in both schemes). */
export function Mark({ size = 36 }: { size?: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <Rect x={3} y={6} width={19} height={23} rx={4} fill={blue} />
      <G fill={page}>
        <Circle cx={6.5} cy={11.5} r={1.4} />
        <Circle cx={6.5} cy={17.5} r={1.4} />
        <Circle cx={6.5} cy={23.5} r={1.4} />
      </G>
      <G rotation={12} origin="21, 14">
        <Rect
          x={13.5}
          y={2.5}
          width={14}
          height={19}
          rx={2.6}
          fill={pk}
          stroke={ink}
          strokeWidth={1.6}
        />
        <Rect x={16} y={5.5} width={9} height={6.5} rx={1} fill={ink} opacity={0.85} />
      </G>
    </Svg>
  );
}
