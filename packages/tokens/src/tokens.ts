// Brand tokens of direction B "Der Scan" (docs/site/design.md). The one source for apps/site (through
// the generated dist/tokens.css) and apps/app (through this object). Plain values only: no DOM or
// web-only API, so React Native can import it.

const light = {
  // Page and ink. ink3 is darker than the mockup's #7A84A3 so small print reaches 4.5:1.
  page: '#f4f6fb',
  surface: '#ffffff',
  surface2: '#eceff7',
  ink: '#0b1433',
  ink2: '#4b5577',
  ink3: '#5f6987',
  line: '#dbe0ec',

  // The one action colour. blue fills (buttons, the scanner band, the waitlist card), blueInk is
  // blue text and the focus ring on the page background.
  blue: '#1e48f5',
  blueDeep: '#0f2bb0',
  blueInk: '#1e48f5',
  blueSoft: '#e2e8ff',
  onBlue: '#ffffff',

  // The four colour fields, one per game: Pokémon yellow, Yu-Gi-Oh! violet, Magic orange,
  // One Piece red, each with a soft tint for the tiles.
  pk: '#ffd447',
  pkSoft: '#fff2bf',
  yg: '#9a7cf0',
  ygSoft: '#ece5ff',
  mg: '#ff8f45',
  mgSoft: '#ffe3cf',
  op: '#f0544a',
  opSoft: '#ffdcd8',

  // Recognised / rising. ok fills, okInk is green text (4.5:1 on the surface).
  ok: '#12a866',
  okInk: '#0b8050',
  okSoft: '#d9f5e8',
  phone: '#0b0d13',
  error: '#ffd9d6',
} as const;

type Palette = { readonly [K in keyof typeof light]: string };

const dark = {
  page: '#0a0f1e',
  surface: '#121a2e',
  surface2: '#18213a',
  ink: '#e9eeff',
  ink2: '#a6b0ce',
  ink3: '#7983a4',
  line: '#252f4b',
  // Deeper than the mockup's #4A6FFF so white text on blue keeps 4.5:1.
  blue: '#2d4de0',
  blueDeep: '#2340c4',
  blueInk: '#7d97ff',
  blueSoft: '#1a2552',
  onBlue: '#ffffff',
  pk: '#e6be35',
  pkSoft: '#2e2914',
  yg: '#8a6fe0',
  ygSoft: '#231d40',
  mg: '#e87e3a',
  mgSoft: '#33221a',
  op: '#d9493f',
  opSoft: '#351b1c',
  ok: '#2cc77f',
  okInk: '#2cc77f',
  okSoft: '#123326',
  // The phone frame and the error tint are the same in both schemes.
  phone: '#0b0d13',
  error: '#ffd9d6',
} as const satisfies Palette;

export const tokens = {
  color: { light, dark },
  shadow: {
    light: '0 30px 60px -28px rgba(11, 20, 51, 0.38), 0 8px 18px -10px rgba(11, 20, 51, 0.18)',
    dark: '0 30px 60px -28px rgba(0, 0, 0, 0.7), 0 8px 18px -10px rgba(0, 0, 0, 0.5)',
  },
  // Variable fonts, self-hosted by each app; weights are the instances the design uses.
  font: {
    display: {
      family: 'Sora',
      stack: "'Sora', 'Avenir Next', 'Segoe UI', system-ui, sans-serif",
      weights: [500, 600, 700, 800],
    },
    body: {
      family: 'Public Sans',
      stack: "'Public Sans', 'Helvetica Neue', Arial, system-ui, sans-serif",
      weights: [400, 500, 600, 700],
      italicWeights: [400],
    },
    mono: {
      family: 'JetBrains Mono',
      stack: "'JetBrains Mono', ui-monospace, 'SF Mono', Menlo, Consolas, monospace",
      weights: [500, 600],
    },
  },
  // Space scale in px for the text pages (legal, status, 404).
  space: { 1: 4, 2: 8, 3: 12, 4: 16, 5: 24, 6: 32, 7: 48, 8: 64, 9: 96 },
  // CSS expressions, as the site uses them.
  layout: {
    gutter: 'clamp(16px, 4vw, 40px)',
    maxw: '1240px',
    navHeight: '68px',
    secY: 'clamp(72px, 9vw, 128px)',
  },
  ease: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
} as const;

export type Tokens = typeof tokens;
