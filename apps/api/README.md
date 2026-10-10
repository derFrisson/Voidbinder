# apps/api

The Voidbinder API: a Cloudflare Worker with [Hono](https://hono.dev), Smart Placement,
PostgreSQL through Hyperdrive with Drizzle, and R2 for catalog files. The app talks to it through
the typed client in `src/client.ts`. Architecture: [ADR 0001](../../docs/adr/0001-stack.md),
caching: [ADR 0004](../../docs/adr/0004-caching-catalog-reads.md), environments and secrets:
[docs/environments.md](../../docs/environments.md).

## Layout

| Path                         | What                                                                                            |
| ---------------------------- | ----------------------------------------------------------------------------------------------- |
| `src/index.ts`               | Worker entry (`fetch`) and `export type AppType`                                                |
| `src/app.ts`                 | `createApp(deps)`: the Hono app from injected dependencies (tests need no binding)              |
| `src/routes/`                | Routes: `GET /health`, `GET/PATCH/DELETE /me`, `GET /catalog/**`, `POST /admin/import/<source>` |
| `src/auth/`                  | Better Auth (`createAuth`), `requireUser`, auth mails, the app's auth client                    |
| `src/middleware/`            | Request id, JSON access log, error handler, default `Cache-Control: no-store`                   |
| `src/platform/cloudflare/`   | The only code that touches bindings: `createPlatform(env)` and the implementations              |
| `src/db/schema/`, `drizzle/` | Drizzle schema and the committed SQL migrations                                                 |
| `src/import/`                | Catalog importers (Scryfall, YGOPRODeck), prices (`prices/`); see Importers, Prices             |
| `src/workflows/`             | Cloudflare Workflows that run the importers                                                     |
| `src/client.ts`              | `createApiClient(baseUrl, options?)`, exported as `@voidbinder/api/client`                      |
| `src/auth/client.ts`         | `createApiAuthClient(baseURL, options?)`, exported as `@voidbinder/api/auth-client`             |

Request and response schemas (Zod) live in `packages/shared/src/api` and are imported from
`@voidbinder/shared/api`. Errors always have the shape `{ error: { code, message, requestId } }`
(plus `issues` on a 400 validation error); a 500 never carries the cause, which goes to the log.

## Platform seams

`packages/core/src/platform` defines `CardStore`, `BlobStore`, `VectorIndex` and `JobQueue`.
The Cloudflare implementations live in `src/platform/cloudflare`: `DrizzleCardStore`
(`drizzle-card-store.ts`, PostgreSQL via Hyperdrive), `R2BlobStore` (`r2-blob-store.ts`: the
public `CATALOG` bucket for `images/`, the private `RAW` bucket for the import's dumps) and
`WorkflowJobQueue` (`workflow-job-queue.ts`, a job type per Workflow binding). `VectorIndex`
(VB-37) is an interface only so far.

`createPlatform(env)` opens two per-request pools: one on `HYPERDRIVE` (caching disabled, for
everything) and one on `HYPERDRIVE_CACHED` (reads cached up to 300 s, for the catalog and price
stores only, ADR 0004: `DrizzleCardStore` runs `ping` on the first and every catalog read on the
second). Without `HYPERDRIVE_CACHED` (self-hosting) both are the same pool.

## Catalog API

| Route                                                             | Answer                                                           |
| ----------------------------------------------------------------- | ---------------------------------------------------------------- |
| `GET /catalog/games`                                              | Games with their set counts                                      |
| `GET /catalog/games/:game/sets?lang=`                             | Sets, newest first, with the name in `lang`                      |
| `GET /catalog/sets/:game/:code?lang=&rarity=&finish=&sort=&page=` | Set header and 60 prints per page (`sort`: number, name, rarity) |
| `GET /catalog/cards/:id`                                          | Card, legalities and every print with localizations              |
| `GET /catalog/prints/:id`                                         | One print with its card                                          |
| `GET /catalog/prints/:id/prices?currency=&finish=`                | Current prices, display price, condition estimates (see Prices)  |
| `GET /catalog/prints/:id/prices/history?days=`                    | Daily market prices per source and finish (see Prices)           |

Schemas: `packages/shared/src/api/catalog.ts`. Image URLs are `IMAGE_BASE_URL/<image_key>` once the
image is in R2 (VB-57) and the source's URL until then. Every 200 carries
`Cache-Control: public, max-age=60, s-maxage=600` and an `ETag` of `catalog_version` plus a hash of
the body (`src/middleware/catalog-cache.ts`); `If-None-Match` answers 304. The queries use no
`now()` or other non-immutable function, so Hyperdrive can cache them.

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

| Step            | Request                                                     | Result                                                                                             |
| --------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Sign up         | `POST /auth/sign-up/email` `{ name, email, password }`      | 200 (also for a taken address, no enumeration); verification mail with `${APP_URL}/verify?token=…` |
| Verify          | `GET /auth/verify-email?token=…` (the app's `/verify` page) | `{ "status": true }`; sign-in is refused with 403 until then                                       |
| Sign in         | `POST /auth/sign-in/email` `{ email, password }`            | session cookie, plus the session token in the `set-auth-token` header for native clients           |
| Sign out        | `POST /auth/sign-out`                                       | session deleted, cookies cleared                                                                   |
| Forgot password | `POST /auth/request-password-reset` `{ email }`             | 200 always; mail with `${APP_URL}/reset-password?token=…` if the address exists                    |
| Reset password  | `POST /auth/reset-password` `{ token, newPassword }`        | new password set, every session of the user revoked                                                |
| Profile         | `GET /me`, `PATCH /me` (`UpdateMeRequestSchema`)            | `MeResponseSchema` (`@voidbinder/shared/api`); 401 with `WWW-Authenticate: Bearer` when signed out |
| Delete account  | `DELETE /me`                                                | 202, `deletionRequestedAt` set, every session revoked, cookies cleared                             |

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
null, like Discord): every new session clears it (`databaseHooks.session.create.after` in
`src/auth/index.ts`).

**Rate limits** count per client IP (`cf-connecting-ip`) in the `rate_limit` table, so every
isolate sees the same count: sign-up 3 and sign-in 5 per minute (`AUTH_RATE_LIMITS`), Better
Auth's defaults elsewhere (password-reset and verification mails 3 per minute), `/get-session`
unlimited. Over the limit: 429 with `X-Retry-After`. A request without the header falls into one
shared bucket, so the web app's proxy must pass `cf-connecting-ip` on.

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

**A test user locally** (with `pnpm --filter api dev` running and the database migrated):

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
`currency` and the length of `display_name`). Regenerate it, then `db:generate`,
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
its `R2BlobStore` refuses every key outside `images/`.

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

### YGOPRODeck (Yu-Gi-Oh!)

`src/import/ygoprodeck/` has the Scryfall shape (Workflow `src/workflows/ygoprodeck-import.ts`,
binding `YGOPRODECK_IMPORT`, `POST /admin/import/ygoprodeck`, one instance `ygoprodeck-<date>`
from the daily cron, prod 03:30 and dev 05:00 UTC; `CRON_SOURCES` in `src/import/schedule.ts` maps
every cron to its source). A run makes three requests, `cardinfo.php?misc=yes` (English),
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
of its own (`external_ids.language`); every print gets an `en` and a `de` localization. Images are
never fetched here: the source URLs sit in `external_ids` for the mirror (VB-57) and the API does
not serve them. Skipped and counted in `stats.skipped`: cards in no set and prints whose code and
rarity another card already holds (the first keeps it); the first 50 of those are listed in
`stats.codeConflicts` (`<code> <rarity>: <card id>`) for cleaning by hand. Follow-up: when the
source moves a code to another card, the print stays with the old one until it is moved by hand.
Locally, `POST /admin/import/ygoprodeck` as for Scryfall.

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
latest price per print, finish and source (market, low, mid, high; an older observation never
replaces a newer one); `prices_daily` one row per print, finish, source and UTC day (market, low,
high). Where the `timescaledb` extension is installed (the VPS), the migration turns `prices_daily`
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
   sets), matched to catalog sets by Scryfall's `tcgplayer_id`, then abbreviation = set code, then
   the name without TCGplayer's series prefix.
3. `prices <game> 000` …: products and prices of 25 matched groups per step, mapped to prints
   (below) and written to `prices_current` and `prices_daily`.
4. `finish run`: `import_runs` row (`source` `tcgcsv`, kind `prices`) `ok` with per-game counts
   (`groups`, `matchedGroups`, `cards`, `mapped`, `unmapped`, `prices`, `noMarket`) and
   `catalog_version` + 1.

A full run is about 2,500 requests; the first local run for Magic (2026-10-10) matched 352 of 454
groups and mapped 92,990 of 104,595 card products in 2 min 23 s. Every answer is kept
gzip-compressed in `RAW` under `raw/<env>/tcgcsv/<date>/<category>/` (`groups.json.gz`,
`<group>.products.json.gz`, `<group>.prices.json.gz`). Prices without a `marketPrice` (too few
sales) are not written. The cron runs on prod only: dev would be a second pull of the same build,
so dev imports on demand with `POST /admin/import/tcgcsv` (202, or 409 while one runs).

**Scryfall prices**: the Scryfall import Workflow ends with three steps (`prices: start run`,
`prices: write`, `prices: finish run`) that read the day's `default_cards` dump back from `RAW`
(never a second download) and write `cardmarket` and `tcgplayer_scryfall` rows per finish. A
failure there is logged and leaves the catalog import `ok`.

**Mapping** (`price_mappings`, `src/import/prices/match.ts`): which external product and finish
is which print, with a confidence. TCGCSV's `subTypeName` becomes the finish (`Normal` and
`Unlimited` → `normal`, `Foil` → `foil`, `Holofoil` → `holo`, `Reverse Holofoil` → `reverse`,
`1st Edition` → `first_edition`, anything else a slug).

| `method`       | Confidence | When                                                                      |
| -------------- | ---------- | ------------------------------------------------------------------------- |
| `scryfall_id`  | 100        | Magic: Scryfall's `tcgplayer_id` / `tcgplayer_etched_id`, `cardmarket_id` |
| `number_match` | 70         | Pokémon, Yu-Gi-Oh!: same set and collector number (Yu-Gi-Oh!: and rarity) |
| `name_match`   | 40         | No number match: a name that only one print of the set has                |
| `manual`       | 100        | An admin's override; the importers never change it                        |

Two products that claim one print with the same confidence are both left unmapped. Prices are
written through the table, so an override counts from the next run on:

```sh
curl -X PUT -H "Authorization: Bearer $ADMIN_TOKEN" -H 'Content-Type: application/json' \
  -d '{"externalId":"248137","note":"checked by hand"}' \
  localhost:8787/admin/price-mappings/<printId>/tcgplayer/normal
```

It answers the mapping (200), 404 for an unknown print and 409 when another print holds that
product and finish manually; an automatic holder gives it up.

**Read API** (`src/routes/prices.ts`, cached pool and `ETag` like the catalog, ADR 0004).
`GET /catalog/prints/:id/prices?currency=EUR|USD&finish=` answers every current price with its
source label and `observedAt`, the `display` price (finish first: `finish`, `normal`, the print's
finishes; then the source the currency prefers, EUR → Cardmarket, USD → TCGplayer; in that
source's currency) and the condition estimates of the display price.
`GET /catalog/prints/:id/prices/history?days=90` (1 to 3650) answers the market price per source
and finish, one point per day for the last 180 days and the last day of each ISO week before
that. The day comes from the Worker, never `now()` in SQL, so Hyperdrive can cache the query.
`GET /catalog/sets/:game/:code?currency=` carries each print's `marketPrice`: the `normal` finish
(the first finish when there is none), preferred source first. The display price, condition
estimates, collection value and the history thinning are in `packages/core/src/prices`.

**History backfill: not available.** TCGCSV's daily price archive
(`https://tcgcsv.com/archive/tcgplayer/prices-<date>.ppmd.7z`, history from 2024-02-08) answers 403
"temporarily removed due to rising server costs" (checked 2026-10-10), with no workaround offered.
History starts with the first daily run. If the archive returns, a backfill needs 7z (PPMd), which
a Worker cannot unpack: it would run as a Node script on the VPS like the image mirror, writing
`prices_daily` only through `writePrices`.

## Card images

`src/import/images.ts` (VB-57) copies every print's source image into the `CATALOG` bucket, which
is public through `img.voidbinder.de` (`IMAGE_BASE_URL`): Scryfall `large` for Magic (then
`normal`, `png`; only once Scryfall has the high-res scan, `highres_image`, and never its
missing-image placeholder), YGOPRODeck `image_url`, TCGdex `tcgdex_images.high` (the keys of
`external_ids` the importers fill). A low-res Magic image stays unmirrored and the API serves
Scryfall's URL until a later run finds the scan.

| Key                                          | What                                          |
| -------------------------------------------- | --------------------------------------------- |
| `images/<game>/<sourceId>/<lang>/orig.<ext>` | The source file unchanged, its content type   |
| `images/<game>/<sourceId>/<lang>/sm.webp`    | 320 px wide WebP, same aspect, never enlarged |

`<sourceId>` is the source's stable id, never a database id, so `dev` and `prod` share the
objects and a re-import never changes a key: the Scryfall card id (`mtg`), the YGOPRODeck image
id from `image_url` (`yugioh`, one artwork shared by its set prints), the TCGdex card id
(`pokemon`, e.g. `swsh3-136`). Both carry `Cache-Control: public, max-age=31536000, immutable`.

`prints.image_key` (English) and `print_localizations.image_key` hold the `sm` key once that copy
exists and the `orig` key until then, so `imageUrl` is the small copy whenever there is one,
without a request to R2 (`hasSm`). Rows that share a source URL share one object pair (a print
and its English localization, a Yu-Gi-Oh! card in several sets). Downloads are rate limited per
source (token bucket: Scryfall 20/s, YGOPRODeck 15/s, TCGdex 8/s); a 429 stops the run once the
images in flight are stored, a failed image is logged and keeps its key (or none), so the next
run retries it. Every run is an `import_runs` row with source and kind `images`, and only one
runs per database at a time (`pg_try_advisory_xact_lock`; a second one stops with "another image
mirror is running").

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

## Deploy

From Max's workstation with `wrangler login` ([ADR 0002](../../docs/adr/0002-deploys-from-workstation.md)):

```sh
pnpm --filter api deploy:dev    # voidbinder-api-dev on workers.dev
pnpm --filter api deploy:prod   # voidbinder-api on api.voidbinder.de
```

Both pass the short git sha as `VERSION` (`--var`), which `GET /health` reports. `pnpm build`
runs `wrangler deploy --dry-run --outdir dist` (top-level config) as a bundling check only.
