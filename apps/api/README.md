# apps/api

The Voidbinder API: a Cloudflare Worker with [Hono](https://hono.dev), Smart Placement,
PostgreSQL through Hyperdrive with Drizzle, and R2 for catalog files. The app talks to it through
the typed client in `src/client.ts`. Architecture: [ADR 0001](../../docs/adr/0001-stack.md),
caching: [ADR 0004](../../docs/adr/0004-caching-catalog-reads.md), environments and secrets:
[docs/environments.md](../../docs/environments.md).

## Layout

| Path                         | What                                                                                |
| ---------------------------- | ----------------------------------------------------------------------------------- |
| `src/index.ts`               | Worker entry (`fetch`) and `export type AppType`                                    |
| `src/app.ts`                 | `createApp(deps)`: the Hono app from injected dependencies (tests need no binding)  |
| `src/routes/`                | Routes (`GET /health`, `GET/PATCH/DELETE /me`)                                      |
| `src/auth/`                  | Better Auth (`createAuth`), `requireUser`, auth mails, the app's auth client        |
| `src/middleware/`            | Request id, JSON access log, error handler, default `Cache-Control: no-store`       |
| `src/platform/cloudflare/`   | The only code that touches bindings: `createPlatform(env)` and the implementations  |
| `src/db/schema/`, `drizzle/` | Drizzle schema and the committed SQL migrations                                     |
| `src/client.ts`              | `createApiClient(baseUrl, options?)`, exported as `@voidbinder/api/client`          |
| `src/auth/client.ts`         | `createApiAuthClient(baseURL, options?)`, exported as `@voidbinder/api/auth-client` |

Request and response schemas (Zod) live in `packages/shared/src/api` and are imported from
`@voidbinder/shared/api`. Errors always have the shape `{ error: { code, message, requestId } }`
(plus `issues` on a 400 validation error); a 500 never carries the cause, which goes to the log.

## Platform seams

`packages/core/src/platform` defines `CardStore`, `BlobStore`, `VectorIndex` and `JobQueue`.
The Cloudflare implementations live in `src/platform/cloudflare`: `DrizzleCardStore`
(`drizzle-card-store.ts`, PostgreSQL via Hyperdrive) and `R2BlobStore` (`r2-blob-store.ts`, the
`CATALOG` bucket). `VectorIndex` (VB-37) and `JobQueue` (VB-26) are interfaces only so far.

`createPlatform(env)` opens two per-request pools: one on `HYPERDRIVE` (caching disabled, for
everything) and one on `HYPERDRIVE_CACHED` (reads cached up to 300 s, for the catalog and price
stores only, ADR 0004). Without `HYPERDRIVE_CACHED` (self-hosting) both are the same pool.

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
(`openssl rand -base64 32`); `wrangler dev` refuses to start without it. Vars can be overridden
there too.

## Tests

```sh
pnpm --filter api test
DATABASE_URL=postgres://voidbinder:voidbinder@localhost:5434/voidbinder pnpm --filter api test
```

Two Vitest projects: `unit` (`src/**/*.test.ts`, Node) runs the app through `createApp` with
fakes, the typed client against the in-memory app, and, when `DATABASE_URL` is set, the
migrations, `DrizzleCardStore.ping()` and the auth flows and `/me` (`src/auth/auth.test.ts`)
against Postgres. `worker` (`test/`, workerd via
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
the `session` table stays the source of truth. Ceiling: a session revoked elsewhere (password
reset, `DELETE /me`, sign-out on another device) still passes on a client that holds a fresh
cache cookie, for up to those 5 minutes. Bearer requests always read the table. Browser requests
must come from `APP_URL` or `CORS_EXTRA_ORIGINS` (Better Auth's `trustedOrigins`, same list as
CORS).

**Native clients (Sprint 3) and curl** send `Authorization: Bearer <token>` with the token from
`set-auth-token` (the `bearer` plugin); `createApiAuthClient(url, { bearerToken })` does that.

**Routes that need a user** use `requireUser` (`src/auth/middleware.ts`): it reads the session
once and sets `c.var.user`, or answers 401. `GET /me` and `PATCH /me` read the `user` row itself,
so a change shows up at once even while the cookie cache holds the old profile.

**Account deletion is a stub until VB-45:** `DELETE /me` records the request and ends every
session; the job that purges the account and its data after the grace period comes with VB-45.
Until then the user can still sign in again.

**Rate limits** count per client IP (`cf-connecting-ip`) in the `rate_limit` table, so every
isolate sees the same count: sign-up 3 and sign-in 5 per minute (`AUTH_RATE_LIMITS`), Better
Auth's defaults elsewhere (password-reset and verification mails 3 per minute), `/get-session`
unlimited. Over the limit: 429 with `X-Retry-After`. A request without the header falls into one
shared bucket, so the web app's proxy must pass `cf-connecting-ip` on.

**Mails** (verification, password reset) go out through the `EMAIL` binding (Cloudflare Email
Service, `hello@voidbinder.de`, sender name "Voidbinder") in the user's `language`; sign-up sets
it from `Accept-Language` (`de` otherwise). Locally `wrangler dev` does not send them: it logs
the mail and writes its text and HTML under `.wrangler/tmp/email/`. The copy is in
`src/auth/mail.ts`.

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
migrated like every other table (`drizzle/0001_auth.sql`). Regenerate it, then `db:generate`,
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

## Deploy

From Max's workstation with `wrangler login` ([ADR 0002](../../docs/adr/0002-deploys-from-workstation.md)):

```sh
pnpm --filter api deploy:dev    # voidbinder-api-dev on workers.dev
pnpm --filter api deploy:prod   # voidbinder-api on api.voidbinder.de
```

Both pass the short git sha as `VERSION` (`--var`), which `GET /health` reports. `pnpm build`
runs `wrangler deploy --dry-run --outdir dist` (top-level config) as a bundling check only.
