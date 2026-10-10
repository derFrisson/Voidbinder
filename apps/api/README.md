# apps/api

The Voidbinder API: a Cloudflare Worker with [Hono](https://hono.dev), Smart Placement,
PostgreSQL through Hyperdrive with Drizzle, and R2 for catalog files. The app talks to it through
the typed client in `src/client.ts`. Architecture: [ADR 0001](../../docs/adr/0001-stack.md),
caching: [ADR 0004](../../docs/adr/0004-caching-catalog-reads.md), environments and secrets:
[docs/environments.md](../../docs/environments.md).

## Layout

| Path                         | What                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`               | Worker entry (`fetch`, `scheduled`, the `purgeCache` RPC of Caching) and `export type AppType`                            |
| `src/app.ts`                 | `createApp(deps)`: the Hono app from injected dependencies (tests need no binding)                                        |
| `src/routes/`                | Routes: `GET /health`, `/me`, `GET /catalog/**`, `/collection/**`, `/decks/**`, `/sync/**`, `POST /admin/import/<source>` |
| `src/auth/`                  | Better Auth (`createAuth`), `requireUser`, auth mails, the app's auth client, 2FA encryption                              |
| `src/middleware/`            | Request id, JSON access log, error handler, default `Cache-Control: no-store`, catalog cache headers                      |
| `src/platform/cloudflare/`   | The only code that touches bindings: `createPlatform(env)` and the implementations                                        |
| `src/db/schema/`, `drizzle/` | Drizzle schema and the committed SQL migrations                                                                           |
| `src/import/`                | Catalog importers (Scryfall, YGOPRODeck), prices (`prices/`); see Importers, Prices                                       |
| `src/workflows/`             | Cloudflare Workflows that run the importers                                                                               |
| `src/client.ts`              | `createApiClient(baseUrl, options?)`, exported as `@voidbinder/api/client`                                                |
| `src/auth/client.ts`         | `createApiAuthClient(baseURL, options?)`, exported as `@voidbinder/api/auth-client`                                       |

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

| Route                                                             | Answer                                                                               |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------ |
| `GET /catalog/games`                                              | Games with their set counts                                                          |
| `GET /catalog/games/:game/sets?lang=`                             | Sets, newest first, with the name in `lang`                                          |
| `GET /catalog/sets/:game/:code?lang=&rarity=&finish=&sort=&page=` | Set header and 60 prints per page (`sort`: number, name, rarity, price)              |
| `GET /catalog/cards/:id?currency=`                                | Card, legalities and every print with localizations and `marketPrice`                |
| `GET /catalog/prints/:id`                                         | One print with its card                                                              |
| `GET /catalog/prints/:id/prices?currency=&finish=`                | Current prices, display price, condition estimates (see Prices)                      |
| `GET /catalog/prints/:id/prices/history?days=`                    | Daily market prices per source and finish (see Prices)                               |
| `GET /catalog/modules`                                            | Manifests of the offline catalog modules, one per game (see Offline catalog modules) |

Schemas: `packages/shared/src/api/catalog.ts`. Image URLs are `IMAGE_BASE_URL/<image_key>` once the
image is in R2 (VB-57) and the source's URL until then. Every 200 carries
`Cache-Control: public, max-age=60, s-maxage=600, stale-while-revalidate=60` and an `ETag` of
`catalog_version` plus a hash of the body (`src/middleware/catalog-cache.ts`); `If-None-Match`
answers 304. Cloudflare also caches them at the edge (see Caching). The queries use no `now()` or
other non-immutable function, so Hyperdrive can cache them.

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
   | `catalog` | `/catalog/**` except modules                                                                                    | every catalog import (Scryfall, YGOPRODeck, TCGdex)                |
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
`external_ids.tcgdex_images` for VB-57 and nothing is downloaded; Cardmarket and TCGplayer ids go
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
so dev imports on demand with `POST /admin/import/tcgcsv` (202, or 409 while one runs). A second
prod cron at 22:30 UTC (instance `tcgcsv-<date>-late`) catches a build that landed late: when the
20:30 run imported the build it reads `last-updated.txt` and ends without bumping
`catalog_version`. Either cron is skipped (and logged) while a TCGCSV run is still going.

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
| `name_match`   | 40         | No number match: a name that only one print of the set has                |
| `manual`       | 100        | An admin's override; the importers never change it                        |

Two products that claim one print with the same confidence are both left unmapped, and so is a
TCGplayer id Scryfall gives more than one print. TCGCSV prices are written through the table, so
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
`GET /catalog/prints/:id/prices?currency=EUR|USD&finish=` answers every current price with its
source label and `observedAt`, the `display` price (finish first: `finish`, `normal`, the print's
finishes; then the source the currency prefers, EUR → Cardmarket, USD → TCGplayer; in that
source's currency) and the condition estimates of the display price.
`GET /catalog/prints/:id/prices/history?days=90` (1 to 3650) answers the market price per source
and finish, one point per day for the last 180 days and the last day of each ISO week before
that. The day comes from the Worker, never `now()` in SQL, so Hyperdrive can cache the query.
`GET /catalog/sets/:game/:code?currency=`, `GET /catalog/search?currency=` and
`GET /catalog/cards/:id?currency=` (every print of the card) carry each print's `marketPrice` with
its `observedAt`: the `normal` finish (the first finish when there is none, then the print's other
finishes), then a finish the print does not list but has a price row for (Yu-Gi-Oh!: TCGplayer
prices per edition, `first_edition`, while the print says `normal`), preferred source first; null
only without any price row. The display price, condition
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

Both pass the short git sha as `VERSION` (`--var`), which `GET /health` reports. `pnpm build`
runs `wrangler deploy --dry-run --outdir dist` (top-level config) as a bundling check only.
