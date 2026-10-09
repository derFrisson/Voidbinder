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
| `src/routes/`                | Routes: `GET /health`, `GET/PATCH/DELETE /me`, `GET /catalog/**`, `POST /admin/import/scryfall` |
| `src/auth/`                  | Better Auth (`createAuth`), `requireUser`, auth mails, the app's auth client                    |
| `src/middleware/`            | Request id, JSON access log, error handler, default `Cache-Control: no-store`                   |
| `src/platform/cloudflare/`   | The only code that touches bindings: `createPlatform(env)` and the implementations              |
| `src/db/schema/`, `drizzle/` | Drizzle schema and the committed SQL migrations                                                 |
| `src/import/`                | Catalog importers (Scryfall); see Importers                                                     |
| `src/workflows/`             | Cloudflare Workflows that run the importers                                                     |
| `src/client.ts`              | `createApiClient(baseUrl, options?)`, exported as `@voidbinder/api/client`                      |
| `src/auth/client.ts`         | `createApiAuthClient(baseURL, options?)`, exported as `@voidbinder/api/auth-client`             |

Request and response schemas (Zod) live in `packages/shared/src/api` and are imported from
`@voidbinder/shared/api`. Errors always have the shape `{ error: { code, message, requestId } }`
(plus `issues` on a 400 validation error); a 500 never carries the cause, which goes to the log.

## Platform seams

`packages/core/src/platform` defines `CardStore`, `BlobStore`, `VectorIndex` and `JobQueue`.
The Cloudflare implementations live in `src/platform/cloudflare`: `DrizzleCardStore`
(`drizzle-card-store.ts`, PostgreSQL via Hyperdrive), `R2BlobStore` (`r2-blob-store.ts`, the
`CATALOG` bucket) and `WorkflowJobQueue` (`workflow-job-queue.ts`, a job type per Workflow
binding). `VectorIndex` (VB-37) is an interface only so far.

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

`src/import/scryfall/` imports Scryfall's bulk data; it is the pattern for the Yu-Gi-Oh! and
Pokémon importers. `pipeline.ts` runs these steps, each retried on its own:

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

R2 layout (bucket `voidbinder-catalog`, shared by all environments; `<env>` is the `IMPORT_ENV`
var: `local` for `wrangler dev`, `dev`, `prod`):

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
`external_ids.tcgdex_images` for VB-57 and nothing is downloaded; Cardmarket and TCGplayer ids go
to `external_ids.tcgdex_marketplace` with `mapping_confidence: 'low'` (not under `tcgplayer`, which
`prints_tcgplayer_idx` reads), for VB-30 to verify. The Workflow `src/workflows/tcgdex-import.ts`
(binding `TCGDEX_IMPORT`, params `{ mode }`) runs `start run`, `set list`, `sets 00000` … (25 sets
per step: details in both languages, upserts), `plan`, `cards <set> <n>` (100 cards in both
languages per step, upserted in one transaction) and `finish run` (counts in `stats`,
`catalog_version` + 1; a failure marks the run `failed`); a failed step is retried alone. A full
import is about 42,000 requests (roughly 80 minutes), so the daily run (the same cron as Scryfall,
instance id `tcgdex-<date>`, not started while a TCGdex run is still going) is `incremental`: it
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

## Deploy

From Max's workstation with `wrangler login` ([ADR 0002](../../docs/adr/0002-deploys-from-workstation.md)):

```sh
pnpm --filter api deploy:dev    # voidbinder-api-dev on workers.dev
pnpm --filter api deploy:prod   # voidbinder-api on api.voidbinder.de
```

Both pass the short git sha as `VERSION` (`--var`), which `GET /health` reports. `pnpm build`
runs `wrangler deploy --dry-run --outdir dist` (top-level config) as a bundling check only.
