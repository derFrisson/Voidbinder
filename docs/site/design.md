# Site design system

Source of truth for the look of voidbinder.de (`apps/site`). Tokens and shared classes live in
`apps/site/src/styles/global.css`; components use scoped Astro styles and only reference tokens.
Voidbinder wears the Voidcom brand and adds one motif of its own: the trading card.

## Tokens

| Group  | Tokens                                                                                                                                                                                                                                   |
| ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Color  | `--bg` #080808, `--on-surface` #f4f4f2, `--on-surface-muted` (64 %), `--on-surface-dim` (50 %), `--outline` (10 %), `--outline-hover` (20 %), `--outline-control` (42 %, form edges reach 3:1), `--surface` (3 % tint)                   |
| Accent | `--primary` #F5B4BE (+ `--primary-hover`, `--primary-faint`), `--on-primary` near-black. The only color; `--status-error` is the one semantic status                                                                                     |
| Glass  | `--glass` (4.5 %), `--glass-edge` (14 %), `--glass-highlight` (1 px inset top), `--glass-blur` (`blur(14px) saturate(1.25)`)                                                                                                             |
| Type   | Inter 400/500, self-hosted woff2 (latin + latin-ext, OFL in `public/fonts/Inter-OFL.txt`). `--text-display-l/m`, `--text-headline`, `--text-title`, `--text-body` 16 px, `--text-small`, `--label-size` 12 px, `--label-tracking` 0.12em |
| Space  | `--space-1` … `--space-9`: 4, 8, 12, 16, 24, 32, 48, 64, 96                                                                                                                                                                              |
| Layout | `--max-width` 1240 px, `--gutter` 24 px (16 under 640), `--section-y` 120 / 96 (under 1024) / 64 (under 640), `--nav-height` 64 px, `--radius` 2 px, `--card-ratio` 63 / 88                                                              |

Type classes: `.display-l`, `.display-m`, `.headline`, `.title`, `.lede` (muted, max 40em),
`.label` (12 px uppercase tracked, muted), `.small`, `.muted`, `.num` (tabular figures for prices
and counts; never on body text, Inter's `tnum` also widens hyphens). Headings are 500 with
−0.02 to −0.03em tracking and `text-wrap: balance`.

## Layout grammar

- **One edge, one gutter, one interval.** Every block sits in `.wrap`. Sections are `.section`
  and pad on top only; `main` pads the bottom once.
- **Section head** (`.section-head`): hairline on top, `.label` in the left third, heading and lede
  in the right two thirds; one column under 760 px, where the label is hidden. Labels never sit above a heading as a kicker.
- **Centered intros** (`.intro`): page heroes and standalone intros (hero, waitlist). h1/h2 max
  18ch, lede max 40em, 24 px between them.
- **Ruled, not boxed.** `.rows` (items share hairlines), `.facts` (a `dl` of label / value pairs),
  hairline cells (variant row, plans). Nothing floats in a card with a gap. Two-column
  text-and-visual rows are left-aligned and stack under 900 px.
- **Spacing pairs.** Label to heading 12, heading to lede 24, lede to actions 32, head to content 64
  (48 on phones), hero actions to art 64.

## Controls

- `.btn` + `.btn-primary` (solid pink, near-black label) or `.btn-outlined` (matte glass);
  rectangles, 2 px radius, 12 px uppercase tracked label, `.btn-sm` for the nav. No lift, no glow.
  `Arrow.astro` is the one icon.
- `.input`, `.checkbox` (custom, pink when checked), `.chip` (+ `.chip-active`), `.dot` (6 px
  square status mark), `.glass`, `.link-arrow` (text link ending a block).
- Focus: 2 px pink outline on `:focus-visible` everywhere. Targets are at least 24 px.

## The card motif

`.card-shape` (63:88, 2 px radius, hairline; `.is-glass`, `.is-accent`) and `art/Card.astro` (name
bar, empty art window, text lines, number zone). Used for the hero fan, the binder page, the
scanner's detection quad, the variant row, the stream overlay and the waitlist stack. Mockups are
wireframes (`art/Phone.astro`) in brand colors. Prices are one quiet line with a "source · date"
caption and an "example values" chip while the data is not real.

## Motion

CSS scroll-driven animation only, inside `@supports (animation-timeline: view())` and
`prefers-reduced-motion: no-preference`; the reduced-motion block in global.css switches every
animation off. The resting state of every animated element is its visible state (keyframes only
define `from`). The page has one authored moment: the binder page in the games section fills row
by row (`art/Binder.astro`); cells in a row move together so the grid never breaks.

## Hard constraints

- No inline `style=""` attributes (strict CSP, VB-19) and no `define:vars` (it emits them).
  `apps/site/test/build.test.ts` checks the built HTML.
- No external resources: fonts, icons and images are self-hosted; no `<img>` from another origin.
- `html` clips horizontal overflow, `body` must not (sticky).

## i18n and pages

- Routes `/de/` and `/en/` (`i18n` in `astro.config.mjs`, `prefixDefaultLocale: true`). `/` is an
  on-demand endpoint (`src/pages/index.ts`) that 302s to `/de/` or `/en/` by `Accept-Language`
  with `Vary: Accept-Language`, German as fallback.
- Copy lives in `src/i18n/de.ts` (defines `Dict`) and `src/i18n/en.ts` (typed as `Dict`): a
  missing or extra key fails `pnpm typecheck`; `src/i18n/i18n.test.ts` compares key sets.
  `t(locale)` returns the dictionary.
- A page is `src/pages/[locale]/<slug>.astro` wrapped in `layouts/Base.astro` (`locale`, optional
  `title` / `description`, a `head` slot for SEO). Slugs are the same in both locales, except the
  legal pages: `impressum` / `datenschutz` in German, `imprint` / `privacy` in English
  (`legalSlugs`, `legalPath(locale, 'imprint' | 'privacy')` in `i18n/index.ts`). `localePath` (language
  switch, `hreflang`) swaps the prefix and maps those slugs. The footer links the legal pages through
  `legalPath`.

## Refuses

Cream or off-white backgrounds, italic accent words, numbered "01/02/03" labels, monospace labels,
pill buttons, eyebrow kickers above headings, gradient text, glows and orbs, same-size icon-card
grids, colored side borders, count-up numbers, parallax per cell, random offsets, screenshots or
stock images, and any card artwork, logo, mascot, trademark or set symbol of Pokémon, Yu-Gi-Oh!,
Magic: The Gathering or One Piece (games are named in text only).

## Navigation on phones

Under 880 px the nav keeps the logo, the DE/EN switch and the waitlist button and hides the four section links. The landing page is one page with ruled sections, so scrolling is the navigation; a disclosure menu can be added later if section links on phones turn out to be needed.
