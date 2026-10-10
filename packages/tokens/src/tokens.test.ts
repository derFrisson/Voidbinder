import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { cssVar, tokensCss } from './css.ts';
import { tokens } from './tokens.ts';

/** `--name: value;` pairs of one CSS block. */
const parse = (css: string) =>
  Object.fromEntries([...css.matchAll(/(--[\w-]+):\s*([^;]+);/g)].map((m) => [m[1], m[2]]));

const css = tokensCss();
const [rootCss = '', darkCss = ''] = css.split('@media (prefers-color-scheme: dark)');
const root = parse(rootCss);
const dark = parse(darkCss);

// The custom properties apps/site used before the package existed; renaming one breaks the site.
const siteVars = [
  '--bg', '--surface', '--surface-2', '--ink', '--ink-2', '--ink-3', '--line',
  '--blue', '--blue-deep', '--blue-ink', '--blue-soft', '--on-blue',
  '--pk', '--pk-soft', '--yg', '--yg-soft', '--mg', '--mg-soft', '--op', '--op-soft',
  '--ok', '--ok-ink', '--ok-soft', '--phone', '--error', '--shadow',
  '--f-display', '--f-body', '--f-mono',
  '--space-1', '--space-2', '--space-3', '--space-4', '--space-5', '--space-6', '--space-7',
  '--space-8', '--space-9', '--gutter', '--maxw', '--nav-height', '--sec-y', '--ease',
]; // prettier-ignore

describe('TS ↔ CSS parity', () => {
  it('declares exactly the site variables', () => {
    expect(Object.keys(root).sort()).toEqual([...siteVars].sort());
  });

  it.each(['light', 'dark'] as const)('has every %s colour with the same value', (scheme) => {
    const vars = scheme === 'light' ? root : dark;
    for (const [key, value] of Object.entries(tokens.color[scheme])) {
      expect(vars[cssVar(key)], key).toBe(value);
    }
    expect(vars['--shadow']).toBe(tokens.shadow[scheme]);
  });

  it('has fonts, space, layout and easing', () => {
    expect(root['--f-display']).toBe(tokens.font.display.stack);
    expect(root['--f-body']).toBe(tokens.font.body.stack);
    expect(root['--f-mono']).toBe(tokens.font.mono.stack);
    for (const [step, px] of Object.entries(tokens.space)) {
      expect(root[`--space-${step}`]).toBe(`${px}px`);
    }
    expect(root['--maxw']).toBe(tokens.layout.maxw);
    expect(root['--gutter']).toBe(tokens.layout.gutter);
    expect(root['--sec-y']).toBe(tokens.layout.secY);
    expect(root['--nav-height']).toBe(tokens.layout.navHeight);
    expect(root['--ease']).toBe(tokens.ease);
  });

  it('dist/tokens.css is the current build', () => {
    expect(readFileSync(new URL('../dist/tokens.css', import.meta.url), 'utf8')).toBe(css);
  });
});

// WCAG 2.x relative luminance and contrast ratio.
const luminance = (hex: string) => {
  const [r = 0, g = 0, b = 0] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};

describe('contrast (docs/site/design.md)', () => {
  it('computes the WCAG ratio', () => {
    expect(contrast('#000000', '#ffffff')).toBeCloseTo(21);
    expect(contrast('#ffffff', '#ffffff')).toBe(1);
  });

  const pairs = [
    ['ink', 'page'],
    ['ink2', 'pkSoft'],
    ['ink2', 'ygSoft'],
    ['ink2', 'mgSoft'],
    ['ink2', 'opSoft'],
    ['onBlue', 'blue'],
    // okInk is promised 4.5:1 on the surface; on okSoft it reaches only 4.31:1 in light, and the
    // site never sets green text on okSoft.
    ['okInk', 'surface'],
    ['blueInk', 'page'],
    // Small print (price labels, source footers) sits on the card panel's surface2 (VB-101).
    ['ink3', 'surface'],
    ['ink3', 'surface2'],
  ] as const;

  it.each((['light', 'dark'] as const).flatMap((s) => pairs.map(([fg, bg]) => [s, fg, bg])))(
    '%s: %s on %s reaches 4.5:1',
    (scheme, fg, bg) => {
      const c = tokens.color[scheme as 'light' | 'dark'];
      expect(contrast(c[fg as keyof typeof c], c[bg as keyof typeof c])).toBeGreaterThanOrEqual(
        4.5,
      );
    },
  );
});
