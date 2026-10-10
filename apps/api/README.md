# apps/api

The Voidbinder API: a Cloudflare Worker with [Hono](https://hono.dev), Smart Placement,
PostgreSQL through Hyperdrive with Drizzle, and R2 for catalog files. The app talks to it through
the typed client in `src/client.ts`. Architecture: [ADR 0001](../../docs/adr/0001-stack.md),
caching: [ADR 0004](../../docs/adr/0004-caching-catalog-reads.md), environments and secrets:
[docs/environments.md](../../docs/environments.md).

## Layout

| Path                         | What                                                                                                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`               | Worker entry (`fetch`, `scheduled`, the `purgeCache` RPC of Caching) and `export type AppType`                                                          |
| `src/app.ts`                 | `createApp(deps)`: the Hono app from injected dependencies (tests need no binding)                                                                      |
| `src/routes/`                | Routes: `GET /health`, `/me`, `GET /catalog/**`, `/collection/**`, `/decks/**`, `/sync/**`, `POST /admin/import/<source>`, `GET /admin/prices/coverage` |
| `src/auth/`                  | Better Auth (`createAuth`), `requireUser`, auth mails, the app's auth client, 2FA encryption                                                            |
| `src/middleware/`            | Request id, JSON access log, error handler, default `Cache-Control: no-store`, catalog cache headers                                                    |
| `src/platform/cloudflare/`   | The only code that touches bindings: `createPlatform(env)` and the implementations                                                                      |
| `src/db/schema/`, `drizzle/` | Drizzle schema and the committed SQL migrations                                                                                                         |
| `d1/`                        | Migrations of the D1 search index (VB-98), applied by `deploy:dev` / `deploy:prod`                                                                      |
| `src/import/`                | Catalog importers (Scryfall, YGOPRODeck, TCGdex, Yugipedia), prices (`prices/`); see Importers, Prices                                                  |
| `src/workflows/`             | Cloudflare Workflows that run the importers                                                                                                             |
| `src/client.ts`              | `createApiClient(baseUrl, options?)`, exported as `@voidbinder/api/client`                                                                              |
| `src/auth/client.ts`         | `createApiAuthClient(baseURL, options?)`, exported as `@voidbinder/api/auth-client`                                                                     |

Request and response schemas (Zod) live in `packages/shared/src/api` and are imported from
`@voidbinder/shared/api`. Errors always have the shape `{ error: { code, message, requestId } }`
(plus `issues` on a 400 validation error); a 500 never carries the cause, which goes to the log.

## Platform seams

`packages/core/src/platform` defines `CardStore`, `BlobStore`, `VectorIndex` and `JobQueue`.
The Cloudflare implementations live in `src/platform/cloudflare`: `DrizzleCardStore`
(`drizzle-card-store.ts`, PostgreSQL via Hyperdrive), `R2BlobStore` (`r2-blob-store.ts`: the
public `CATALOG` bucket for `images/`, the private `RAW` bucket for the import's dumps) and
`WorkflowJobQueue` (`workflow-job-queue.ts`, a job type per Workflow binding). `VectorIndex`
(VB-37) is an interface only so far. `SearchIndex` (VB-98) is the typeahead's copy in D1,
`D1SearchIndex` (`d1-search-index.ts`); without the `SEARCH` binding the platform has none and the
typeahead reads Postgres.

`createPlatform(env)` opens two per-request pools: one on `HYPERDRIVE` (caching disabled, for
everything) and one on `HYPERDRIVE_CACHED` (reads cached up to 300 s, for the catalog and price
stores only, ADR 0004: `DrizzleCardStore` runs `ping` on the first and every catalog read on the
second). Without `HYPERDRIVE_CACHED` (self-hosting) both are the same pool.

## Catalog API

| Route                                                                  | Answer                                                                                 |
| ---------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| `GET /catalog/games`                                                   | Games with their set counts                                                            |
| `GET /catalog/games/:game/sets?lang=`                                  | Sets, newest first, with the name in `lang`                                            |
| `GET /catalog/sets/new?days=30&lang=`                                  | Every game's sets released in the last `days` (≤ 90); undated ones by import date      |
| `GET /catalog/sets/:game/:code?lang=&rarity=&finish=&sort=&page=`      | Set header and 60 prints per page (`sort`: number, name, rarity, price)                |
| `GET /catalog/cards/:id?currency=&lang=`                               | Card, legalities and every print with localizations and `marketPrice`                  |
| `GET /catalog/prints/:id`                                              | One print with its card                                                                |
| `GET /catalog/search?q=&game=&set=&rarity=&lang=&names=&finish=&page=` | 30 prints per page by name, text, set code and number (see Search)                     |
| `GET /catalog/search/suggest?q=&game=&lang=&names=`                    | Up to 8 prints and sets for the search box's typeahead (see Search)                    |
| `GET /catalog/prints/:id/prices?currency=&finish=&lang=`               | Current prices, display price, condition estimates (see Prices)                        |
| `GET /catalog/prints/:id/prices/history?days=&lang=`                   | Daily market prices per source and finish (see Prices)                                 |
| `GET /catalog/modules`                                                 | Manifests of the offline catalog modules, one per game (see Offline catalog modules)   |
| `GET /catalog/banlist/yugioh?format=&lang=`                            | Yu-Gi-Oh! ban list (`format` `tcg`, `ocg`): groups, 90 days of changes (see Ban lists) |

Schemas: `packages/shared/src/api/catalog.ts`. Every print (set page, search, typeahead, card
page per localization, collection, wish list and deck entries) carries `displayNumber` and
`displayCode` in the language shown (VB-97, `printNumbers` in `@voidbinder/core`): a Yu-Gi-Oh!
print shows its localization's stored code (VB-94, `external_ids.set_code`: `LON-G065`, French
`LDC-F065` under its own set code; see Yugipedia set lists), and without one a print with a
localization in that language swaps its token (`EN024` → `DE024`, Spanish `SP`, Japanese `JP`);
a collection entry uses its copy's language; Pokémon and Magic numbers stay.
`cardFormat` (`games.card_format`, migration `0012_card_format.sql`) is the card size for the
image box (`CARD_FORMATS` in `@voidbinder/shared`). Image URLs are `IMAGE_BASE_URL/<image_key>` once the
image is in R2 (VB-57) and the source's URL until then; which key a print shows, with `imageLang`
and `imageFrom`, is in Card images. Every 200 carries
`Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=60` and an `ETag` of
`catalog_version` plus a hash of the body (`src/middleware/catalog-cache.ts`); `If-None-Match`
answers 304. Cloudflare also caches them at the edge (see Caching). The queries use no `now()` or
other non-immutable function, so Hyperdrive can cache them.

## Ban lists

Yu-Gi-Oh! only (VB-81, schemas `packages/shared/src/api/banlist.ts`). The statuses are the
YGOPRODeck import's `cards.legalities.tcg` / `.ocg` (`Forbidden`, `Limited`, `Semi-Limited`,
`Unlimited`). Every change of any card's `legalities`, whichever importer writes it (so Magic and
Pokémon get history too), adds a `legality_changes` row through the trigger
`record_legality_changes` (`drizzle/0011_legality_changes.sql`); a new card adds none. The
effective date of each list comes from Yugipedia (`src/import/ygoprodeck/banlist-dates.ts`, two
requests per run, into `app_meta.banlist_<format>_effective`; a failed lookup keeps the old date
and never fails the run), because YGOPRODeck has none.

| Route                                              | Answer                                                                                                                   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `GET /catalog/banlist/yugioh?format=&lang=`        | `{ format, effectiveDate, asOf, groups: { forbidden, limited, semiLimited }, changes }`, cached like the catalog         |
| `GET /me/banlist-impact?game=yugioh&format=&lang=` | The user's collection cards changed in the last 90 days and deck lines changed or over the list's limit; fresh, no cache |

Changes count only between two different restrictions (a card entering a format unrestricted is
none) and are taken from the UTC day 90 days back, so the cached query stays the same all day.

## Caching

Three layers, each explicit about what may be stale (ADR 0004 and its addendum):

1. **Hyperdrive** caches the catalog and price queries (`HYPERDRIVE_CACHED`, 300 s + 60 s stale).
2. **Workers Caching** (VB-71, `"cache": { "enabled": true }` in every env of `wrangler.jsonc`)
   stores GET/HEAD responses in front of the Worker by their cache headers, on workers.dev and
   the custom domain alike. Zone Cache Rules do not apply to it. The catalog, price and module
   routes add `Cloudflare-CDN-Cache-Control: public, max-age=600, stale-while-revalidate=600`
   (ten minutes fresh, ten more served stale while the Worker refreshes; `s-maxage` in
   `Cache-Control` would switch stale-while-revalidate off) and a `Cache-Tag`:

   | Tag       | Responses                                                                                                       | Purged by                                                          |
   | --------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
   | `catalog` | `/catalog/**` except modules                                                                                    | every catalog import (Scryfall, YGOPRODeck, Yugipedia, TCGdex)     |
   | `prices`  | the responses that embed a price: `/catalog/sets/:game/:code`, `/cards/:id`, `/search`, `/prints/:id/prices/**` | the TCGCSV import (when it found a new build), the Scryfall import |
   | `modules` | `/catalog/modules`                                                                                              | nothing yet: the module build runs on the VPS (TTL only)           |

   A price-bearing response carries both, `catalog,prices`. There are no per-game tags: every
   catalog import purges all of `catalog`.

   The cache key is the path and query string as sent (`lang`, `currency` and the filters are
   query parameters) plus `Vary: Origin` from CORS; the Worker version is part of it too, so a
   deploy starts cold. Both Cloudflare headers are stripped before the response leaves.

3. **Browsers** keep a response 60 s (`max-age`), revalidate with the `ETag` afterwards.

Every other route answers `Cache-Control: no-store` (`src/middleware/headers.ts`), which Workers
Caching never stores; `src/auth/auth.test.ts` asserts it for `/me`, `/collection`, `/decks` and
`/auth`, signed in by cookie, by bearer and signed out. The public routes ignore the session, so a
cached answer is the same for everyone, with or without a cookie or `Authorization` header.

**Purge.** After `finish run` (which bumps `catalog_version`), each importer waits seven minutes
(`step.sleep`, `wait for the Hyperdrive cache`) and then runs a `purge cache` step
(`purgeEdgeCache`, `src/import/util.ts`); the Scryfall import waits and purges once, after its
price step, for `catalog` and `prices` together. The wait matters: a purged entry is refilled
through `HYPERDRIVE_CACHED`, which can serve the rows from before the import for 300 s + 60 s, and the edge
would then keep them another ten minutes; the extra minute (420 s, `PURGE_WAIT_SECONDS`) lets a
refill that read in the last stale second land before the purge. A purge only reaches the cache
of the entrypoint that calls it, and a Workflow is an entrypoint of its own, so `purgeCache(tags)`
(`src/platform/cloudflare/cache.ts`) calls the RPC method `purgeCache` on the default entrypoint
(`src/index.ts`), which runs `ctx.cache.purge({ tags })`. It never throws (a failed purge is a
`cache purge failed` warning, and the entries are at most 20 minutes old anyway) and is a no-op
where `ctx.cache` is unset: `wrangler dev` does not emulate Workers Caching; the tests pass no
`purgeCache` or record the calls.

**Check it** on a deployed env: the second request answers `cf-cache-status: HIT`; the hit rate is
on the Worker's Metrics page in the dashboard.

```sh
URL=https://voidbinder-api-dev.frisson.workers.dev/catalog/sets/mtg/plst
curl -sI "$URL" | grep -i cf-cache-status   # MISS, then HIT
# p50 of 40 hits (same URL) against 40 misses (a fresh query parameter each time)
for i in $(seq 40); do curl -s -o /dev/null -w '%{time_total}\n' "$URL"; done | sort -n | sed -n 20p
for i in $(seq 40); do curl -s -o /dev/null -w '%{time_total}\n' "$URL?nocache=$RANDOM$i"; done | sort -n | sed -n 20p
```

## Search

`GET /catalog/search` and its typeahead `GET /catalog/search/suggest` (VB-35, VB-79) are ranked
in PostgreSQL: full-text search, `pg_trgm` and two key functions of migration `0010_search.sql`.
`src/platform/cloudflare/drizzle-card-store.ts` (`search`, `suggest`, `codeHits`). The typeahead
reads a copy in D1 first (VB-98, next section).

- **Names and texts:** `websearch_to_tsquery('simple')` over `cards.search` and
  `print_localizations.search`, the last word as a prefix; a match in the name ranks first.
- **Name languages (`names`):** `all` (the default) matches the English card and every
  localization whatever `lang` is, so a German name finds its print while the names show in
  English. A language code (`names=de`) matches only the localizations in it (name and text):
  prints without one drop out, and the typeahead shows the newest print that has one (before
  VB-79 the typeahead matched names in `lang` only). `lang`
  stays the language the names are shown in. Set codes and numbers match either way. The
  language is compared as `lang || ''`, so the planner keeps the GIN indexes on the name and
  does not skip-scan the primary key `(print_id, lang)` for every name in that language.
- **Set code and number:** the query loses spaces, `-`, `/`, `_` and `.` and goes lower case
  (`LDS3-EN121` → `lds3en121`). Every prefix of it is tried as a set code through
  `catalog_code_key` (lower case, letters and digits, no leading zeros in a digit run: `SV01` →
  `sv1`, index `sets_code_key_idx`), the rest as a number in that set: the number as stored
  first (`lds3 en121`, `mid 123`), then without its language prefix and leading zeros
  (`catalog_number_key`: `LDS3-121`, `sv1 1`), then numbers starting with it (`lds3en12` →
  EN120…EN129). Yu-Gi-Oh! language codes (`DE`, `FR`, `IT`, `PT`, `SP`, `ES`, `JP`, `JA`) find
  the English print: other languages are localizations of it, not prints of their own
  (`BLGG-DE024` → BLGG-EN024), and the hit shows the number typed: `displayNumber` `DE024`,
  `matchedCode` `BLGG-DE024`, whatever `lang` is. A localization's stored code (VB-94) finds its
  print whole whatever set code it starts with (`LDC-F065` → LON 065, index
  `print_localizations_set_code_idx` over its letters and digits, migration
  `0016_localized_set_codes.sql`) and by its start after the print's set code (`long06`), in the
  localization's language. A set code alone (`lds3`, `mid`, `sv1`) lists the set.
- **Numbers:** `121` matches that number in every set, `001/128` in the sets of 128 cards
  (`prints_number_key_idx`), newest first, at most 50.
- **Typos:** when neither finds anything, names with a trigram similarity of 0.3 or more
  (`name % q`, GIN indexes `cards_name_trgm_idx`, `print_localizations_name_trgm_idx`), for
  queries of 4 characters and more without websearch syntax: `Satelite` finds Satellite Warrior.

`/search` ranks code matches above name matches, a set named alone below them. The typeahead
answers `{ suggestions: [{ kind: 'print' | 'set', id, name, game, set: { code, name }, number?,
variant?, rarity?, imageUrl?, cardId? }] }` (`packages/shared/src/api/search.ts`), at most 8, in
this order: the exact code, other number forms and partial numbers, sets by code or name prefix,
the first 3 prints of a set named by its code, cards whose name starts with `q` (in the
languages of `names`, shortest first), similar names. A name match shows the card's newest print.
Both are cached like every catalog route; the typeahead embeds no price, so it is tagged `catalog`
only.

### Search index (D1)

The typeahead answers from D1 next to the user ([ADR 0006](../../docs/adr/0006-search-index-d1.md)),
Postgres stays the source of truth:

- **Two paths.** `GET /catalog/search/suggest` asks `D1SearchIndex.suggest`
  (`src/platform/cloudflare/d1-search-index.ts`) first: the same tiers, ranks, names and images as
  `DrizzleCardStore.suggest`, read through the Sessions API (`withSession('first-unconstrained')`,
  the nearest replica) in two or three round trips (meta, codes, sets and name prefixes in one
  batch; similar names; the names and images of the answer). The code tiers use `parseCodeQuery`
  and JS twins of `catalog_code_key` / `catalog_number_key`; similar names take their candidates
  from an FTS5 trigram table over every distinct lower-case name (each word padded as pg_trgm
  pads it), and pg_trgm's `similarity`, ported to JS, decides with the same 0.3. The response's
  ETag carries the index's `catalog_version`, so the typeahead makes no Postgres round trip.
  `GET /catalog/search` stays on Postgres: it matches card texts, which the index does not hold.
- **Fallback to Postgres** when D1 throws, when the index was never synced or its last refresh
  (`meta.synced_at`) is older than 36 h (`MAX_INDEX_AGE_MS`), or when it has no suggestion (the
  first deploy, a query only Postgres would answer). Each response says which answered in
  `x-search-source: d1|postgres`; every typeahead request logs `search source` with `source` and
  `fallback` (`no index`, `unavailable`, `error`, `none`), a failing D1 also `search index failed`.
- **Refresh.** The Workflow `SearchIndexRefresh` (binding `SEARCH_INDEX_REFRESH`,
  `src/import/search-index.ts`) is started by the last step of every catalog import (after the
  image mirror) and by `POST /admin/search-index/rebuild` (bearer `ADMIN_TOKEN`, 202, rewrites
  every set). It reads Postgres through `HYPERDRIVE` (not the cached pool): an md5 per set over
  the set, its prints and names (with a Yu-Gi-Oh! localization's stored code, which `names.code`
  and `names.code_alnum` hold, `d1/0003_localized_codes.sql`); sets whose hash differs from D1's
  `sets.hash` are rewritten,
  about 1000 prints per step and D1 batch (one transaction: delete the set's rows, insert them
  again), sets gone from Postgres are deleted, names no print has any more too. The localizations
  have no `updated_at`, and the hash also sees deletions and renamed cards. Then `meta` gets
  `catalog_version` and `synced_at`, and the edge cache's `catalog` tag is purged when a set
  changed. One refresh at a time (a `lock` row, 2 h TTL): a second waits up to 12 × 5 min. The
  `search index refreshed` log line carries `sets`, `setsWritten`, `setsRemoved`, `rowsWritten`
  and `durationMs`. A full rebuild of the local catalog (1440 sets, 148,000 prints, 249,000 names)
  took 28 s in 172 steps and wrote 1.8 million D1 rows; a refresh without changes hashes for 2 s
  and writes nothing.
- **Parity.** `src/platform/cloudflare/d1-search-index.test.ts` refreshes a local D1 (miniflare
  through wrangler's `getPlatformProxy`) from the test catalog and expects every fixture query to
  answer exactly as Postgres does, images included. A change to the Postgres typeahead needs the
  same change in `d1-search-index.ts`.

## Local development

Needs the Docker Postgres from the repository root (`docker compose up -d`, port 5434).

```sh
pnpm --filter api db:migrate      # once, with DATABASE_URL set, see Migrations
pnpm --filter api dev             # wrangler dev on http://localhost:8787
curl localhost:8787/health        # {"status":"ok","db":"ok","version":"local"}
```

`wrangler dev` uses the top level of `wrangler.jsonc`: both Hyperdrive bindings point at
`localConnectionString` (no caching locally) and R2 is simulated under `.wrangler/state`. Copy
`.dev.vars.example` to `.dev.vars` (gitignored) and set `BETTER_AUTH_SECRET`
(`openssl rand -base64 32`); `wrangler dev` refuses to start without it. It also holds the local
`ADMIN_TOKEN`, and vars can be overridden there too.

## Tests

```sh
pnpm --filter api test
DATABASE_URL=postgres://voidbinder:voidbinder@localhost:5434/voidbinder pnpm --filter api test
```

Two Vitest projects: `unit` (`src/**/*.test.ts`, Node) runs the app through `createApp` with
fakes, the typed client against the in-memory app, the Scryfall mapping on the fixtures in
`test/fixtures/scryfall/` (real Scryfall objects, no network), and, when `DATABASE_URL` is set, the
migrations, the import pipeline, the catalog routes and the auth flows and `/me`
(`src/auth/auth.test.ts`) against Postgres. Tests that write the catalog or users each create their
own database on that server (`freshDatabase()` in `src/test-helpers.ts`) and drop it afterwards, so
the user needs `CREATEDB`. `worker` (`test/`, workerd via
`@cloudflare/vitest-plugin`) runs the real Worker with the bindings of `wrangler.jsonc`: the R2
blob store always, `/health` through Hyperdrive when `DATABASE_URL` is set. CI runs both with a
Postgres service.

## Authentication

[Better Auth](https://www.better-auth.com/docs) with email and password only, on the
cache-disabled pool (`platform.db`, ADR 0004). `src/auth/index.ts` builds the instance per
request (the pool is per request) on first use; `app.ts` mounts its handler at `/auth/*`.

**Flow.** Every path below is relative to the API; the web app reaches it as `/api/...` through
its own Worker (VB-25), so the cookies are first-party.

| Step            | Request                                                             | Result                                                                                             |
| --------------- | ------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Sign up         | `POST /auth/sign-up/email` `{ name, email, password }` + Turnstile  | 200 (also for a taken address, no enumeration); verification mail with `${APP_URL}/verify?token=…` |
| Verify          | `GET /auth/verify-email?token=…` (the app's `/verify` page)         | `{ "status": true }`; sign-in is refused with 403 until then                                       |
| Sign in         | `POST /auth/sign-in/email` `{ email, password }`                    | session cookie, plus the session token in the `set-auth-token` header for native clients           |
| Second factor   | `POST /auth/two-factor/verify-totp` `{ code, trustDevice? }`        | with 2FA, sign-in answers `{ twoFactorRedirect: true }` and no session; the code starts it         |
| Backup code     | `POST /auth/two-factor/verify-backup-code` `{ code, trustDevice? }` | instead of the TOTP code; each backup code works once                                              |
| Sign out        | `POST /auth/sign-out`                                               | session deleted, cookies cleared                                                                   |
| Forgot password | `POST /auth/request-password-reset` `{ email }` + Turnstile         | 200 always; mail with `${APP_URL}/reset-password?token=…` if the address exists                    |
| Reset password  | `POST /auth/reset-password` `{ token, newPassword }`                | new password set, every session of the user revoked                                                |
| Profile         | `GET /me`, `PATCH /me` (`UpdateMeRequestSchema`)                    | `MeResponseSchema` (`@voidbinder/shared/api`); 401 with `WWW-Authenticate: Bearer` when signed out |
| Delete account  | `DELETE /me`                                                        | 202, `deletionRequestedAt` set, every session revoked, cookies cleared                             |

Passwords have at least 10 characters; links are valid for one hour. `/auth/*` errors have Better
Auth's shape (`{ code, message }`), every other route the API's (`{ error: … }`).

**Sessions.** The cookie `__Secure-better-auth.session_token` is `Secure`, `HttpOnly`,
`SameSite=Lax`, `Path=/` and lives 7 days (refreshed daily on use). A signed copy of the session
(`…session_data`) is cached in a second cookie for 5 minutes, so most requests skip the database;
the `session` table stays the source of truth. Ceiling: on routes behind `requireUser`, a session
revoked elsewhere (password reset, `DELETE /me`, sign-out on another device) still passes on a
client that holds a fresh cache cookie, for up to those 5 minutes. `/me` uses `requireFreshUser`,
which always reads the table, so a revoked session gets 401 there at once. Bearer requests always
read the table. Browser requests
must come from `APP_URL` or `CORS_EXTRA_ORIGINS` (Better Auth's `trustedOrigins`, same list as
CORS).

**The web app's proxy (VB-25)** forwards `/api/*` to this Worker through a service binding and
must: strip the `/api` prefix (the API's routes start at `/`, e.g. `/auth/sign-in/email`,
`/me`); pass `cf-connecting-ip` on (the rate limits count per client IP); and strip the
`set-auth-token` response header, so the bearer token never reaches the browser, which keeps to
its `HttpOnly` cookie.

**Native clients (Sprint 3) and curl** send `Authorization: Bearer <token>` with the token from
`set-auth-token` (the `bearer` plugin); `createApiAuthClient(url, { bearerToken })` does that.

**Routes that need a user** use `requireUser` (`src/auth/middleware.ts`): it reads the session
once and sets `c.var.user`, or throws `unauthorized()` (401 with `WWW-Authenticate: Bearer`).
`GET /me` and `PATCH /me` read the `user` row itself, so a change shows up at once even while the
cookie cache holds the old profile.

**Account deletion is a stub until VB-45:** `DELETE /me` records the request and ends every
session; the job that purges the account and its data after the grace period comes with VB-45.
Signing in again within the grace period withdraws the request (`deletionRequestedAt` back to
null, like Discord): every completed sign-in clears it (`voidbinderHooks` in `src/auth/index.ts`),
with 2FA only once the second factor passed, so the password alone cannot withdraw it.

**Rate limits** count per client IP (`cf-connecting-ip`) in the `rate_limit` table, so every
isolate sees the same count: sign-up 3, sign-in 5 and the two 2FA code checks
(`/two-factor/verify-totp`, `/two-factor/verify-backup-code`) 5 per minute each
(`AUTH_RATE_LIMITS`), the other `/two-factor/*` routes 3 per 10 seconds (the plugin's rule), Better
Auth's defaults elsewhere (password-reset and verification mails 3 per minute), `/get-session`
unlimited. Over the limit: 429 with `X-Retry-After`. A request without the header falls into one
shared bucket, so the web app's proxy must pass `cf-connecting-ip` on.

**Two-factor authentication (VB-68)** is Better Auth's `twoFactor` plugin with TOTP: issuer
"Voidbinder", 6 digits, 30 seconds (a code from the step before or after is accepted too), 10
backup codes. In the order the app uses it, all with the session:

| Step             | Request                                                      | Result                                                                   |
| ---------------- | ------------------------------------------------------------ | ------------------------------------------------------------------------ |
| Set up           | `POST /auth/two-factor/enable` `{ password }`                | `{ totpURI, backupCodes }`; 2FA stays off; 400 for a wrong password      |
| Turn on          | `POST /auth/two-factor/verify-totp` `{ code }`               | the first valid code turns it on (`user.two_factor_enabled`)             |
| New backup codes | `POST /auth/two-factor/generate-backup-codes` `{ password }` | `{ backupCodes }`; the old ones stop working                             |
| Turn off         | `POST /auth/two-factor/disable` `{ password }`               | 2FA off, secret and backup codes deleted, every trusted device forgotten |

- **Sign-in with 2FA:** the password step deletes the session it made and sets the signed
  `two_factor` cookie (10 minutes, 5 tries); the code step then creates the session. Any wrong code,
  TOTP or backup, answers the same 401 `{ code: "INVALID_CODE" }`; the plugin also locks the second
  step for 15 minutes after 10 failures in a row (429). `trustDevice: true` sets the `trust_device`
  cookie (HttpOnly, 30 days, renewed on each sign-in, backed by a `verification` row): that browser
  skips the code step. Turning 2FA off, setting it up again and a password reset delete every
  trusted-device row of the user (`forgetTrustedDevices` in `src/auth/index.ts`), so each browser
  gets the challenge again.
- **Native clients** get the same challenge through the client plugin (`twoFactorClient` in
  `createApiAuthClient`): they keep the `two_factor` cookie between the two calls (Better Auth's
  Expo plugin stores cookies) and take the session token from `set-auth-token` of the code step.
  Turning 2FA on or off replaces the session; the new token is in `set-auth-token` (the body still
  names the old one).
- **Secrets at rest:** the TOTP secret is encrypted by Better Auth (with `BETTER_AUTH_SECRET`) and
  again with AES-256-GCM under `TWO_FACTOR_ENCRYPTION_KEY` (`withEncryptedTotpSecret` in
  `src/auth/two-factor.ts`, around the database adapter); the backup codes with the same key
  through the plugin's `storeBackupCodes`. A database dump alone gives neither.
- **Password reset keeps 2FA** (and forgets the trusted devices); `DELETE /me` and the session
  revocation are unchanged.
- **Known limits of the plugin (better-auth 1.7.7):** the backup codes are encrypted, not hashed
  (the plugin compares the stored value when it consumes one), so whoever has the database and
  `TWO_FACTOR_ENCRYPTION_KEY` can read them. A TOTP code is not remembered once used: it works again
  until its window ends (the 30 seconds plus one step either side), within the rate limits above.
- **Lost both factors:** the app tells the user to write to hello@voidbinder.de. There is no
  self-service way around the second factor; support turns it off by hand after checking the
  person (delete the `two_factor` row, set `user.two_factor_enabled` to false).

**Turnstile (VB-72)** guards the three endpoints that create an account or send a mail to an
address the caller names: `POST /auth/sign-up/email`, `/auth/request-password-reset` (also
`/auth/forget-password`) and `/auth/send-verification-email`. `requireTurnstile`
(`src/middleware/turnstile.ts`, mounted in `app.ts` in front of the Better Auth handler, so a
request that fails it costs no database work) reads the widget's token from the
`cf-turnstile-response` header (or a field of that name in the JSON body) and checks it with
Cloudflare's Siteverify (`remoteip` = `cf-connecting-ip`):

| Case                                                                                             | Answer                                                                              |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| token missing, wrong, spent or expired                                                           | 400 `{ error: { code: "turnstile_failed", … } }`                                    |
| Siteverify unreachable, slow (5 s) or garbled                                                    | 503 `{ error: { code: "turnstile_unavailable", … } }`, never a silent pass          |
| Siteverify rejects our secret (`missing-input-secret`, `invalid-input-secret`, `internal-error`) | 503 `turnstile_unavailable`, logged at error level: an outage, not the user's fault |

Only `POST` on those paths is checked; sign-in, the reset itself and everything else are not. The
check is skipped when `TURNSTILE_SECRET` is Cloudflare's test secret **and** `IMPORT_ENV` is
`local` (`skipsTurnstile`), so a developer needs no widget; any deployed environment verifies for
real. `TURNSTILE_NATIVE_BYPASS=true` additionally lets a request with `Authorization: Bearer …`
through: a stopgap for native clients until Sprint 3 brings a widget to React Native; the default
is off, and native requests without a token are refused. The header is never validated, so `true`
turns the check off for any client that sends one, not just native ones. A token works once and lives 5 minutes,
so a client asks the widget for a new one after every failed attempt. The sitekey var
`TURNSTILE_SITE_KEY` is not read by the API (the clients render the widget); it sits next to the
secret so the pair is documented in one place (docs/environments.md, Secrets).

**Secret:** `TURNSTILE_SECRET` (the widget's secret key; locally the test secret in
`.dev.vars.example`). Deployed once per environment from `apps/api`:
`pnpm exec wrangler secret put TURNSTILE_SECRET --env dev|prod`, under `secrets.required` too.

**Mails** (verification, password reset) go out through the `EMAIL` binding (Cloudflare Email
Service, `hello@voidbinder.de`, sender name "Voidbinder") in the user's `language`; sign-up sets
it from `Accept-Language` (`de` otherwise). Always the binding: locally `wrangler dev` simulates
it, logs the mail and writes its text and HTML under `.wrangler/tmp/email/`. A mail that cannot be
sent is logged as an error without its link. The copy is in `src/auth/mail.ts`. Better Auth's own
log lines (warn and up) go through the API's JSON `log()` with `source: "better-auth"`.

**Secret:** `BETTER_AUTH_SECRET` (32+ bytes) signs cookies and tokens. Locally in `.dev.vars`;
deployed once per environment from `apps/api`:
`openssl rand -base64 32 | pnpm exec wrangler secret put BETTER_AUTH_SECRET --env dev|prod`.
`wrangler.jsonc` lists it under `secrets.required`, so a deploy fails while it is unset. Changing
it signs everyone out.

**Secret:** `TWO_FACTOR_ENCRYPTION_KEY` (32 bytes in base64) encrypts the 2FA secrets. Locally in
`.dev.vars`; deployed once per environment from `apps/api`:
`openssl rand -base64 32 | pnpm exec wrangler secret put TWO_FACTOR_ENCRYPTION_KEY --env dev|prod`.
Under `secrets.required` too. Never change it once users have enrolled: every authenticator and
backup code becomes unreadable (their code step then fails with 500), and those users need support.

**A test user locally** (with `pnpm --filter api dev` running and the database migrated; the
local Turnstile check is skipped, a deployed API needs `-H 'cf-turnstile-response: <token>'` on the
sign-up):

```sh
curl -X POST localhost:8787/auth/sign-up/email -H 'Content-Type: application/json' \
  -d '{"name":"Test","email":"test@example.test","password":"correct horse battery"}'
# the wrangler dev output shows the mail; open its text file and copy the token of the link
curl "localhost:8787/auth/verify-email?token=<token>"
curl -i -X POST localhost:8787/auth/sign-in/email -H 'Content-Type: application/json' \
  -d '{"email":"test@example.test","password":"correct horse battery"}'   # note set-auth-token
curl localhost:8787/me -H 'Authorization: Bearer <set-auth-token>'
```

**Schema.** `src/db/schema/auth.ts` is generated by the Better Auth CLI (header of the file) and
migrated like every other table (`drizzle/0002_auth.sql`, with CHECKs on `language`,
`currency` and the length of `display_name`; `drizzle/0007_two_factor.sql` for the `twoFactor`
plugin). Regenerate it, then `db:generate`,
whenever the auth config or a plugin changes.

## Migrations

`pnpm --filter api db:generate` writes a migration to `drizzle/` from `src/db/schema`; commit it.
The site migrates the same databases, so the API keeps its own journal table
`drizzle.__drizzle_migrations_api` (`drizzle.config.ts`; every programmatic `migrate()` passes
`migrationsSchema: 'drizzle'`, `migrationsTable: '__drizzle_migrations_api'`).

Deployed databases are migrated from the workstation through the SSH tunnel of the
[database runbook, section 5](../../docs/guides/database-vps.md#5-roles-and-databases), as
`voidbinder_migrate` (the Hyperdrive roles have no DDL rights). With the tunnel open, from the
repository root:
Alternatively, on the VPS itself: `~/voidbinder/scripts/vps/migrate.sh api dev|prod` (runbook section 5,
"Alternative: apply migrations from the VPS itself").

```sh
read -rs PGPW   # voidbinder_migrate password
DATABASE_URL="postgres://voidbinder_migrate:$PGPW@localhost:15432/voidbinder_dev?sslmode=no-verify" \
  pnpm --filter api db:migrate
DATABASE_URL="postgres://voidbinder_migrate:$PGPW@localhost:15432/voidbinder?sslmode=no-verify" \
  pnpm --filter api db:migrate
unset PGPW
```

Migrate before deploying code that needs the new schema.

## Importers

### Import monitoring

Every run is an `import_runs` row (`running`, then `ok` or `failed` with `stats` and `error`).
`GET /admin/imports` (bearer `ADMIN_TOKEN`) lists the last 30 per source, newest first, with the
duration and the counts, plus `health`; `GET /admin/imports/health` answers the `health` block
alone: `ok`, a one-line `message` (`OK`, or `missing: …; failed: …`) and per scheduled source its
cadence, last success and the flags `missing` (no `ok` run within the cadence plus 2 hours) and
`failed` (the newest finished run failed). The cadences are `IMPORT_CADENCE` in
`src/import/health.ts`: wrangler.jsonc's crons (schedule.test.ts checks they agree) and the VPS
image mirror, listed as `image-mirror` (its `images` rows carry `stats.query.sm`; the Workflows'
own image steps stay `images`). `IMPORT_ENV=dev` leaves TCGCSV out (no dev cron). Both answer
200 whatever the health; `scripts/vps/import-health.sh` pushes the result to Uptime Kuma every
morning (docs/guides/database-vps.md, section 8). Re-running a failed import:
docs/guides/go-live.md, step 14.

### Scryfall (Magic)

`src/import/scryfall/` imports Scryfall's bulk data; it is the pattern for the other importers. `pipeline.ts` runs these steps, each retried on its own:

1. `start run`: a row in `import_runs` (`running`).
2. `bulk index`: `GET https://api.scryfall.com/bulk-data` for today's file URLs.
3. `download default_cards` / `download all_cards`: the gzip JSON Lines files stream unchanged
   into R2 (`all_cards` only when `SCRYFALL_LANGUAGES` lists more than `en`).
4. `split …`: each raw file is read back from R2, decompressed as a stream and written as chunks
   of 2000 lines (`all_cards`: only the lines in the wanted languages).
5. `sets`: `GET /sets` (raw copy in R2) → `sets` and `set_localizations` (`en`).
6. `cards 00000` … one step per chunk: cards, prints and the print's own-language localization,
   upserted in transactions of 500 objects; then `localizations 00000` … for the other languages.
7. `finish run`: `import_runs` → `ok` with the counts in `stats`, and `catalog_version` + 1, in one
   transaction; a retried step finds the run no longer `running` and bumps nothing. A failure
   before that marks the still running run `failed` and leaves `catalog_version` alone.
8. `clean up chunks` deletes the run's chunks. It runs after the run is finished: when it fails, the
   chunks stay (and a warning is logged), the run stays `ok`.

Rows are upserted on their unique keys and only written when the hash of the mapped payload
(`source_hash`) changed, so a re-run with the same data touches nothing. Some prints of a card
carry its faces and others do not (Omen cards): the card is written from the print with the most
faces, and a batch never replaces stored faces with fewer, so the print order does not matter. Skipped: tokens, emblems,
art series, digital-only cards and sets, token sets. Reversible cards map to the card of their front
face. Old School legality is per print at Scryfall and is not kept on the card.

R2 layout (the private bucket `voidbinder-raw`, binding `RAW`, shared by all environments;
`<env>` is the `IMPORT_ENV` var: `local` for `wrangler dev`, `dev`, `prod`). The raw dumps never
go to the public `voidbinder-catalog` (`CATALOG`): republishing them breaks Scryfall's terms, and
its `R2BlobStore` refuses every key outside `images/` and `modules/`.

| Key                                                        | What                                        |
| ---------------------------------------------------------- | ------------------------------------------- |
| `raw/<env>/scryfall/<date>/default_cards.jsonl.gz`         | Raw bulk file as downloaded, kept           |
| `raw/<env>/scryfall/<date>/all_cards.jsonl.gz`             | Raw bulk file as downloaded, kept           |
| `raw/<env>/scryfall/<date>/sets.json`                      | Raw `GET /sets` answer, kept                |
| `work/<env>/scryfall/<run id>/{default,all}_cards/*.jsonl` | Chunks of one run, deleted when it succeeds |

The Workflow `src/workflows/scryfall-import.ts` (binding `SCRYFALL_IMPORT`) wraps every step in
`step.do` (3 retries with exponential backoff, 30 min timeout). Completed steps are never run again
within an instance, so after a failed step the instance continues where it stopped, and a
restarted Worker resumes the instance at the first unfinished step. Step results are small counts
(Workflows keeps at most 1 MiB per step); a run has about 100 steps (limit 10,000). Splitting the
2 GB `all_cards` dump in one step needs more than the default 30 s of CPU, hence `limits.cpu_ms`
300000 in `wrangler.jsonc`. That limit is Worker-wide: it applies to every request and cron of the
API too, not only to the Workflow. After the first run on `dev`, check the CPU time of the
`split all_cards` step in the dashboard (Workflows → instance → step); if it is near the limit,
split the file in more than one step.

It starts daily (cron trigger: prod 03:00 UTC, dev 04:30 UTC; instance id `scryfall-<date>`, so
one per day) and on `POST /admin/import/scryfall` with `Authorization: Bearer $ADMIN_TOKEN`. That
answers 202, or 409 `{"error":{"code":"import_running"}}` while a Scryfall run in `import_runs` is
`running` and started less than 6 h ago (an older one is taken as dead). The Workflow reaches the
bindings only through `scryfallImportDeps(env)` and `startScryfallImport(env, id?)` in
`src/platform/cloudflare/`.

Locally (Docker Postgres migrated, `.dev.vars` from the example):

```sh
pnpm --filter api dev
curl -X POST -H 'Authorization: Bearer local-dev-admin-token' localhost:8787/admin/import/scryfall
```

`wrangler dev` runs the Workflow in-process and simulates R2 under `.wrangler/state`; the run takes
about 90 s and its result is in `import_runs`. On `dev` the orchestrator triggers it the same way
against `https://voidbinder-api-dev.frisson.workers.dev` with the deployed token; the instance and
its steps show in the dashboard or with
`pnpm exec wrangler workflows instances list voidbinder-scryfall-import-dev`.

### TCGdex (Pokémon)

`src/import/tcgdex/` imports [TCGdex](https://tcgdex.dev) in English and German through its REST API
(`GET /v2/{lang}/sets`, `/sets/{id}`, `/cards/{id}`), the only bulk path it has: the
`cards-database` repository holds TypeScript sources, its releases have no assets and the GraphQL
endpoint returns brief cards and takes no language. The client keeps under 10 requests per second,
sends the `User-Agent` and retries 429 and 5xx (TCGdex answers 503 now and then). One Pokémon card is
one print, so a card id (`swsh3-136`) is both `cards.oracle_key` and the print (`number` = `localId`);
English creates it, German adds the `print_localizations` row and the set name, a card TCGdex lacks in
German only has its English row. Prices, TCGdex's `updated` and the Pokémon TCG Pocket series
(`tcgp`, digital) are never imported; the image URLs (`/high.webp`, `/low.webp`) go to
`external_ids.tcgdex_images` for VB-57 and nothing is downloaded (a card without `image`, e.g. the
`mep` and `svp` promos, gets the conventional `assets.tcgdex.net/<lang>/<serie>/<set>/<localId>`
when one paced `HEAD` of its `high.webp` answers, VB-85); Cardmarket and TCGplayer ids go
to `external_ids.tcgdex_marketplace` with `mapping_confidence: 'low'` (not under `tcgplayer`, which
`prints_tcgplayer_idx` reads), for VB-30 to verify. The Workflow `src/workflows/tcgdex-import.ts`
(binding `TCGDEX_IMPORT`, params `{ mode }`) runs `start run`, `set list`, `sets 00000` … (25 sets
per step: details in both languages, upserts), `plan`, `cards <set> <n>` (100 cards in both
languages per step, upserted in one transaction) and `finish run` (counts in `stats`,
`catalog_version` + 1; a failure marks the run `failed`); a failed step is retried alone. A full
import is about 42,000 requests (roughly 80 minutes), so the daily run (its own cron, prod 04:00 and
dev 05:30 UTC, instance id `tcgdex-<date>`, not started while a TCGdex run is still going) is `incremental`: it
fetches the cards only of sets that are new, have fewer prints or German localizations than TCGdex
lists (the 404s recorded in `sets.external_ids.missing_cards` count as present), whose set details
in either language differ from `sets.external_ids.detail_hash`, that were released less than 90
days ago, or whose day of the 30-day rolling refresh it is (about 1,400 requests a day);
`POST /admin/import/tcgdex?mode=full` with the admin token refetches every set (202, 409 while a
TCGdex run is `running`, 400 for another mode). Rows are upserted on their unique keys and only
written when their `source_hash` changed. Raw copies stay in R2 under `raw/<env>/tcgdex/<date>/`:
`sets.en.json`, `sets/<lang>/<id>.json` and `cards/<set>/<chunk>.<lang>.jsonl`. Locally the same
`pnpm --filter api dev` and `curl -X POST … localhost:8787/admin/import/tcgdex` as for Scryfall work;
two sets in both languages (265 cards) took 60 seconds.

### YGOPRODeck (Yu-Gi-Oh!)

`src/import/ygoprodeck/` has the Scryfall shape (Workflow `src/workflows/ygoprodeck-import.ts`,
binding `YGOPRODECK_IMPORT`, `POST /admin/import/ygoprodeck`, one instance `ygoprodeck-<date>`
from the daily cron, prod 03:30 and dev 05:00 UTC; `CRON_SOURCES` in `src/import/schedule.ts` maps
every cron to its source). A run makes three requests (plus two to Yugipedia for the ban lists'
dates, see Ban lists), `cardinfo.php?misc=yes` (English),
`cardinfo.php?language=de` and `cardsets.php`, far below the guide's 20 per second and never one
per card; the answers go gzip-compressed to `raw/<env>/ygoprodeck/<date>/` in `RAW` and are split
into chunks of 1000 cards, one step each. `sets.code` is the lowercase set code (`lob`, the
printed one in `external_ids.set_code`), and every grouping keys on it; a code listed twice in
`cardsets.php` (anniversary editions) is one set with the others in `external_ids.editions`.
`cards.oracle_key` is the card's id, `attributes` its stats (`rank` for Xyz, `?` for a `?`
ATK/DEF), `legalities` the TCG/OCG ban list. A print is one set code, number and rarity, because
a code in another rarity is another physical card: `prints.variant` is the rarity slug
(`secret-rare`), `prints.rarity` the display name, finishes always `['normal']`, and the same
code and rarity listed twice stays one print. A language variant (`LOB-DE001`) folds into the
English print of the same number and rarity (`external_ids.variants`), one without it is a print
of its own (`external_ids.language`); every print gets an `en` and a `de` localization. A
localization in another language carries the print's code in it by rule (VB-94, `ruleCode`:
`BLGG-EN024` → `BLGG-DE024`, `LON-065` → `LON-DE065`, Spanish `SP`) in `external_ids.set_code`,
`set_code_source: 'rule'` (the Yugipedia names import seeds its rows alike); a code the Yugipedia
set lists verified (`set_code_source: 'yugipedia'`) is kept by both (`keepYugipedia`). The German
list keys a card by its passcode, the English one sometimes by an alternate artwork's (Dark
Magician is `46986414` in German, `46986420` in English): a German entry whose id is no card is
matched through its `card_images` ids, only to the card whose English name is the entry's
`name_en` (a Skill Card shares an artwork id, not the name), and the row keeps the entry's id in
`external_ids.ygoprodeck` (the real passcode, which the Yugipedia import accepts). Every run upserts the German row of
every print of every matched card, so a print added later gets it the next day (VB-93). Images are
never fetched here: the source URLs sit in `external_ids` for the mirror (VB-57) and the API does
not serve them. Skipped and counted in `stats.skipped`: cards in no set and prints whose code and
rarity another card already holds (the first keeps it); the first 50 of those are listed in
`stats.codeConflicts` (`<code> <rarity>: <card id>`) for cleaning by hand. Follow-up: when the
source moves a code to another card, the print stays with the old one until it is moved by hand.
Locally, `POST /admin/import/ygoprodeck` as for Scryfall.

### Yugipedia (Yu-Gi-Oh! names and texts in other languages)

YGOPRODeck has no German entry for about 2,500 cards (Lev Shaddoll Fusion, `34950192`, answers "No
card matching your query"). `src/import/yugipedia/` fills them from
[Yugipedia](https://yugipedia.com) (VB-93), whose card pages carry the name, lore and Pendulum
Effect in German, French, Italian, Spanish and Portuguese as Semantic MediaWiki properties. The
Workflow `src/workflows/yugipedia-import.ts` (binding `YUGIPEDIA_IMPORT`) runs `start run`, `plan`
(every Yu-Gi-Oh! card with a print that lacks one of `de`, `fr`, `it`, `es`, `pt`, less the cards
looked up in the last 30 days, written to R2 in chunks of 100), `cards 00000` … (one per chunk) and
`finish run` (`catalog_version` + 1 and the edge cache purged only when a row was written). A chunk
asks `action=ask` for the pages in `Category:Duel Monsters cards` whose `Password` is one of ten
passcodes (the wiki refuses a query with 15), and for the cards still missing that have no passcode
on the wiki (Skill Cards, tokens: YGOPRODeck gives them placeholder ids) and the cards keyed by an
alternate artwork for the page titled with the English name, accepted only when the page names no
passcode other than the card's or the one its YGOPRODeck row keeps in `external_ids.ygoprodeck`.
Each language the page has becomes a `print_localizations` row for every print of the card, with
`external_ids.yugipedia` = the page title (on the row, not on the card: `cards` has no
`external_ids` column, and the row is what marks Yugipedia as its owner); a row another importer
wrote is never overwritten (YGOPRODeck's daily German pass takes the card over once it has it), a
Yugipedia row is rewritten only when the page changed. Wikitext becomes plain text (`<br />` → line
break, link labels kept, italics dropped); a Pendulum Monster's text is laid out as YGOPRODeck's
(`[ Pendulum Effect ]` then `[ Monster Effect ]` or `[ Flavor Text ]`). Requests are one second
apart (self-imposed; Yugipedia's robots.txt sets `Crawl-delay: 1` only for msnbot) with a
`User-Agent` naming voidbinder.de and the contact address; the answers stay in `RAW` under
`raw/<env>/yugipedia/<date>/cards-<n>.json`. Every card a chunk looked up, found or not, goes into
the `app_meta` map `yugipedia_checked` (passcode → day) and is not asked again for 30 days, so the
~80 cards Yugipedia lacks and pages without a language are not re-asked every week (a print added to
a card in that time waits for the next lookup too). The first run on a catalog covers the whole
catalog, about 1,400 requests (25 minutes); the weekly cron (prod Mondays 04:30, dev Mondays 06:00
UTC, instance `yugipedia-<date>`, not started while a run is going) then asks for new cards and
those whose 30 days are up. YGOPRODeck also publishes French, Italian and Portuguese dumps; reading
them daily would be the cheaper source for those languages (a later ticket), with Yugipedia left for
Spanish and the gaps. `POST /admin/import/yugipedia` starts one on demand (202, 409 while one is
`running`). The content is CC BY-SA 4.0, and adapted (wikitext converted, Pendulum texts re-laid
out): the app credits it in the footer and on every Yu-Gi-Oh! card page (`YUGIPEDIA_ATTRIBUTION` in
`@voidbinder/shared/notices`, source and licence linked), and the offline module's `meta` and
manifest carry it as `attribution`.

### Yugipedia set galleries (Yu-Gi-Oh! artwork per print)

YGOPRODeck keeps one image per passcode, the first of `card_images`, and its `card_sets` say
nothing about artworks, so every print of a card with several artworks (125 cards, 1,683 prints
in 412 sets in the 2026-10-10 dump: Dark Magician has nine) and every Extended Art or alternate-art
reprint (RA05-EN141 Red-Eyes Dark Dragoon) showed the default picture. `src/import/yugipedia/galleries.ts`
(VB-106) takes the scan each print was printed with from Yugipedia's set card galleries.

**What the wiki has (checked 2026-10-10).** Namespace 3024 `Set Card Galleries` holds about 7,200
pages, `<set> (TCG-<region>-<edition>)` for the TCG: regions `EN` (and `NA`, `EU`, `AU` on old
sets), `DE`, `FR` (`FC`), `IT`, `SP`, `PT`; editions `1E`, `UE`, `LE` (or none). 958 of
YGOPRODeck's 1,031 set names have one (matched on the name without case, punctuation or a `(TCG)`
suffix), 4,169 pages in all; non-English galleries exist for about 250 sets and their scans are
often not uploaded (RA05 has no German gallery, RA04's German page lists rows without scans). Each
page calls `{{Set gallery|rarity=…|` once per rarity, one row per print: `number; name; rarity;
alt // options`. Module:Card collection/modules/Set gallery/handlers builds the file name
`<image name>-<set prefix>-<region>-<rarity abbr>-<edition>-<alt>.<ext>` (empty parts dropped,
`png` unless `// extension::jpg`, `// file::` replaces it): the image name is the English name
without its `(…)` disambiguation and without `#,.:'"?!&@%=[]<>/☆★・-` and spaces
(Module:Card image name), the rarity abbreviation comes from Module:Data/static/rarity/data
(`StR`, `UR`, `QCScR`, `PlScR`, … copied into `galleries.ts`). The alt code is a free file name
suffix, not a fixed set of flags: `EA` (Extended Art), `AA`, `AA2`, `Alt` (alternate artworks),
`B`/`C`/`D` and `ReprintB` (several scans of one number, LCKC-EN001 in four Blue-Eyes artworks),
`L`/`S`/`K`/`J` (deck letters), `2`/`3` (copies). It is each gallery's own: RA04's English page
marks Aleister's Platinum Secret Rare `AA`, the German page has no code there. Many rarities have
no scan (of RA05's 697 files, 142 Starlight Rares missing, 7 present). `imageinfo` answers the URL
(`https://ms.yugipedia.com//b/bf/RedEyesDarkDragoon-RA05-EN-UR-1E-EA.png`); a request URL ending in
`.png` gets MediaWiki's "Security redirect", so `format=json` goes last. The scans are Konami's
card images hosted under US fair use (Yugipedia:About, `{{Fair use}}` on every file page); the wiki
asks no credit for them (its CC BY-SA 4.0 covers original text only, which we already credit), the
same basis as the YGOPRODeck images we mirror.

**The run.** The Yugipedia Workflow runs it after the names (`POST /admin/import/yugipedia-galleries`
starts the galleries alone; it, `POST /admin/import/yugipedia` and the weekly cron refuse or skip
while a names or a gallery run is `running`, one lock for one crawl rate; `import_runs` source
`yugipedia-galleries`):
`galleries: plan` plans nothing (a WARN, no set cooled down) until the YGOPRODeck import has
written `external_ids.artworks` on some print, so on a fresh database run the YGOPRODeck import
first; then it lists every gallery title (15 requests), keeps our Yu-Gi-Oh! sets with a TCG
gallery and not read in the last 30 days (`app_meta` map `yugipedia_galleries_checked`, set code →
day) and writes them to R2 in chunks of 20; `galleries 00000` … read each set's pages in the
languages its prints have (`revisions`, 50 titles a request), pick the prints and languages to
resolve, and ask `imageinfo` for their candidate files (50 a request): a print is resolved when its
card has several artworks (`external_ids.artworks`, which the YGOPRODeck import now writes) or a
row of its number carries an alt code; the first row of its number and rarity in the best page of
the language (`EN` before `NA`/`EU`, 1st Edition before Unlimited) names the file, and when that
scan is missing the same alt code in another rarity of the page (RA05's Starlight Rare Dragoon
takes the Ultra Rare `EA` scan, the same artwork); without an alt code there is no fallback
(another rarity may be another artwork) and a print without a row or a scan keeps the passcode
image. The result goes to `external_ids.artwork = { file, url, alt? }` of the print (English) or
its localization; the row keeps its `image_key` until the mirror (Card images) has copied
`artwork.url` under `images/yugioh/<file name>/<lang>/…` (one request a second): a Yu-Gi-Oh! key
that does not name the scan's file is pending, and a key of another source id replaces it whatever
its rank (`writeKeys`). The Workflow purges the `catalog` cache once, after its mirror step. The YGOPRODeck and
Yugipedia name upserts keep `artwork` (`keepArtwork` on prints, `keepYugipedia` on localizations). `extendedArt: true` on the set page's prints
and on `PrintDetail` marks a print whose row says `EA`; the app labels it "Extended Art". Raw
answers: `raw/<env>/yugipedia/galleries/<date>/titles.json` and `sets-<n>.json`. A full run is
about 15 + 96 page requests plus a few hundred `imageinfo` requests (some minutes), then the
mirror's downloads at one a second (the Workflow's `mirror images` step after it, at most 500,
`orig` only; the VPS script's nightly `--sm` run the rest). Not covered: one print per number and
rarity (four Blue-Eyes artworks under LCKC-EN001 UR get the first), OCG and Speed Duel sets.

### Yugipedia set lists (Yu-Gi-Oh! codes per language)

A Yu-Gi-Oh! copy in another language is a localization of the English print, and its code as
printed differs: German `BLGG-DE024`, but `LON-G065` for `LON-065` and French `LDC-F065` under a
set code of its own. The rule's code (see YGOPRODeck) is right for about 84 % (Portuguese 62 %,
measured on 120 cards, `docs/research/2026-10-10-image-coverage-gaps.md`).
`src/import/yugipedia/set-lists.ts` (VB-94) verifies it against Yugipedia's set lists: namespace
3006 `Set Card Lists` holds one page per set and region, `<set> (TCG-DE)` (checked 2026-10-10:
7,624 pages, TCG EN 1,129, DE 749, FR 745, IT 742, SP 702, PT 469, plus NA/EU/AU/FC), whose
`{{Set list|…}}` rows are `code; name; rarity`; the card pages' `de_sets` lists show the same
rows, one request per card instead of 50 pages per request, and the set galleries carry them for
about 250 sets only. The Yugipedia Workflow runs it after the galleries (not for `{ galleries:
'only' }`; `import_runs` source `yugipedia-set-lists`, the third of the shared lock): `set lists:
plan` lists the titles without redirects (16 requests) and keeps our sets matched by name, as the
galleries, not read in the last 30 days (`app_meta` map `yugipedia_set_lists_checked`), in chunks
of 50; `set lists 00000` … read each set's lists in English and the languages its prints have
(`revisions`, 50 titles a request). A print whose number is in a list (`numberKey`: `065`, `E065`,
`G065` are one) gets the first row's code in each of its localizations' languages, from the rows
under our set code or, where the language has none, all of its rows (early French and Italian
sets); a language without the number, or without a list, was never printed so, and the code goes
(`set_code_source` stays, so the rule does not seed it again); a number no list names (our code is
not the wiki's: `YS15-ENF27`) keeps the rule's, as do prints of one language only. Rows changed
bump `catalog_version`, purge the `catalog` cache and refresh the D1 index. Raw answers:
`raw/<env>/yugipedia/set-lists/<date>/titles.json` and `sets-<n>.json`. A full run is 16 + about
100 page requests (two minutes at one a second), and so is every run 30 days later. Not covered:
an anniversary edition merged into its set (`LOB` 25th) takes the original's codes.

## Prices

Prices are stored, never looked up live ([ADR 0003](../../docs/adr/0003-price-history-storage.md)):
integer cents with a currency on every row, the source and the time the source observed the
price. Nothing is converted between currencies. Neither TCGplayer nor Cardmarket gives API
access, and neither site is ever scraped; the prices come from two republishers.

| Source (`price_sources`) | Where from                                            | Currency | When                     |
| ------------------------ | ----------------------------------------------------- | -------- | ------------------------ |
| `tcgplayer`              | [TCGCSV](https://tcgcsv.com/docs): TCGplayer's prices | USD      | daily, 20:30 UTC (prod)  |
| `cardmarket`             | Scryfall `default_cards` (`prices.eur*`), Magic only  | EUR      | with the Scryfall import |
| `tcgplayer_scryfall`     | Scryfall `default_cards` (`prices.usd*`), Magic only  | USD      | with the Scryfall import |

**Tables** (`src/db/schema/prices.ts`, `drizzle/0004_prices.sql`): `prices_current` holds the
latest price per print, finish, source and language (market, low, mid, high; an older observation
never replaces a newer one); `prices_daily` one row per print, finish, source, language and UTC
day (market, low, high). `lang` (VB-103, `drizzle/0013_price_lang.sql`, also in the keys of
`price_mappings`) is the language of the copies the price is for, since a German copy sells for
something else than an English one: TCGCSV writes `en`, Scryfall the language of its
`default_cards` object (a Japanese-only print: `ja`) and drops that print's rows of the same
source and finish in another language. Where the `timescaledb` extension is installed (the VPS), the migration turns `prices_daily`
into a hypertable with monthly chunks compressed after 30 days; plain PostgreSQL (CI, Docker)
skips that and logs a notice. `condition_multipliers` holds the share of the near-mint price per
condition and game (NM 1.0, EX 0.85, GD 0.7, LP 0.6, PL 0.45, PO 0.3): estimates, labelled as
such in every response, until real per-condition prices exist.

**TCGCSV import** (`src/import/prices/`, Workflow `src/workflows/tcgcsv-import.ts`, binding
`TCGCSV_IMPORT`). TCGCSV rebuilds once a day around 20:00 UTC and asks for a descriptive
User-Agent, about 100 ms between requests, one pull a day and under 10,000 requests a day. A run:

1. `last updated`: `last-updated.txt`; when it is the build the last run imported, the run ends
   (`stats.skipped`) without another request.
2. `groups <game>` for Magic (category 1), Yu-Gi-Oh! (2) and Pokémon (3): the groups (TCGplayer's
   sets), matched to catalog sets by Scryfall's `tcgplayer_id`; then TCGdex's official abbreviation
   (`external_ids.abbreviation.official`, `SVI`), when it and the group's are each unique and the
   group's name holds the set's (TCGplayer's `BST` is EX Battle Stadium, TCGdex's Battle Styles);
   then abbreviation = set code (Yu-Gi-Oh!: also its code before a dash or slash, so `LOB` and
   both `LOB-EN` groups map to `lob`, `MVP1-ENG`/`-ENS`/`-SE` to `mvp1`, `YS15-ENL` to `ys15`,
   `RATE-SE` to `rate`, VB-113); then the name without TCGplayer's series prefix (`SWSH03: `,
   `SM - `), a trailing `Base Set` or a leading series name (`SV: Scarlet & Violet 151` → `151`);
   last `GROUP_ALIASES` in `match.ts` (promos, McDonald's, Radiant Collections, Shonen Jump
   Magazine Promos, by group id). Magic also imports the groups no set matches (VB-114: Promo
   Pack, Art Series, Buy-A-Box, the store promos and others that span several of Scryfall's sets;
   about 100 groups and 4,500 prints), since its products match by Scryfall's ids whatever the
   set; they do not count in `matchedGroups`.
3. `prices <game> 000` …: products and prices of about 25 matched groups per step, mapped to
   prints (below) and written to `prices_current` and `prices_daily`. A set's groups share a step
   and are matched together (LOB: the North American prints are in `LOB`, the EN ones in
   `LOB-EN`), so the more confident claim on a print wins across groups. A card that several
   groups of the set list under one number and rarity (the 25th Anniversary Edition's reprints,
   which the catalog folds into the set) is one print: the lowest group id with a market price for
   it prices it, else the lowest, and the others are left unmapped (VB-113: the Worldwide English
   `MRD-EN010` has no market price, its 25th Anniversary reprint has). A print already mapped keeps
   its product while that is listed with a market price, so `prices_daily` does not switch between
   two products as their prices come and go; it falls forward only when its product has none.
   Yu-Gi-Oh! products whose number names another set (LC03's group lists Legendary Collection 3's
   mega pack `LCYW-EN…`, SJMP the `JMP` and `JMPS` promos) are matched to that set's prints when it
   has no group of its own.
4. `coverage <game>` after each game (VB-111, VB-114, `src/import/prices/coverage.ts`): per set
   the prints with a current price from any source, per source (`tcgplayer`, `cardmarket`,
   `tcgplayer_scryfall`) and from none, the groups that matched no set and the sets that have a
   group but no `tcgplayer` price, from the group list the run just kept. Magic's groups without a
   set are imported all the same (step 2), so its `unmatchedGroups` are informational, not a gap.
   Logged in the step as one line `price coverage` per game (`game`, `sets`, `setsWithGroup`,
   `setsPriced`, `prints`, `priced`, `sources`, `unpriced`, `unmatchedGroups`, `unpricedSets`) and
   a WARN `set has a TCGplayer group and no price` per such set. Never fatal: a failure is a WARN
   `price coverage failed` and the run goes on (the prices are written by then).
5. `finish run`: `import_runs` row (`source` `tcgcsv`, kind `prices`) `ok` with per-game counts
   (`groups`, `matchedGroups`, `cards`, `mapped`, `unmapped`, `prices`, `noMarket`), `raw` (the
   run's `RAW` prefix) and `catalog_version` + 1.

A full run is about 2,700 requests (VB-114: every Magic group); the first local run for Magic
(2026-10-10) matched 352 of 454 groups and mapped 92,990 of 104,595 card products in 2 min 23 s. Every answer is kept
gzip-compressed in `RAW` under `raw/<env>/tcgcsv/<date>/<category>/` (`groups.json.gz`,
`<group>.products.json.gz`, `<group>.prices.json.gz`). Prices without a `marketPrice` (too few
sales) are not written. The cron runs on prod only: dev would be a second pull of the same build,
so dev imports on demand with `POST /admin/import/tcgcsv` (202, or 409 while one runs). A second
prod cron at 22:30 UTC (instance `tcgcsv-<date>-late`) catches a build that landed late: when the
20:30 run imported the build it reads `last-updated.txt` and ends without bumping
`catalog_version`. Either cron is skipped (and logged) while a TCGCSV run is still going.

**Forced re-import.** `POST /admin/import/tcgcsv?force=true` (or `?force=1`; any other value is
a plain run) imports the build even when the last run did: groups and products are matched anew,
so a matching change reaches the current prices the same day instead of with the next build. It
is a second pull of that build (about 2,700 requests, within TCGCSV's daily limit). After a
matching change (VB-110's regional Yu-Gi-Oh! prints, VB-111's newly matched Pokémon and `LOB-EN`
groups, VB-113's Yu-Gi-Oh! rarity aliases, reprint families, artwork variants and set codes,
VB-114's Magic groups without a set and shared 7th–10th Edition products) run both steps, once
for both: the forced import, then the archive backfill on the VPS with
`--refill`, since a plain backfill skips every day that already has `tcgplayer` rows and the
re-mapped prints' history would otherwise start with the forced run:

```sh
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" "$API_URL/admin/import/tcgcsv?force=true"
# on the VPS, once the import is `ok` (History backfill, below):
pnpm --filter api backfill-prices --env-file ~/.config/voidbinder/pg.env --db <dev|prod> \
  --refill --from 2024-02-08
```

`--refill` downloads every day of the range and `ON CONFLICT DO NOTHING` adds only the missing
rows. `--from 2024-02-08` (the archive's first day, also the default) covers the whole history; a
later `--from` limits it. The full range is about 975 days, each a download, an unpack and an
insert plus the 2 s pause, so expect several hours (not measured yet: the archive answers 403
since 2026-10-10); run it under `systemd-run` as in the runbook.

`GET /admin/prices/coverage?game=mtg|yugioh|pokemon` (same bearer token) answers the coverage of
the last run that pulled a build: `sets` (per set `code`, `name`, `prints`, `priced` by any
source, `sources` per source, `unpriced` by none, `groups`, `groupMatched` and `rules`, the
`matchGroups` rule of each group: `scryfall-id`, `abbreviation`, `name` or `alias`),
`unmatchedGroups` (`groupId`, `name`, `abbreviation`), `unpricedSets` (a group, no `tcgplayer`
price) and `totals` (the counts of the log line); 404 before such a run or when its group list is
gone from `RAW`, 400 for another game.

**Scryfall prices**: after its catalog run and before `clean up chunks`, the Scryfall import
Workflow runs `prices: start run`, one `prices 00000` … step per `default_cards` chunk (the chunks
of the `cards` steps, read back from `RAW`, never a second download) and `prices: finish run`; each
writes `cardmarket` and `tcgplayer_scryfall` rows per finish and is idempotent, so a retried step
is safe. A failure there is logged and leaves the catalog import `ok`.

**Mapping** (`price_mappings`, `src/import/prices/match.ts`): which external product and finish
is which print, with a confidence. TCGCSV's `subTypeName` becomes the finish (`Normal` and
`Unlimited` → `normal`, `Foil` → `foil`, `Holofoil` → `holo`, `Reverse Holofoil` → `reverse`,
`1st Edition` → `first_edition`, anything else a slug).

| `method`       | Confidence | When                                                                      |
| -------------- | ---------- | ------------------------------------------------------------------------- |
| `scryfall_id`  | 100        | Magic: Scryfall's `tcgplayer_id` / `tcgplayer_etched_id`, `cardmarket_id` |
| `number_match` | 70         | Pokémon, Yu-Gi-Oh!: same set and collector number (Yu-Gi-Oh!: and rarity) |
| `region_match` | 60         | Yu-Gi-Oh! regional print (below): the EN product of its name and rarity   |
| `name_match`   | 40         | No number match: a name that only one print of the set has                |
| `manual`       | 100        | An admin's override; the importers never change it                        |

Yu-Gi-Oh!'s early sets were printed under several codes in English: `LOB-001` (North America),
`LOB-E001` (Europe), `LOB-A001`/`LOB-AE001` (Australia, Asia) and `LOB-EN001`; YGOPRODeck keeps
each as a print, TCGplayer lists only `LOB-EN001`. A regional print that no product claims by its
own number takes the one card product of the set with its name and rarity (several: the `EN` one
with its digits), so one product prices several prints (VB-110, `drizzle/0014_…`). By name, not
digits: the European numbers differ (`LOB-E053` is Curse of Dragon, `LOB-EN053` Raigeki, both
Super Rare). A product with the regional number itself, should TCGplayer list one, wins with 70.

Yu-Gi-Oh! rarities are compared through `rarityKey` (VB-113), one alias table for both sides:
YGOPRODeck's `Short Print` and `Super Short Print` are TCGplayer's `Common` (TCGplayer has no
short prints, so one product prices a number's Common, SP and SSP prints), `Ultimate Rare` /
`Collector's Rare` are `Prismatic Ultimate Rare` / `Prismatic Collector's Rare` in RA01 and RA04,
`Ultra Rare (Pharaoh's Rare)` is `Ultra Pharaoh’s Rare`, HAC1's Duel Terminal parallels are
`Duel Terminal Technology Common` / `Ultra Rare`, plus `Starfoil`, `Extra Secret` and the
misspelled `Cr` and `Duel Terminal Normal Rare Parallel Rare`. Checked equal on both sides
(2026-10-10): Quarter Century, Platinum and Prismatic Secret Rare, Starlight, Ghost, Ghost/Gold,
Gold, Gold Secret, Premium Gold, Mosaic, Starfoil and Shatterfoil Rare, the Duel Terminal parallels
of DT07. A product only takes prints of the set its number names, when that set is a candidate.

Two products that claim one print with the same confidence are both left unmapped. A TCGplayer id
Scryfall gives more than one print goes by printing: each print takes the finishes none of the
others has (VB-114: 7th to 10th Edition list the nonfoil `115` and the foil-only `115★` as one
product, whose `Normal` price is the first's and `Foil` price the second's); a finish two of them
have is left unmapped. Yu-Gi-Oh! products of one number and rarity that
differ by name are resolved per print (VB-113; Pokémon keeps the tie): the one with the print's
name wins (LOB-012 is Trial of Nightmare and its misprint Trial of Hell); artwork variants (`Harpie Lady (Original Artwork)` and
`(New Artwork)`, MRD-008) go to the original, or to the other one when Yugipedia gives the print an
alternate-art code (`AA`, `AA2`, `Alt` in `external_ids.artwork.alt`, VB-106; none when several
other artworks are listed), at confidence 65 with an INFO line `artwork variant
picked`. A regional print whose name no product has (TCGplayer keeps `B. Skull Dragon`) takes the
product of its card's EN print of the same rarity. TCGCSV prices are written through the table, so
an override counts from the next run on. Only `tcgplayer` can be overridden (400 for any other
source): the Scryfall sources come with the print and never go through `price_mappings`.

```sh
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"externalId":"248137","note":"checked by hand"}' \
  localhost:8787/admin/price-mappings/<printId>/tcgplayer/normal
```

It answers the mapping (200), 404 for an unknown print and 409 when another print holds that
product and finish manually; an automatic holder gives it up.

**Read API** (`src/routes/prices.ts`, cached pool and `ETag` like the catalog, ADR 0004).
`GET /catalog/prints/:id/prices?currency=EUR|USD&finish=&lang=` answers the current prices with
their source label and `observedAt`, per source and finish the one in `lang` (the language of the
card shown, default `en`), else `en`, else another, each with its `lang`; the `display` price
(finish first: `finish`, `normal`, the print's finishes; then the language, `lang`, `en`, any;
then the source the currency prefers, EUR → Cardmarket, USD → TCGplayer; in that source's
currency) and the condition estimates of the display price.
`GET /catalog/prints/:id/prices/history?days=90&lang=` (1 to 3650) answers the market price per
source and finish, per day in `lang` (else `en`, else another; `lang` on each point), one point per
day for the last 180 days and the last day of each ISO week before
that. The day comes from the Worker, never `now()` in SQL, so Hyperdrive can cache the query.
`GET /catalog/sets/:game/:code?currency=`, `GET /catalog/search?currency=` and
`GET /catalog/cards/:id?currency=&lang=` (every print of the card) carry each print's
`marketPrice` with its `observedAt` and `lang`: the `normal` finish (the first finish when there is
none, then the print's other finishes), then a finish the print does not list but has a price row
for (Yu-Gi-Oh!: TCGplayer prices per edition, `first_edition`, while the print says `normal`), the
price in `?lang=`, then `en`, then any, preferred source first; null only without any price row.
The collection prices each copy in its `language`, a deck line in the user's language; one rule
everywhere (core's `pickDisplayPrice` and the SQL `langRank` in `drizzle-card-store.ts`). The display price, condition
estimates, collection value and the history thinning are in `packages/core/src/prices`.

**History backfill** (VB-63, `scripts/backfill-prices.ts`, logic in
`src/import/prices/backfill.ts`). TCGCSV keeps a daily price archive from 2024-02-08 on:
`https://tcgcsv.com/archive/tcgplayer/prices-<YYYY-MM-DD>.ppmd.7z`, one 7z (PPMd) per day whose
`<day>/<category>/<group>/prices` files are the same JSON as the live prices files; it holds no
products or groups. 7z cannot be unpacked in a Worker, so the backfill is a Node script on the VPS
([runbook](../../docs/guides/database-vps.md#13-price-history-backfill)). Per day it downloads the
archive (descriptive User-Agent, one day at a time, 2 s between days), unpacks only categories 1,
2 and 3, maps every price through `price_mappings` (`tcgplayer`; a product the daily import never
mapped is skipped, an `etched` mapping takes the product whatever its printing, as in the daily
import), inserts the day's `prices_daily` rows in one transaction with `ON CONFLICT DO NOTHING`
and deletes the files. It never writes `prices_current` (an archived day is never the current
price) or the mappings, and a day that already has `tcgplayer` rows is skipped, so the daily
import's rows always win. A day without an archive (404) is logged and recorded as missing; any
other answer (403: the archive is switched off) stops the run. As of 2026-10-10 the archive
answers 403 "temporarily removed due to rising server costs" for every day, so no history has been
backfilled yet; history starts with the first daily run until it returns. Dev has no TCGCSV cron
(TCGCSV asks for one pull a day, which prod makes); dev imports on demand.

## Collection

`/collection/**` (VB-31, `src/routes/collection.ts`, schemas in `packages/shared/src/api/collection.ts`)
needs a user (`requireUser`) and only ever reads and writes that user's rows; another user's id
answers 404. Binders (`GET/POST /binders`, `PATCH/DELETE /binders/:id`, `PUT /binders/order` with
every id in the new order), entries (`GET /entries?binder=&game=&set=&condition=&lang=&q=&page=`, 50
per page, newest first, each with its print and the current price of its finish times the condition
factor; `POST /entries` with one entry or up to 500; `PATCH`, `DELETE /entries/:id`) and the wish
list (the same under `/wishlist`), `GET /summary?currency=` (value per source and currency with the
oldest observation in it, per game and per binder, the wish list's cost and how many wishes are in
budget), `GET /owned?printIds=` or `?game=&set=` (copies per print and finish) and
`GET /export.csv` (Name, Set Code, Number, Language, Condition, Finish, Quantity). The tables
(`src/db/schema/collection.ts`, `drizzle/0005_collection.sql`) are shaped for the sync engine:
the client may send the row's `id` (a POST with a known id writes nothing and answers the stored
row) and the server sets `updated_at` on every write. A delete removes the row at once and, in
the same transaction, logs its id in `sync_deletions` for the other devices (VB-75, see Sync); a
deleted binder's entries stay, in no binder. The unique rules (binder name, one wish per print,
language and finish) hold for every row, so a deleted binder's name is free right away. The
`deleted_at` columns are unused (always null) and go in a later release. The value math is pure in
`packages/core/src/collection/value.ts`; `condition_multipliers` has no MT row, so MT's factor
(1.05, an estimate) lives there. `DrizzleCollectionStore` reads on the cache-disabled pool, since a
user reads their own writes.

## Decks

`/decks/**` (VB-34, `src/routes/decks.ts`, schemas in `packages/shared/src/api/decks.ts`) needs a
user and only ever touches that user's decks; another user's id answers 404. `GET /decks` (newest
change first, each with its verdict, problem count, main deck size, missing copies and value),
`POST /decks` (`{ id?, game, name, format?, description? }`; the client's id makes it idempotent,
the format must be one of the game's, `DECK_FORMATS`), `GET`, `PATCH` and `DELETE /decks/:id`, and
`PUT /decks/:id/entries` with the whole list (`{ cardId, printId?, zone, quantity }`, each card once
per zone; a zone the game has not got is a 400, a card of another game or a print of another card a
404, and a refused list leaves the stored one alone). Every answer with a deck carries its entries
(name in the user's language, the preferred print or else the cheapest, owned copies, price) and
`analysis`: the rules of `packages/core/src/decks` (one file per game: sizes, copies, ban lists and
format legality from `cards.legalities`, commander and colour identity, zones), copies per zone, the
curve, and the comparison with the whole collection: copies per card name in the deck's game (any
print, every binder) against what the deck needs, priced at the cheapest print in the user's
currency's preferred source, summed per source and currency like the collection value (never
converted). The tables (`src/db/schema/decks.ts`, `drizzle/0006_decks.sql`) follow the collection's
sync shape: `decks` has the client's id and `updated_at`, and a delete removes the deck with its
entries and logs only the deck in `sync_deletions`; `deck_entries` are replaced as a whole and
bump the deck's `updated_at`. `DrizzleDeckStore` reads on the
cache-disabled pool.

## Sync

`/sync/**` (VB-32, `src/routes/sync.ts`, the queries in `src/platform/cloudflare/drizzle-sync-store.ts`,
schemas in `packages/shared/src/api/sync.ts`, the pure rules in `packages/core/src/sync`, decision in
[ADR 0005](../../docs/adr/0005-sync-protocol.md)) lets a device with offline edits push its changed
rows and pull what changed elsewhere. Signed in, the user's own rows only.

**Cursor.** `binders`, `collection_entries`, `wishlist_entries`, `decks` and `deck_entries` have a
`sync_seq bigint` (`drizzle/0008_sync.sql`); the four tables with a `user_id` are indexed
`(user_id, sync_seq)` (`deck_entries` has none and syncs with its deck). The trigger
`sync_stamp()` gives every insert and update the next value of the sequence `sync_seq`, REST writes
included. It first takes a shared per-user advisory lock; a pull takes it exclusively, so it waits
for the user's writes in flight and no row commits later below the cursor it hands out.

**Deletes.** A delete removes the row at once (VB-75). The same transaction writes
`(user_id, table, id)` to `sync_deletions` (`drizzle/0009_sync_deletions.sql`): no content, the
delete's time `deleted_at` (a pushed delete's device clock, else now) and the server's
`logged_at`. Its `sync_seq` comes from `sync_stamp()` like a row's, under the same per-user lock.
Deleting again refreshes the entry. A deck's entries go with the deck (only the deck is logged).
A create under a deleted id (a retried `POST`, or a sync edit that wins) writes the row again and
removes its log entry in the same transaction.
The daily Scryfall cron of every environment also sweeps the log (`sweepSyncDeletions`): rows
with `logged_at` older than `SYNC_DELETION_RETENTION_DAYS` (30, `packages/shared/src/api/sync.ts`)
less two days, so that no entry outlives 30 days even when one daily run fails, go in batches of 1000, logged as `sync deletions swept` with the count, and the highest `sync_seq`
removed becomes the horizon in `app_meta` (`sync_deletions_horizon`).

**Pull.** `GET /sync/pull?since=<cursor>&limit=` (`since` 0 = everything, `limit` 1 to 500, default
500): the user's rows and deletions with `sync_seq` above the cursor, the lowest first across the
tables and the log; rows grouped per table in table order, deletions as `deletions: [{ table, id }]`
(each counts in `limit`). Apply a page's `deletions` before its rows: a row on the server is
newer than any deletion of its id. Every deck comes with its whole list under `deck_entries` (not
counted in `limit`, but a page ends early once its rows and lists pass 5000; one row always
fits). `cursor` is the next `since`; `more: true` means pull again. The cursor is opaque: the last
page hands out the sequence's current value, and the pages of a full pull (from 0) hand it out
below 0. A cursor below the horizon (the device last synced more than 30 days ago) answers 409
with `error.code` `resync_required`: drop the local copy and pull from 0.

**Push.** `POST /sync/push` with `{ changes: [{ table, rows }] }`: full rows (the fields of the REST
routes, plus `id`, `updatedAt` = the edit time on the device, `deletedAt` to delete the row and
`baseUpdatedAt` = the `updatedAt` last pulled, null for a row the device created). At most 500 rows
(deck entries aside: at most 500 per deck and 5000 in all), one transaction, applied binders,
entries, wishes, decks; a user's pushes run one at a time, so a retry that overlaps its original
answers like it. A deck's entries are its whole list and need the deck row in the same push (400
otherwise); they are validated like `PUT /decks/:id/entries`. An id of another user (a row or a
binder), an unknown print or card answers 404 and nothing is written; a taken binder name or wish
409 with a message that starts with the pushed row (`binders <id>: …` or `wishlist_entries <id>:
…`), for the device to rename or merge before it pushes again. An entry filed into a binder that
is gone (deleted, its log entry swept, or never synced) lands in no binder, and a pushed binder
delete moves its entries out, as the REST delete does (after the push's own entries, so an entry the same push moved to another binder keeps that move; the
binder itself goes where it comes in the push, so a row after it may take its name, and the
entries' foreign key to it is checked at commit: `DEFERRABLE`, deferred in the push only); such
an entry is listed in `applied`, but the device only learns its `binderId` is null from its next
pull.

**Conflicts** (`resolvePush`): the stored row changed after `baseUpdatedAt` → the server keeps it and
returns it in `conflicts` (a deck with its list), and the device replaces its copy. Except: a delete
newer than the stored edit wins, and an edit newer than a logged delete brings the row back (it is
inserted again and its log entry goes). For a row that is gone, its log entry stands in: an older
edit is answered in `deletions` whatever its base (`[{ table, id }]`: drop the local copy), a delete is applied
without writing anything. An edit with a `baseUpdatedAt` for an id with neither row nor log entry
(swept after 30 days) is answered in `deletions` too; only a row the device created is inserted. A
row equal to the stored one writes nothing (a retried push changes
nothing). `applied` lists the
`updatedAt` the server holds for every other pushed row: the device's next `baseUpdatedAt`. An
`updated_at` never goes back: `sync_stamp()` stores at least the old value plus 1 ms on every
update (REST, sync, the binder-delete fan-out), to the millisecond, so a REST edit behind a device
whose clock ran fast still conflicts with that device's next push. A pushed `updatedAt` or
`deletedAt` more than 5 minutes ahead of the server is cut to now plus 5 minutes
(`SYNC_CLOCK_ALLOWANCE_MS`), so a wrong device clock cannot pin a row in the future.

```http
POST /sync/push
{ "changes": [
  { "table": "binders", "rows": [{ "id": "6f1c…", "name": "Trades", "game": null, "position": 2,
    "colour": null, "updatedAt": "2026-10-10T09:12:00.000Z", "deletedAt": null,
    "baseUpdatedAt": null }] },
  { "table": "collection_entries", "rows": [{ "id": "a03e…", "printId": "…", "binderId": "6f1c…",
    "quantity": 3, "language": "en", "condition": "NM", "finish": "foil", "purchasePriceCents": null,
    "purchaseCurrency": null, "note": null, "updatedAt": "2026-10-10T09:13:00.000Z",
    "deletedAt": null, "baseUpdatedAt": "2026-10-09T18:00:00.000Z" }] } ] }

200 { "applied": [{ "table": "binders", "id": "6f1c…", "updatedAt": "2026-10-10T09:12:00.000Z" }],
      "conflicts": [{ "table": "collection_entries", "rows": [{ "id": "a03e…", "quantity": 1, …,
        "updatedAt": "2026-10-10T08:40:00.000Z", "deletedAt": null }] }],
      "deletions": [] }

GET /sync/pull?since=1840
200 { "changes": [{ "table": "binders", "rows": [ … ] }, { "table": "decks", "rows": [ … ] },
      { "table": "deck_entries", "rows": [ … ] }],
      "deletions": [{ "table": "wishlist_entries", "id": "91d2…" }], "cursor": 1912, "more": false }
```

The entry was changed on another device at 08:40, after the base this device had (18:00 the day
before), so the server kept its row; the binder was new and is stored.

## Card images

`src/import/images.ts` (VB-57) copies every print's source image into the `CATALOG` bucket, which
is public through `img.voidbinder.de` (`IMAGE_BASE_URL`): Scryfall `large` for Magic (then
`normal`, `png`; only once Scryfall has the high-res scan, `highres_image`, and never its
missing-image placeholder), the print's Yugipedia scan (`artwork.url`, VB-106) else YGOPRODeck
`image_url`, TCGdex `tcgdex_images.high` (the keys of
`external_ids` the importers fill). A low-res Magic image stays unmirrored and the API serves
Scryfall's URL until a later run finds the scan.

| Key                                          | What                                          |
| -------------------------------------------- | --------------------------------------------- |
| `images/<game>/<sourceId>/<lang>/orig.<ext>` | The source file unchanged, its content type   |
| `images/<game>/<sourceId>/<lang>/sm.webp`    | 320 px wide WebP, same aspect, never enlarged |

`<sourceId>` is the source's stable id, never a database id, so `dev` and `prod` share the
objects and a re-import never changes a key: the Scryfall card id (`mtg`), the YGOPRODeck image
id from `image_url` (`yugioh`, one artwork shared by its set prints) or the Yugipedia file name
(`RedEyesDarkDragoon-RA05-EN-UR-1E-EA`), the TCGdex card id
(`pokemon`, e.g. `swsh3-136`). Both carry `Cache-Control: public, max-age=31536000, immutable`.

`prints.image_key` (English) and `print_localizations.image_key` hold the `sm` key once that copy
exists and the `orig` key until then, so `imageUrl` is the small copy whenever there is one,
without a request to R2 (`hasSm`). Rows that share a source URL share one object pair (a print
and its English localization, a Yu-Gi-Oh! card in several sets). Downloads are rate limited per
source (token bucket: Scryfall 20/s, YGOPRODeck 15/s, TCGdex 8/s, Yugipedia 1/s with its own
`User-Agent`); a 429 stops the run once the
images in flight are stored, a failed image is logged and keeps its key (or none), so the next
run retries it. A `404` or `410` from the source counts as `gone` instead (VB-89): the URL goes to
`image_sources_gone` and the query skips every row with that source URL until the URL changes; the
runs on Sundays (UTC) retry them all and delete the URLs that answer again. Every run is an `import_runs` row with source and kind `images`, and only one
runs per database at a time (`pg_try_advisory_xact_lock`; a second one stops with "another image
mirror is running").

**Which image a print shows** (VB-86/VB-87, `src/platform/cloudflare/image.ts`): whatever exists,
so the catalog improves as the mirror fills it. `imagePick` walks, in SQL, the requested
language's localization key, the print's own key (the English scan), then the `en`, `ja`, `de`,
`fr`, `it`, `es`, `pt` localization keys and the other languages alphabetically; within one step a
high-res key beats a `-lowres` one (so the own English high-res scan beats a requested German
lowres one). A print without any key takes the same chain on another print of its card: language
first, then the same set, then the newest print (its own date, else its set's). Every `imageUrl`
(set page, search, typeahead, card and print endpoints, ban list tiles, collection, wish list and
deck rows) comes with `imageLang`, the language the image is in, and `imageFrom` (`print` or
`sibling`), both left out without an image; the app's card page says so under the image. Only with no key anywhere (or no `IMAGE_BASE_URL`) the source's
URL follows. The lookups are correlated subqueries on `print_localizations`' primary key and
`prints_card_id_idx`, the sibling one only for a print without any key; `image.test.ts` checks the
plans of the set page, the search and the typeahead.

Two transports share that logic:

- **VPS script:** `scripts/mirror-images.ts`, a Node script run on the database VPS
  ([runbook section 11](../../docs/guides/database-vps.md#11-image-mirror)) with the S3 API and
  `sharp`, `orig` and `sm`: the bulk load once, then nightly at 05:30 UTC with `--sm`, which also
  adds the `sm` copy to the rows the delta stored as `orig` only (read back from the bucket, not
  the source).
- **Daily delta:** the last step of each import Workflow, `mirrorStepFor(game)` in
  `src/workflows/mirror-images.ts`, mirrors the game's oldest pending rows (Magic and Pokémon
  2000, Yu-Gi-Oh! 500; rows without a usable source image are skipped in the query, never
  counted against the cap) with the R2 binding, `orig` only, so failures, days over the cap and
  new localizations are retried daily. A 429 or a running mirror fails the step without retries;
  any failure is logged and leaves the import `ok`.

The catalog responses build `imageUrl` from `IMAGE_BASE_URL` + `image_key` and fall back to the
source URL until the image is mirrored. `GET /catalog/cards/:id` and `GET /catalog/prints/:id`
also carry `copyright`, the game's line from `@voidbinder/shared/notices` (which also exports the
per-game notices and the Scryfall attribution); the card page shows it with the print's `artist`.

## Offline catalog modules

`scripts/build-catalog-module.ts` (VB-29) builds one SQLite file per game (sets, cards, prints,
`en`/`de` localizations, image keys, the display price per print, finish and currency, an FTS5
name index) from the catalog with the read-only mirror role, gzips it and diffs it against the
previous module into a delta of row upserts and deletes; with `--upload` it publishes both and
`manifest.json` to `CATALOG` under `modules/<db>/<game>/`, skipping a game whose manifest already
has the current `catalog_version` and schema, and deleting files the new manifest no longer names
(the previous module stays one run). A VPS timer runs it nightly at 06:30 UTC
([runbook section 12](../../docs/guides/database-vps.md#12-offline-catalog-modules)).
`GET /catalog/modules` (`src/routes/modules.ts`) answers the manifests of `modules/<IMPORT_ENV>/`,
cached like the catalog. Schema, manifest and the app's contract:
[docs/architecture/catalog-module.md](../../docs/architecture/catalog-module.md).

## Deploy

From Max's workstation with `wrangler login` ([ADR 0002](../../docs/adr/0002-deploys-from-workstation.md)):

```sh
pnpm --filter api deploy:dev    # voidbinder-api-dev on workers.dev
pnpm --filter api deploy:prod   # voidbinder-api on api.voidbinder.de
```

Both pass the short git sha as `VERSION` (`--var`), which `GET /health` reports. Both apply the
D1 migrations of `d1/` to the environment's search index first
(`wrangler d1 migrations apply SEARCH --remote --env dev|prod`).

The search index needs, once per environment: the database
(`pnpm exec wrangler d1 create voidbinder-search-<env> --location weur`, its id into
`wrangler.jsonc`), read replication switched on (dashboard: D1 → the database → Settings →
Enable Read Replication; it is not a wrangler command), and after the first deploy one full
refresh: `curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" <API_URL>/admin/search-index/rebuild`.
Until it finished, the typeahead reads Postgres (`x-search-source: postgres`). `pnpm build`
runs `wrangler deploy --dry-run --outdir dist` (top-level config) as a bundling check only.
