import { tokens } from './tokens.ts';

type Vars = Record<string, string>;

/** `surface2` → `--surface-2`, `blueDeep` → `--blue-deep`; `page` keeps the site's name `--bg`. */
export const cssVar = (key: string) =>
  key === 'page' ? '--bg' : `--${key.replace(/[A-Z0-9]/g, (c) => `-${c.toLowerCase()}`)}`;

const colors = (palette: Record<string, string>): Vars =>
  Object.fromEntries(Object.entries(palette).map(([k, v]) => [cssVar(k), v]));

/** Every CSS custom property per scheme, in the order the site declared them. */
export function tokensVars(): { light: Vars; dark: Vars } {
  const { color, shadow, font, space, layout, ease } = tokens;
  return {
    light: {
      ...colors(color.light),
      '--shadow': shadow.light,
      '--f-display': font.display.stack,
      '--f-body': font.body.stack,
      '--f-mono': font.mono.stack,
      ...Object.fromEntries(Object.entries(space).map(([k, v]) => [`--space-${k}`, `${v}px`])),
      ...Object.fromEntries(Object.entries(layout).map(([k, v]) => [cssVar(k), v])),
      '--ease': ease,
    },
    dark: { ...colors(color.dark), '--shadow': shadow.dark },
  };
}

const block = (vars: Vars, indent: string) =>
  Object.entries(vars)
    .map(([k, v]) => `${indent}${k}: ${v};`)
    .join('\n');

/** The tokens as a stylesheet: `:root` for light, the dark values under prefers-color-scheme. */
export function tokensCss(): string {
  const { light, dark } = tokensVars();
  return `/* Generated from @voidbinder/tokens (packages/tokens/src/tokens.ts). Do not edit. */

:root {
${block(light, '  ')}
}

@media (prefers-color-scheme: dark) {
  :root {
${block(dark, '    ')}
  }
}
`;
}
