# apps/api

The Voidbinder API: a Cloudflare Worker with [Hono](https://hono.dev), Smart Placement,
PostgreSQL through Hyperdrive with Drizzle, and R2 for catalog files. The app talks to it through
the typed client in `src/client.ts`. Architecture: [ADR 0001](../../docs/adr/0001-stack.md),
caching: [ADR 0004](../../docs/adr/0004-caching-catalog-reads.md), environments and secrets:
[docs/environments.md](../../docs/environments.md).

## Layout

| Path                         | What                                                                               |
| ---------------------------- | ---------------------------------------------------------------------------------- |
| `src/index.ts`               | Worker entry (`fetch`) and `export type AppType`                                   |
| `src/app.ts`                 | `createApp(deps)`: the Hono app from injected dependencies (tests need no binding) |
| `src/routes/`                | Routes: `GET /health`, `GET /catalog/**`, `POST /admin/import/scryfall`            |
| `src/middleware/`            | Request id, JSON access log, error handler, default `Cache-Control: no-store`      |
| `src/platform/cloudflare/`   | The only code that touches bindings: `createPlatform(env)` and the implementations |
| `src/db/schema/`, `drizzle/` | Drizzle schema and the committed SQL migrations                                    |
| `src/import/`                | Catalog importers (Scryfall); see Importers                                        |
| `src/workflows/`             | Cloudflare Workflows that run the importers                                        |
| `src/client.ts`              | `createApiClient(baseUrl, options?)`, exported as `@voidbinder/api/client`         |

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
`localConnectionString` (no caching locally) and R2 is simulated under `.wrangler/state`. To
override a var locally, `cp .dev.vars.example .dev.vars` and edit it (gitignored); it also holds
the local `ADMIN_TOKEN`.

## Tests

```sh
pnpm --filter api test
DATABASE_URL=postgres://voidbinder:voidbinder@localhost:5434/voidbinder pnpm --filter api test
```

Two Vitest projects: `unit` (`src/**/*.test.ts`, Node) runs the app through `createApp` with
fakes, the typed client against the in-memory app, the Scryfall mapping on the fixtures in
`test/fixtures/scryfall/` (real Scryfall objects, no network), and, when `DATABASE_URL` is set, the
migrations, the import pipeline and the catalog routes against Postgres. Tests that write the
catalog each create their own database on that server (`freshDatabase()` in
`src/test-helpers.ts`) and drop it afterwards, so the user needs `CREATEDB`. `worker` (`test/`, workerd via
`@cloudflare/vitest-plugin`) runs the real Worker with the bindings of `wrangler.jsonc`: the R2
blob store always, `/health` through Hyperdrive when `DATABASE_URL` is set. CI runs both with a
Postgres service.

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
   transaction. Then `clean up chunks` deletes the run's chunks. A failure marks the run `failed`
   and leaves `catalog_version` alone.

Rows are upserted on their unique keys and only written when the hash of the mapped payload
(`source_hash`) changed, so a re-run with the same data touches nothing. Skipped: tokens, emblems,
art series, digital-only cards and sets, token sets. Reversible cards map to the card of their front
face. Old School legality is per print at Scryfall and is not kept on the card.

R2 layout (bucket `voidbinder-catalog`):

| Key                                                  | What                                        |
| ---------------------------------------------------- | ------------------------------------------- |
| `raw/scryfall/<date>/default_cards.jsonl.gz`         | Raw bulk file as downloaded, kept           |
| `raw/scryfall/<date>/all_cards.jsonl.gz`             | Raw bulk file as downloaded, kept           |
| `raw/scryfall/<date>/sets.json`                      | Raw `GET /sets` answer, kept                |
| `work/scryfall/<run id>/{default,all}_cards/*.jsonl` | Chunks of one run, deleted when it succeeds |

The Workflow `src/workflows/scryfall-import.ts` (binding `SCRYFALL_IMPORT`) wraps every step in
`step.do` (3 retries with exponential backoff, 30 min timeout). Completed steps are never run again
within an instance, so after a failed step the instance continues where it stopped, and a
restarted Worker resumes the instance at the first unfinished step. Step results are small counts
(Workflows keeps at most 1 MiB per step); a run has about 100 steps (limit 10,000). Splitting the
2 GB `all_cards` dump in one step needs more than the default 30 s of CPU, hence `limits.cpu_ms`
300000 in `wrangler.jsonc`.

It starts daily at 03:00 UTC (cron trigger, instance id `scryfall-<date>`, so one per day) and on
`POST /admin/import/scryfall` with `Authorization: Bearer $ADMIN_TOKEN` (answers 202).

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

## Deploy

From Max's workstation with `wrangler login` ([ADR 0002](../../docs/adr/0002-deploys-from-workstation.md)):

```sh
pnpm --filter api deploy:dev    # voidbinder-api-dev on workers.dev
pnpm --filter api deploy:prod   # voidbinder-api on api.voidbinder.de
```

Both pass the short git sha as `VERSION` (`--var`), which `GET /health` reports. `pnpm build`
runs `wrangler deploy --dry-run --outdir dist` (top-level config) as a bundling check only.
