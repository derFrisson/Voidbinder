# apps/app

The Voidbinder app (`@voidbinder/app`): Expo with Expo Router, NativeWind and TanStack Query. Web is
the first target; the iOS and Android builds come with the scanner (Sprint 3), so shared code uses
no web-only API without a `Platform.OS` check. Design: [docs/app/design.md](../../docs/app/design.md)
and the mockups next to it. Architecture: [ADR 0001](../../docs/adr/0001-stack.md).

## Layout

| Path                              | What                                                                                     |
| --------------------------------- | ---------------------------------------------------------------------------------------- |
| `src/app/`                        | Routes (Expo Router). `(protected)/` needs a session (`SessionGate`), the rest is public |
| `src/api/client.ts`               | The typed API client and the Better Auth client, both against `EXPO_PUBLIC_API_URL`      |
| `src/api/queries/`                | Every API call, as TanStack Query hooks (`useSession`, `useGames`, `useSignIn`, …)       |
| `src/components/`                 | The shell (rail, top bar, tabs, footer), form controls, states                           |
| `src/i18n/`                       | `de.ts` (defines `Dict`), `en.ts`, `useT()`; the profile's language, else the device's   |
| `tailwind.config.ts`              | Colours, fonts and width from `@voidbinder/tokens`, as CSS variables (light and dark)    |
| `src/worker.ts`, `wrangler.jsonc` | The Worker that serves the web build and proxies `/api/*` to the API                     |
| `src/security-headers.ts`         | CSP and the other headers: `dist/_headers` for assets, the Worker for its own answers    |

Routes: `/` (games), `/[game]` (sets), `/[game]/sets/[code]`, `/cards/[id]`, `/search`,
`/collection`, `/decks`, `/decks/[id]`, `/profile`, `/sign-in`, `/sign-up`, `/verify`,
`/reset-password`.

**Catalog browsing** (`src/components/catalog/`): home, the sets of a game and the set page. The set
page's filters (`lang`, `rarity`, `finish`, `sort`, `page`, `view`) live in the URL; the pure logic
(parsing, the reducer that resets the page, completion, grouping) is `model.ts`. The filter rows
come from the `facets` of `GET /catalog/sets/:game/:code` (rarity and finish counts, languages of the
whole set). What needs the collection (owned badge, "fehlt", completion, value strip) or the prices
renders only when `seams.ts` returns data: `useOwnedPrints` reads the signed-in user's copies of
the whole set (`GET /collection/owned?game=&set=`), `useSetPrices` maps the `marketPrice` of the
page's prints (VB-64), so a signed-out visitor sees prices but no owned badge, "fehlt" or value
strip, and never an invented number. The set page and
`/search` send the profile's `currency` (EUR when signed out) after the session is known
(`useCurrency` in `src/api/queries/cards.ts`). `marketPrice` carries the source and `observedAt`,
so the tiles and the value strip read "Quelle, Stand Datum". The `price` sort is the API's `sort=price` (high to low, unpriced last). "Recently viewed" is
`src/storage/recent.ts`: localStorage on the web behind a small `KeyValueStorage` seam, in memory
natively until Sprint 3.

**Search and card page (VB-35).** `/search` keeps its state in the URL (`q`, `game`, `set`,
`rarity`, `lang`, `finish`, `page`; `src/api/queries/search.ts` maps both ways and drops the
defaults), sends `GET /catalog/search` 250 ms after the last keystroke from two characters on and
pages by 30. `/cards/[id]?print=` shows the print from the URL, else the newest with an image, with
names and text in the user's language; its parts are in `src/components/card/`. Prices (VB-64):
`usePrintPrices` and `usePriceHistory` (`src/api/queries/cards.ts`) read the VB-30 routes; the panel
shows Cardmarket and TCGplayer with source, finish, near-mint and the observed time, the EX and GD
estimates (≈; LP, PL and PO behind "Mehr Zustände") and the history line (the series of the finish
from the source the currency prefers). The finish selector starts at the display price's finish and
offers the print's finishes plus the ones its price rows are filed under (Yu-Gi-Oh!: TCGplayer's
`first_edition` on a print that says `normal`); a source without a row for any finish is hidden
while the other has some. A print without price rows shows "no prices" and no number, a failed
read (5xx) an error with a retry. The prints table's price column is `marketPrice` of
`GET /catalog/cards/:id`. The API has
no language dimension, so there is no language switch. Search hits show their `marketPrice` like the
set page. "In Sammlung" and
"Auf Wunschliste" add the print (VB-31), signed out they lead to sign-in.

**Collection (VB-31).** `/collection` (`src/components/collection/`, hooks in
`src/api/queries/collection.ts`) has the Habe and Will tabs with their counts, the binder sidebar
(drag to reorder on the web, the sort button's arrows by keyboard and on phones, chips on phones),
the value panel from `GET /collection/summary` (the largest sum per source and currency, its date,
the split per game, the estimate note, "Noch keine Preise" without one), filters (game, condition,
language, search), the table (a list on phones) with a quantity stepper and the inline edit form
under the row, the wish list with wish price against the current one, the empty binder's pocket
page and the Cardmarket CSV download (a plain link to `/api/collection/export.csv`). Every edit
shows at once and rolls back when the API refuses (`useUpdateEntry`, `useUpdateWish`); new rows
carry a client-generated id, so a retried request adds nothing twice. "Karten hinzufügen" opens
`/search` (`?binder=` from a binder), where signed-in users get "+ In Sammlung" under each result.

**Decks (VB-34).** `/decks` lists the user's decks (game colour, format chip with "turnierlegal"
or how many rules are broken, value, missing copies) and creates one (game, format, name; a
client id, so a retry adds nothing twice). `/decks/[id]` (`src/components/deck/`, hooks in
`src/api/queries/decks.ts`) follows `docs/app/mockups/deck.html`: the game-tinted header with the
format chip, value and a rule card per zone and per card, then the broken rules as sentences in
the user's language (`decks.problems.<code>`); three columns from 1200 px (search and add, the
deck list, "Was fehlt mir" and the curve), one column below. The zones are tabs (Haupt / Extra /
Side for Yu-Gi-Oh!, Commander / Haupt for Magic Commander); the list groups by card type with
"habe n" / "fehlt n" and − / + per row, + is off at Yu-Gi-Oh!'s three copies. Every change writes
the whole list (`PUT /decks/:id/entries`), shows at once and rolls back when the API refuses; the
answer brings the new verdict. Adding uses VB-35's search in the deck's game, the hit becomes the
preferred print. "Was fehlt mir" lists the missing copies with unit and line prices and what the
rest costs per source with its date; "Fehlende auf Wunschliste" posts one wish per card (a card
already wished, 409, counts as done) and "Als Text kopieren" copies `n Name` lines (web only).

## Local development

```sh
pnpm build                 # once, from the root: builds the workspace packages the app imports
pnpm --filter api dev      # the API on http://localhost:8787 (see apps/api/README.md)
pnpm --filter app dev      # Expo on http://localhost:8081, talking to the API directly
```

`dev` sets `EXPO_PUBLIC_API_URL=http://localhost:8787`; the API admits `http://localhost:8081`
(`CORS_EXTRA_ORIGINS`) and the cookies work because both are `localhost`. Auth mails are logged
by `wrangler dev` (apps/api/README.md, Authentication).

To run the web build the way it ships, with the proxy, start both Workers in one `wrangler dev`
(the service binding then always finds this API, not another local session):

```sh
pnpm --filter app build
cd apps/app && pnpm exec wrangler dev -c wrangler.jsonc -c ../api/wrangler.jsonc --port 8790
```

Set `APP_URL=http://localhost:8790` in `apps/api/.dev.vars` for that, so Better Auth admits the
origin and the mail links point at it.

## Web build and deploy

`pnpm --filter app build` runs `expo export --platform web` (a single-page app in `dist/`, from the
template `public/index.html`) and writes `dist/_headers`. The Worker (`wrangler.jsonc`) serves
`dist/` as static assets with the SPA fallback; `run_worker_first` sends only `/api/*` to
`src/worker.ts`, which forwards it to the API Worker through the `API` service binding:

- `/api/auth/sign-in/email` becomes `/auth/sign-in/email` (the API's routes start at `/`);
- `cf-connecting-ip` is passed on, because the API's rate limits count per client IP;
- `set-auth-token` is removed from the answer; the browser keeps to its `HttpOnly` cookie.

So the session cookie is first-party on the app's origin and the browser never talks to the API's
host. Deploys run from Max's workstation ([ADR 0002](../../docs/adr/0002-deploys-from-workstation.md)):

```sh
pnpm --filter app deploy:dev    # voidbinder-app-dev on workers.dev, API voidbinder-api-dev
pnpm --filter app deploy:prod   # app.voidbinder.de, API voidbinder-api
```

The app has no secrets and no `vars`. The API's `APP_URL` must be the app's origin
(`https://voidbinder-app-dev.frisson.workers.dev`, `https://app.voidbinder.de`), since Better Auth
admits only that origin and builds the mail links from it.

**CSP:** no inline scripts (`script-src 'self'`). `style-src` needs `'unsafe-inline'`:
react-native-web inserts its styles into a `<style>` element at runtime and expo-font registers the
fonts the same way, and neither can carry a nonce. Images: self, `data:` and `img.voidbinder.de`.

## Tests

```sh
pnpm --filter app test
```

Three Vitest projects: `unit` renders the screens and hooks with @testing-library/react over
react-native-web in jsdom (not React Native Testing Library's web preset) with a
fake API (`test/fake-api.tsx`): i18n parity, the session and catalog hooks, sign-in, sign-up and
the opt-in, the route guard. `worker` runs the proxy against a fake service binding. `web` serves
the exported build with `wrangler dev` and drives it in Chromium (`pnpm exec playwright install
chromium` once): the home page, a deep link, the sign-in form, no CSP violation, and axe-core
(WCAG 2.2 AA) on home and sign-in at 1440 and 390 px in both colour schemes. It needs `pnpm build`
first, which turbo runs before `test`.

## Fonts

Sora, Public Sans and JetBrains Mono, the site's self-hosted latin woff2 files with their OFL
licences in `assets/fonts/`, loaded by expo-font under the token family names. Native builds need
static TTF files per weight (Sprint 3).
