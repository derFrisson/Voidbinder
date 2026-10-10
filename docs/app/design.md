# Web app design: source of truth

The web app (`apps/app`) follows the site's brand, direction B "Der Scan"
([`docs/site/design.md`](../site/design.md)), but is a working tool, not a landing page. The
approved mockup round (VB-55, Max 2026-10-09: "sehr gut, bitte umsetzen") lives next to this file in
[`mockups/`](mockups/) (`index.html` frames every screen at 1440 and 390 px; the renders are in
`mockups/shots/`). When this document and the mockups disagree, the mockups win for look and
density; the deviations below are deliberate. A live copy is deployed at
https://voidbinder-mockups.frisson.workers.dev (dev only).

## Tokens and type

All colours, fonts and spacing come from `@voidbinder/tokens` (`packages/tokens`), the same values
the site uses. Light default; dark only through the system preference. Blue (`--blue`) is the only
action colour: primary buttons, active tab, links, focus ring. The four game fields colour the page
of a game's set, card or deck (Pokémon yellow, Yu-Gi-Oh! violet, Magic orange, One Piece red) as a
soft tinted header with a dotted shape, never as text. Progress bars are ink, not blue. Prices,
card numbers, codes and set codes are JetBrains Mono; the collection value and headings are Sora
with tabular figures; everything else Public Sans.

## Layout

- Desktop (≥ 1024 px): left rail with Sammlung, Decks, Suche, Profil; top bar with breadcrumb,
  global search (`/` shortcut) and the scan pile button (placeholder until Sprint 3).
- Phone (< 768 px): bottom tab bar with the same four tabs, back button in the header, filters as
  horizontally scrolling chips, tables become lists, forms stack with a full-width primary button.
- Two content widths (VB-100), gutter `--gutter`, cards and panels on `--surface` with `--line`
  borders and 12 to 16 px radii:
  - `max-w-content`, 1240 px (`--maxw`, the site's): reading pages (home, game, profile, sign-in).
  - `max-w-catalog`, 1760 px (`<Page catalog>`): the pages made of grids and tables (card, set,
    search, ban list, collection, decks), so a wide window is used instead of left empty.
- Card grids (set page, search): 8 columns from a 1760 px window, 7 from 1240, 5 from 1024, 4 from
  768, 3 on phones; a tile is never narrower than at 7 columns in a 1240 px window.
- Card page: one column on phones; from 768 the stage column (320 px, 400 from 1180) beside the
  rest, with legality and card text side by side from 1180; from 1600 three zones: the stage
  (400 px), the title, buttons and prices (at least 496 px, both sources side by side), and the
  prints table with legality and card text stacked (at least 440 px, 1.25 times the middle; the
  prints table shows all six columns from 1760). Set names in the prints table keep to one line
  (two on phones) and end in an ellipsis.

## Screens (what each one must show)

| Screen       | Must have                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Game → sets  | Game chip, set list with code, release date, card count, completion when logged in                                                                                                                                                                                                                                                                                                                                                                                                                           |
| Set page     | Tinted header (code, release, card count, languages, completion bar and counts per finish), value strip (owned, missing, source and date), filter rows (rarity chips with counts, language, finish, owned/missing, sort, grid/list), dense card grid (7 columns at 1440, 3 at 390), missing cards greyed with "fehlt", owned badge "2×", price in mono with source and date, pagination                                                                                                                      |
| Card page    | Image on the tinted field, print thumbnails, rights notice under the image (per game, plus "Kartendaten über Scryfall" for Magic), title, type line, attribute chips, "In Sammlung" (blue) and "Auf Wunschliste" (outlined), owned/deck usage line, price panel with Cardmarket and TCGplayer side by side (source, language, condition, timestamp), condition row (NM real, EX/GD marked "≈" as estimates), one quiet history line with 30/90/365 day switch, prints table, legality chips, card text panel |
| Collection   | Habe/Will tabs, binders sidebar (drag order, game colour, count and value), value panel (Sora, split per game, source, date, estimate note), filters, table (quantity stepper, language, condition, finish, binder, unit and total), inline edit form under the row, wishlist rows with wish price vs current, empty binder state                                                                                                                                                                            |
| Deck builder | Tinted header with format chip and legality, rule cards per game (main/extra/side sizes, copies limit), three columns: search and add, grouped deck list with "habe" / "fehlt", "Was fehlt mir" box with quantities, unit prices and "Rest kostet … nach Cardmarket, Stand …", curve as quiet bars                                                                                                                                                                                                           |

## Refuses (same as the site)

Dark default, stock-market charts (candles, grids, red/green arrows), logos, set symbols, real
card art outside the allowed sources, placeholder stock imagery, gradient text, a second action
colour, icon-title-text feature grids, Lorem ipsum.
