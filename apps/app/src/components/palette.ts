import { tokens } from '@voidbinder/tokens';
import { useColorScheme } from 'react-native';

/** Token colours as values, for props that take no className (SVG strokes, placeholders). */
export function usePalette() {
  return tokens.color[useColorScheme() === 'dark' ? 'dark' : 'light'];
}
