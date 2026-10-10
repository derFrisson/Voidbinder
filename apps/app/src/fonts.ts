import { tokens } from '@voidbinder/tokens';
import { useFonts } from 'expo-font';

// The site's self-hosted variable fonts (apps/site/public/fonts, OFL licences next to the files in
// assets/fonts), latin subset only: German and English need nothing else. Registered under the
// family names the Tailwind config uses, so text renders in the fallback stack until they load.
// ponytail: woff2 serves the web target; native builds (Sprint 3) need static TTF files per weight.
export function useAppFonts() {
  useFonts({
    [tokens.font.display.family]: require('../assets/fonts/sora-latin.woff2'),
    [tokens.font.body.family]: require('../assets/fonts/public-sans-latin.woff2'),
    [tokens.font.mono.family]: require('../assets/fonts/jetbrains-mono-latin.woff2'),
  });
}
