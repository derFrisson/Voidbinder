# Site design system: direction B "Der Scan"

Source of truth for the look of voidbinder.de (`apps/site`). The approved mockup lives next to
this file: [`design-reference/b-der-scan.html`](design-reference/b-der-scan.html) with its renders
`b-der-scan-desktop.png` and `b-der-scan-mobile.png`. When this document and the mockup disagree,
the mockup wins for look, copy and motion; the deviations below are deliberate.

Tokens and the shared classes live in `apps/site/src/styles/global.css`; components use scoped
Astro styles and reference the tokens. The marketing research behind the direction is in
[`docs/marketing/`](../marketing/).

## Idea

A light, cool page where one strong blue does every action and four soft colour fields, one per
game, carry the warmth. The hero shows the product moment: a phone scans an invented card, the
frame snaps green, the price sheet slides up. Everything else is the app itself, drawn in CSS:
phones, card lists, the viewfinder, the stream overlay. No photos, no real cards.

## Tokens

| Group   | Tokens                                                                                                                                                                                                      |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page    | `--bg` #F4F6FB (cool off-white), `--surface` #FFF, `--surface-2` #ECEFF7, `--line` #DBE0EC                                                                                                                  |
| Ink     | `--ink` #0B1433, `--ink-2` #4B5577 (leads, body on tints), `--ink-3` #5F6987 (small print; the mockup's #7A84A3 only reached 3.4:1)                                                                         |
| Action  | `--blue` #1E48F5 (fills: buttons, scanner band, waitlist card), `--blue-deep` #0F2BB0 (hover), `--blue-ink` (blue text, links, focus ring), `--blue-soft` #E2E8FF, `--on-blue` #FFF. The only action colour |
| Fields  | `--pk` #FFD447 / `--pk-soft`, `--yg` #9A7CF0 / `--yg-soft`, `--mg` #FF8F45 / `--mg-soft`, `--op` #F0544A / `--op-soft`: Pokémon yellow, Yu-Gi-Oh! violet, Magic orange, One Piece red                       |
| Status  | `--ok` #12A866 (fills: detection, rising), `--ok-ink` #0B8050 (green text, 4.5:1), `--ok-soft`                                                                                                              |
| Type    | `--f-display` Sora 500 to 800, `--f-body` Public Sans 400 to 700 (+ italic 400 for card flavour text), `--f-mono` JetBrains Mono 500 to 600                                                                 |
| Layout  | `--maxw` 1240 px, `--gutter` `clamp(16px, 4vw, 40px)`, `--sec-y` `clamp(72px, 9vw, 128px)`, `--nav-height` 68 px                                                                                            |
| Spacing | `--space-1` to `--space-9` (4 to 96 px) for the text pages (legal, status, 404)                                                                                                                             |

Dark variant through `prefers-color-scheme: dark` only (no toggle): navy page #0A0F1E, surfaces
#121A2E, the fields darkened, the phone screens stay light like a screenshot would. Two values
differ from the mockup's dark set so white text on blue keeps 4.5:1: `--blue` is #2D4DE0 (the
mockup's #4A6FFF gave 4.19:1) and blue text uses `--blue-ink` #7D97FF.

Fonts are self-hosted woff2 in `apps/site/public/fonts/` (latin + latin-ext per family, licences
`Sora-OFL.txt`, `PublicSans-OFL.txt`, `JetBrainsMono-OFL.txt`, all SIL OFL 1.1). Sora and Public
Sans latin are preloaded. No request to Google at runtime.

## Type

- Display (Sora 700): h1 `clamp(2.4rem, 4.6vw, 4.3rem)`, −0.045em, line height 0.98; `.h2`
  `clamp(2rem, 3.7vw, 3.3rem)`, −0.03em. Headings balance.
- Hero accent: the last clause in `--blue-ink`, underlined in `--pk` (0.11em thick).
- `.lead`: Public Sans 17 to 19 px in `--ink-2`, max 34em. Body 17 px / 1.6.
- `.eyebrow`: Sora 600 13 px uppercase, 0.08em, with a 10 px rounded square in the section's
  field colour (`--dot`). It sits above the section heading.
- Prices, card numbers and codes in JetBrains Mono; the collection value in Sora with tabular
  figures.

## Colour fields

The four field colours always mean the four games and appear in four places, exactly as in the
mockup:

1. **Hero**: four dotted fields behind the phones (yellow tile, violet tile, orange tile, red
   circle), plus two loose example cards.
2. **Game tiles**: each tile is its game's soft tint with a full-colour circle behind the card.
   On phones the circle is 54 % wide (mockup 62 %) so it never runs under the body text.
3. **Trust line** under the hero CTAs: four small squares (blue, yellow, green, red).
4. **Waitlist card**: the four fields again behind the example card, on the blue card.

Blue bands (scanner section, waitlist card) carry white text. Section kickers pick a field colour
(scanner yellow, prices green, sellers orange, streamer violet, open source ink).

## Components

| Section       | File                                          | Notes                                                                                    |
| ------------- | --------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Nav           | `components/Nav.astro`                        | Sticky, translucent. Links hide under 820 px, CTA shortens under 480, wordmark under 360 |
| Hero          | `components/sections/Hero.astro`              | The scan moment, see Motion                                                              |
| Games         | `components/sections/Games.astro`             | Four tiles, One Piece "Kommt später" / "Coming later"                                    |
| Scanner       | `components/sections/Scanner.astro`           | Blue band, viewfinder with detection frame and number box, variants sheet                |
| Prices        | `components/sections/Prices.astro`            | Collection value, card panel with Cardmarket and TCGplayer, one quiet 90-day line        |
| Sellers       | `components/sections/Reseller.astro`          | Bulk-scan phone, three ruled facts                                                       |
| Streamer Kit  | `components/sections/StreamerKit.astro`       | 16:9 stream frame with the overlay                                                       |
| Open source   | `components/sections/OpenSource.astro`        | Self-host (0 €) and hosted ("weniger als ein Booster im Monat")                          |
| Waitlist      | `components/sections/Waitlist.astro`          | Blue card, form contract of VB-17 unchanged                                              |
| Footer        | `components/Footer.astro`                     | Logo, legal and social links, "Powered by Voidcom", trademark notice line                |
| Example cards | `components/art/Card.astro`, `Sprite.astro`   | Glimmerfuchs, Nebelwächter, Sturmkoralle, Salzwindsegler: invented, CSS + inline SVG art |
| Phone         | `components/art/Phone.astro`                  | Frame, notch, status bar; app header, tabs, rows and tab bar for the slotted screen      |
| Icons         | `components/Icon.astro`                       | The mockup's 24 px line icons, inline                                                    |
| Logo          | `components/Logo.astro`, `public/favicon.svg` | Blue binder with three rings and a yellow card sliding out; Sora 700 wordmark            |

Card names and numbers are proper names and stay the same in both locales; type lines and card
texts are in the dictionaries. Prices are formatted per locale with `money()` / `amount()` from
`src/i18n/index.ts` (`3,20 €` / `€3.20`).

Text pages (legal, waitlist status, 404) use the same layout: legal prose on a surface panel,
status pages on a panel with the four field colours as a band along the top, the 404 shows an
empty card pocket on a yellow field.

## Motion

One authored moment, in the hero, CSS only, inside `prefers-reduced-motion: no-preference`:

| Time   | Step                                                                |
| ------ | ------------------------------------------------------------------- |
| 0 s    | Fields scale in (staggered 80 ms), phones rise, loose cards fade in |
| 0.9 s  | Scan line sweeps the card (transform, not `top`)                    |
| 2.15 s | Detection frame snaps from white to green with a slight overshoot   |
| 2.45 s | "Erkannt" / "Recognized" pops in                                    |
| 2.65 s | Price sheet slides up, prices fade up at 3.15 s                     |
| 3.35 s | "Ohne Netz erkannt" / "Recognized offline" callout pops in          |

Every keyframe only defines `from` and only touches transform, scale, rotate or opacity, so the
resting state is the final frame, nothing shifts the layout (CLS 0), and reduced motion shows the
final frame directly; the global reduced-motion block switches every animation and transition
off. Small hover touches: the holo sweep on cards, game cards straighten on tile hover, buttons
lift 1 px.

## Hard constraints

- No inline `style=""` attributes and no `define:vars` (strict CSP, VB-19). Per-element colours
  are modifier classes (`.trust--pk`, `.thumb--sea`), not custom properties in attributes.
  `apps/site/test/build.test.ts` checks the built HTML.
- No inline `<style>` or `<script>`: `build.inlineStylesheets: 'never'` and
  `vite.build.assetsInlineLimit: 0` stay.
- No external resources: fonts, icons and art are self-hosted or inline.
- `html` and `main` clip horizontal overflow (the hero's rotated phone and the stream table
  bleed); `body` must not, or the sticky nav breaks.
- Contrast: text 4.5:1 on every surface and field it can sit on, in both schemes. Checked by axe
  in CI and by hand for text over the field circles.

## Refuses

- Real card art, set symbols, card backs, game or company logos. Game names in plain text only;
  the example cards are invented (`docs/marketing/card-imagery-legal.md`).
- Stock-market charts: no candles, axes grids, tickers or red/green arrows. Prices are a single
  quiet line with a source label.
- A dark default. The page is light; dark is only the system preference.
- Photos, stock imagery, mascots, glows, gradient text, a second action colour.

## i18n and pages

- Routes `/de/` and `/en/` (`i18n` in `astro.config.mjs`, `prefixDefaultLocale: true`). `/` is an
  on-demand endpoint (`src/pages/index.ts`) that 302s to `/de/` or `/en/` by `Accept-Language`,
  German as fallback. The nav carries a DE / EN switch (not in the mockup).
- Copy lives in `src/i18n/de.ts` (final German from the mockup, defines `Dict`) and
  `src/i18n/en.ts` (en-US: "color", "catalog", `og:locale` `en_US`). A missing key fails
  `pnpm typecheck`; `src/i18n/i18n.test.ts` checks key parity, untranslated values and forbidden
  words.
- A page is `src/pages/[locale]/<slug>.astro` wrapped in `layouts/Base.astro`. Legal slugs differ
  per locale (`legalSlugs`, `legalPath`); `localePath` maps them for the language switch.
- Section anchors are English in both locales: `#games`, `#scanner`, `#prices`, `#resellers`,
  `#streamer`, `#open-source`, `#waitlist`.
