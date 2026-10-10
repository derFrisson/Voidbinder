# Accessibility and performance

Target (VB-20): WCAG 2.2 AA on every page, Lighthouse mobile at least 95 in all four categories.
Checked on 2026-10-09 against the production build served by `wrangler dev` (the same Worker that
ships), in Chromium; re-measured for the direction B redesign (VB-52). Things only a screen reader or a real device can confirm are listed under
[Not verified](#not-verified).

## Automated: axe-core in CI

`apps/site/test/a11y.test.ts` (Vitest, real Chromium through Playwright, `@axe-core/playwright`)
opens every page of the build at 1280 and 390 px and fails on any violation of the tags `wcag2a`,
`wcag2aa`, `wcag21a`, `wcag21aa`, `wcag22aa` and `best-practice`:

- every prerendered `.html` file in `dist/client` (both locales: landing page, imprint, privacy,
  the four status pages, 404), found by listing the build, so a new page is covered without an edit;
- the on-demand pages `waitlist/error` (all three reasons) and `waitlist/unsubscribe` (with and
  without a token), in both locales, and a path that is no page (the 404 the Worker serves).

The test starts `wrangler dev` on a free port (the `UNSUBSCRIBE_SECRET` binding is a dummy), and
kills it afterwards. It also asserts the nav fits into 320 px. About 20 s of the CI run. Locally it
needs the browser once: `pnpm --filter site exec playwright install chromium`. CI installs it with
`--with-deps` before `pnpm test`.

axe cannot decide colour contrast over gradients and the field circles (it reports those as
"needs review"), so the contrast numbers below are computed from the tokens, and the text that can
sit near a field circle was checked against the circle colour by hand.

## Manual checklist

Run with Playwright driving Chromium (keyboard events, computed styles, `getBoundingClientRect`,
the accessibility tree) on `/de/` and `/en/`, at 1280 and 390 px, unless noted.

| Check                                         | Result                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Keyboard: nav, language switch, waitlist form | Tab walks 23 stops on desktop (skip link, logo, four section links, DE, EN, nav button, hero buttons, Twitch link, source button, form email, submit, consent, privacy link, footer) and 19 on a phone (section links hidden under 820 px). Order is the visual order.        |
| Visible focus everywhere                      | `outline: 3px solid` on every stop: `--blue-ink` on the page (5.9:1 on `--bg`), white on the blue waitlist card (6.4:1 against the blue), `--pk` yellow on the email field and checkbox there. 3 px offset.                                                                   |
| Skip link                                     | First Tab focuses "Zum Inhalt springen" / "Skip to content", fixed top left above the sticky nav; Enter moves focus into `main`.                                                                                                                                              |
| Heading order                                 | One `h1` per page, then `h2` per section, `h3` for game tiles, the price panel card, the seller facts and the two plans. No level skipped. The mock screens and the stream overlay are `role="img"` with a label, so their text is not read twice.                            |
| Form labels                                   | Email (visually hidden label) and consent have `<label for>`; the placeholder is never the only name. Honeypot is `aria-hidden` with `tabindex="-1"`.                                                                                                                         |
| Error and status messages                     | JS path: `role="alert"` region that is always in the DOM and only changes its text; exercised with an invalid address, the message appears and focus stays on the submit button. Success: `role="status"` panel that takes focus. No-JS path: 303 to a status page with `h1`. |
| Contrast                                      | See the table below.                                                                                                                                                                                                                                                          |
| Target size 2.5.8                             | See the table below.                                                                                                                                                                                                                                                          |
| Focus not obscured 2.4.11                     | The nav is `position: sticky`, 68 px high; `html` has `scroll-padding-top: 84px`. Walking every Tab stop with reduced motion, no focused element outside the nav sits under it (the skip link is drawn above it).                                                             |
| Reflow 1.4.10                                 | 320, 390 and 1440 px: `scrollWidth` equals the viewport on both landing pages. The rotated hero phone and the stream table bleed and are clipped by `main` (the root alone still reported 397 px at 390). The nav fits into 320 px (test).                                    |
| Motion                                        | `prefers-reduced-motion: reduce`: no animation runs, the hero shows its final frame (frame green, "Erkannt", price sheet, callout). Without the preference the scan moment plays once in 3.85 s and leaves 0 running animations.                                              |
| Language                                      | `<html lang>` is `de` / `en` per page. The switch links carry `lang` and `hreflang` of their target, and `aria-current="true"` on the active one.                                                                                                                             |

### Contrast, measured from the tokens

Ratios by the WCAG formula. Text needs 4.5:1, UI components and focus indicators 3:1.

| Pair                                                                  | Light        | Dark         |
| --------------------------------------------------------------------- | ------------ | ------------ |
| `--ink` on `--bg` (body, headings)                                    | 16.71        | 16.49        |
| `--ink-2` on `--bg` (leads)                                           | 6.78         | 8.84         |
| `--ink-3` on `--bg` (small print)                                     | 5.04         | 5.09         |
| `--ink-3` on `--surface-2` / `--surface`                              | 4.73         | 4.61         |
| `--blue-ink` on `--bg` (links, hero accent, focus ring)               | 5.88         | 7.04         |
| white on `--blue` (buttons, scanner band, waitlist card)              | 6.36         | 6.46         |
| white at 80 % on `--blue` (scanner kicker, the lightest text)         | 4.60         | 4.72         |
| `--ok-ink` on `--surface` (+38,20 €)                                  | 4.98         | 7.90         |
| `--ink-2` on the soft tints (game tiles: yellow, violet, orange, red) | 5.75 to 6.53 | 6.74 to 7.36 |
| white on the stream's "LIVE" red #D63A33                              | 4.65         | 4.65         |

On phones the game tile's colour circle was narrowed from the mockup's 62 % to 54 % of the tile:
at 62 % it ran under the start of the body text, where `--ink-2` on the orange, violet and red
circle drops to 2.1 to 3.2:1. The mock app screens keep their light colours in both schemes; their
grey labels were darkened from #7A84A3 / #9AA3BE to #5F6987 / #6B7593.

### Target sizes

Measured: language links 32 x 32, nav button 38 high, logo link 44 high, buttons and the email
field 48 to 50 high, footer links 28 high, the Twitch link 24 high. Under 24 px: the consent
checkbox (20 x 20) and the privacy link inside the consent sentence (16 high). The checkbox passes
the spacing exception of 2.5.8 and also activates from its label; the link is inline in running
text and exempt. axe's `target-size` rule agrees.

## Fixes made

VB-20 (first design):

1. **Nav clipped at 320 px (1.4.10 Reflow).** Under 380 px the nav gaps shrink, under 360 px the
   wordmark is hidden and the mark is the logo (the link keeps its `aria-label`). Guarded by a test.
2. **Form error not reliably announced (4.1.3).** The `role="alert"` region is always in the DOM,
   empty, and only its text changes.
3. **Focus thrown to `<body>` after a failed submit (2.4.3).** `aria-disabled="true"` instead of
   `disabled` while sending.

VB-52 (direction B), deviations from the mockup for accessibility:

1. `--ink-3` #5F6987 instead of #7A84A3 (small print reached only 3.4:1).
2. Green text uses `--ok-ink` #0B8050 (the mockup's #12A866 gave 3.1:1 on white).
3. Dark mode: `--blue` #2D4DE0 instead of #4A6FFF (white button text 4.19:1), blue text
   `--blue-ink` #7D97FF.
4. Focus ring white on the blue waitlist card (the blue ring would vanish there).
5. Game tile circle 54 % on phones (see above); "LIVE" badge #D63A33 instead of #E5413A (axe
   flagged 4.07:1).

## Lighthouse

`lighthouse` 13.5.0, default mobile preset (412 x 823, 1.75 DPR, simulated Slow 4G and 4x CPU),
Chromium 154 headless, production build (`pnpm build`) served by `wrangler dev`. Reports:
[`lighthouse/de-mobile.json`](lighthouse/de-mobile.json),
[`lighthouse/en-mobile.json`](lighthouse/en-mobile.json).

| Page   | Performance | Accessibility | Best Practices | SEO | LCP   | CLS | TBT  | FCP   |
| ------ | ----------- | ------------- | -------------- | --- | ----- | --- | ---- | ----- |
| `/de/` | 99          | 100           | 100            | 100 | 1.7 s | 0   | 0 ms | 1.5 s |
| `/en/` | 99          | 100           | 100            | 100 | 1.7 s | 0   | 0 ms | 1.5 s |

Re-run:

```sh
pnpm build
cd apps/site && UNSUBSCRIBE_SECRET=x pnpm exec wrangler dev --port 4574   # keep running
pnpm dlx lighthouse@latest http://127.0.0.1:4574/de/ --output=json --output-path=de-mobile.json \
  --chrome-flags="--headless=new" --quiet
```

(`--preset=perf` would drop the other three categories, do not use it.)

Loading, as built: three render-blocking stylesheets (about 64 KB together, 42 KB of it the
landing page's section styles; the CSP forbids inlining), which is the one remaining Lighthouse
suggestion and the point between 99 and 100. Two preloaded fonts (Sora and Public Sans latin,
`font-display: swap`, `crossorigin`), JetBrains Mono and the italic load on use. No images: every
card, phone and field is CSS and inline SVG, sized by the layout. No JavaScript outside the
waitlist form's script. Layout shift is 0, including the hero animation (transform and opacity
only), the font swap and the form.

Plausible is only in the prod build (`PLAUSIBLE_HOST`), so the reports above are without it. Re-measure on the deployed prod Worker before relying on them with the script loaded.

## Not verified

- **Screen readers.** No VoiceOver, NVDA, JAWS or TalkBack run. Roles, names and live regions were
  checked in Chromium's accessibility tree and by axe, not by listening.
- **Real devices.** Touch target comfort, on-screen keyboard behaviour with the form, and iOS
  Safari rendering of `backdrop-filter` surfaces.
- **Forced colors (Windows high contrast) and 200 % text-only zoom** were not exercised; the blue
  bands, colour fields and drawn phones are background colours that forced colors would remove.
- **The hero animation at 30 fps or on a slow phone**, and the dark scheme on a real device.
- **Pages other than Chromium.** Firefox and Safari were not run through axe or the keyboard walk.
