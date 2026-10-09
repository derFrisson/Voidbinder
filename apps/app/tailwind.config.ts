import { tokens } from '@voidbinder/tokens';
import type { Config } from 'tailwindcss';
import plugin from 'tailwindcss/plugin';

// Every colour comes from @voidbinder/tokens as a CSS variable (`bg-surface-2` → `var(--surface-2)`),
// light on :root and dark under prefers-color-scheme, so no value is typed twice and the scheme
// follows the system (docs/app/design.md). The default Tailwind palette is replaced, not extended:
// blue is the only action colour.
const kebab = (key: string) => key.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`);
const vars = (palette: Record<string, string>) =>
  Object.fromEntries(Object.entries(palette).map(([k, v]) => [`--${kebab(k)}`, v]));
const family = (stack: string) => stack.split(',').map((f) => f.trim().replace(/^'|'$/g, ''));

export default {
  content: ['./src/**/*.{ts,tsx}'],
  // The preset ships no type declarations.
  presets: [require('nativewind/preset')],
  theme: {
    colors: {
      transparent: 'transparent',
      current: 'currentColor',
      ...Object.fromEntries(
        Object.keys(tokens.color.light).map((k) => [kebab(k), `var(--${kebab(k)})`]),
      ),
    },
    fontFamily: {
      display: family(tokens.font.display.stack),
      body: family(tokens.font.body.stack),
      mono: family(tokens.font.mono.stack),
    },
    extend: {
      maxWidth: { content: tokens.layout.maxw },
    },
  },
  plugins: [
    plugin(({ addBase }) =>
      addBase({
        ':root': vars(tokens.color.light),
        '@media (prefers-color-scheme: dark)': { ':root': vars(tokens.color.dark) },
      }),
    ),
  ],
} satisfies Config;
