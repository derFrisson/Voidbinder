# Accessibility and performance

Target (VB-20): WCAG 2.2 AA on every page, Lighthouse mobile at least 95 in all four categories.
Checked on 2026-10-09 against the production build served by `wrangler dev` (the same Worker that
ships), in Chromium 156. Things only a screen reader or a real device can confirm are listed under
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

axe cannot decide colour contrast over translucent glass, so the contrast numbers below are computed
from the tokens and from every text node on both landing pages.

## Manual checklist

Run with Playwright driving Chromium (keyboard events, computed styles, `getBoundingClientRect`,
the accessibility tree) on `/de/` and `/en/`, at 1280 and 390 px, unless noted.

| Check                                         | Result                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Keyboard: nav, language switch, waitlist form | Tab walks 24 stops on desktop (logo, four section links, DE, EN, nav button, hero and section links, form email, consent, privacy link, submit, footer) and 20 on a phone (section links are hidden under 880 px). Order is the visual order. Enter on the skip link and on the submit button was exercised. |
| Visible focus everywhere                      | Every stop has `outline: 2px solid` pink (11.6:1 on the background). Inputs draw it flush (`outline-offset: 0`), everything else 2 px off.                                                                                                                                                                   |
| Skip link                                     | First Tab focuses "Skip to content" / "Zum Inhalt springen" (visible, top left, 48 px high); Enter moves focus into `main` (`activeElement` is `main`, hash `#main`).                                                                                                                                        |
| Heading order                                 | One `h1` per page, then `h2` per section, `h3` only under "Open code" (two plans), footer `h2`. No level skipped, in both locales.                                                                                                                                                                           |
| Form labels                                   | Email and consent have `<label for>`; the placeholder is never the only name. Honeypot is `aria-hidden` with `tabindex="-1"`. Native validation message appears on an empty submit and focus lands on the email field.                                                                                       |
| Error and status messages                     | JS path: `role="alert"` region, see fix 2. Success: `role="status"` panel that takes focus. No-JS path: 303 to a status page with `h1` and a title naming the outcome.                                                                                                                                       |
| Contrast                                      | See the table below. Smallest text ratio on the pages: 4.93:1 (the "powered by Voidcom" link, 155 text nodes checked on `/de/`, 147 on a phone, none below its threshold).                                                                                                                                   |
| Target size 2.5.8                             | See the table below.                                                                                                                                                                                                                                                                                         |
| Focus not obscured 2.4.11                     | The nav is `position: fixed`, 64 px high; `html` has `scroll-padding-top: 88px`. After every Tab stop (reduced motion, so no smooth scroll in flight) the focused element's top is below the nav's bottom edge; none is off screen. Anchors (`#waitlist`) land with the heading 152 to 208 px down.          |
| Reflow 1.4.10                                 | 320, 390 and 1280 px: no content is clipped except the decorative card fan, which bleeds 18 px at 320 px (see fix 1). Text-spacing overrides (line height 1.5, letter spacing 0.12em, word spacing 0.16em) add no overflow.                                                                                  |
| Motion                                        | `prefers-reduced-motion: reduce`: 0 running animations while scrolled, `scroll-behavior: auto`, transitions 0 s. Without the preference the scroll-driven animations run (3 to 9 on the landing page, depending on viewport).                                                                                |
| Language                                      | `<html lang>` is `de` / `en` per page (status, legal and 404 pages too, from the dictionary). The switch links carry `lang` and `hreflang` of their target, and `aria-current="true"` on the active one. The query string survives the switch.                                                               |

### Contrast, measured from the tokens

Ratios by the WCAG formula, on `--bg` #080808 unless noted. Text needs 4.5:1, UI components and
focus indicators 3:1.

| Pair                                                        | Ratio |
| ----------------------------------------------------------- | ----- |
| `--on-surface` (body, headings)                             | 18.19 |
| `--on-surface-muted` (64 %: lede, labels, footer links)     | 7.56  |
| `--on-surface-muted` on `--glass` (form, glass cards)       | 7.37  |
| `--on-surface-dim` (50 %: placeholder, "powered by", legal) | 4.93  |
| `--primary` links and focus ring                            | 11.59 |
| `--primary-hover` links                                     | 13.50 |
| `--on-primary` label on `--primary` (primary button)        | 11.59 |
| `--on-primary` label on `--primary-hover`                   | 13.50 |
| `--status-error` (form error)                               | 8.77  |
| `--outline-control` (input and checkbox edge, UI component) | 3.76  |
| `--glass-edge` (outlined button, card edge)                 | 1.38  |

The glass edge is decoration: the buttons and cards it frames are identified by their label and
content (18:1 and 7:1), so 1.4.11 does not ask for 3:1 there. The status dots always sit next to a
text label.

### Target sizes

Smallest interactive elements, measured: language links 32 x 32, nav button 36 high, logo link 44
high (24 wide at 320 px, mark only), buttons and inputs 48 high, footer links 28 high. Under 24 px:
the consent checkbox (20 x 20) and two standalone "powered by Voidcom" links (17 and 15 high).
Those pass the spacing exception of 2.5.8 (a 24 px circle around each touches no other target; the
checkbox also activates from its label) and axe's `target-size` rule agrees. Links inside running
text (the privacy link in the consent sentence) are exempt as inline.

## Fixes made

1. **Nav clipped at 320 px (1.4.10 Reflow).** Before: logo (119 px) + switch + "Warteliste" button
   needed 339 px in a 288 px column; `html` clips horizontal overflow, so the waitlist button ended
   at x = 355 on a 320 px screen, partly unreachable (also 11 px short at 360 px). After: under
   380 px the nav gap is 12 px, under 360 px the wordmark is hidden and the 24 px mark is the logo
   (the link keeps its `aria-label`); the button ends at x = 304. This is the only visible change
   to the design, on phones narrower than 380 px. Guarded by a test.
2. **Form error not reliably announced (4.1.3 Status Messages).** Before: the `role="alert"`
   paragraph was `hidden` and un-hidden together with its text, which several screen reader and
   browser pairs do not announce. After: the alert region is always in the DOM, empty (taken out of
   the grid flow with `.error:empty { position: absolute }`, so the layout is the same), and only
   its text changes.
3. **Focus thrown to `<body>` after a failed submit (2.4.3).** Before: the submit button was
   `disabled` while sending, which drops keyboard focus; after an error the next Tab started at the
   top of the page (`activeElement` was `BODY`). After: `aria-disabled="true"` plus a guard against
   double submits; focus stays on the button (`activeElement` is the button).

Nothing else failed, so tokens, layout, motion and copy are unchanged.

## Lighthouse

`lighthouse` 13.5.0, default mobile preset (412 x 823, 1.75 DPR, simulated Slow 4G and 4x CPU),
Chromium 156 headless, production build (`pnpm build`) served by `wrangler dev`. Reports:
[`lighthouse/de-mobile.json`](lighthouse/de-mobile.json),
[`lighthouse/en-mobile.json`](lighthouse/en-mobile.json).

| Page   | Performance | Accessibility | Best Practices | SEO | LCP   | CLS | TBT  | FCP   |
| ------ | ----------- | ------------- | -------------- | --- | ----- | --- | ---- | ----- |
| `/de/` | 100         | 100           | 100            | 100 | 1.4 s | 0   | 0 ms | 1.0 s |
| `/en/` | 100         | 100           | 100            | 100 | 1.4 s | 0   | 0 ms | 0.9 s |

Re-run:

```sh
pnpm build
cd apps/site && UNSUBSCRIBE_SECRET=x pnpm exec wrangler dev --port 4574   # keep running
pnpm dlx lighthouse@latest http://127.0.0.1:4574/de/ --output=json --output-path=de-mobile.json \
  --chrome-flags="--headless=new" --quiet
```

(`--preset=perf` would drop the other three categories, do not use it.)

Loading, as built: one stylesheet (the CSP forbids inlining, and Lighthouse's only remaining
suggestion is its 150 ms render-blocking cost), one preloaded font (Inter latin, `font-display:
swap`, `crossorigin`), no images (all art is inline SVG and CSS, sized by the layout), no
JavaScript outside the waitlist form's script. Layout shift is 0, including the font swap and the
form.

The Web Analytics beacon is only in the build when `PUBLIC_CF_ANALYTICS_TOKEN` is set, so the
reports above are without it. A probe build with a placeholder token kept Performance, Accessibility
and SEO at 100 and showed Best Practices 96: the beacon's report call to `cloudflareinsights.com`
is rejected by CORS because `127.0.0.1` is not the registered site, which Lighthouse lists as a
console error. That is an artefact of measuring locally with a fake token; re-measure on the
deployed dev Worker with the real token before relying on it.

## Not verified

- **Screen readers.** No VoiceOver, NVDA, JAWS or TalkBack run. Roles, names and live regions were
  checked in Chromium's accessibility tree and by axe, not by listening.
- **Real devices.** Touch target comfort, on-screen keyboard behaviour with the form, and iOS
  Safari rendering of `backdrop-filter` surfaces.
- **Forced colors (Windows high contrast) and 200 % text-only zoom** were not exercised; the custom
  checkbox and the glass surfaces rely on borders that forced colors would recolour.
- **Pages other than Chromium.** Firefox and Safari were not run through axe or the keyboard walk.
