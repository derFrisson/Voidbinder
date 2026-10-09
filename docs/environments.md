# Environments and secrets

## Environments

| App  | Environment | Where                                    | How it is selected                           |
| ---- | ----------- | ---------------------------------------- | -------------------------------------------- |
| site | local       | `pnpm dev` (Astro dev server on workerd) | default                                      |
| site | `dev`       | `voidbinder-site-dev` on workers.dev     | `CLOUDFLARE_ENV=dev`, `wrangler --env dev`   |
| site | `prod`      | `voidbinder.de`, `www.voidbinder.de`     | `CLOUDFLARE_ENV=prod`, `wrangler --env prod` |
| api  | local       | `pnpm --filter api dev` (`wrangler dev`) | default (top level of the config)            |
| api  | `dev`       | `voidbinder-api-dev` on workers.dev      | `wrangler --env dev`                         |
| api  | `prod`      | `api.voidbinder.de` (`voidbinder-api`)   | `wrangler --env prod`                        |

The site's Cloudflare config is `apps/site/wrangler.jsonc`. `@astrojs/cloudflare` 14 builds through
`@cloudflare/vite-plugin`, so the environment is chosen at **build** time: `astro build` reads
`CLOUDFLARE_ENV`, flattens that environment into the generated deploy config and points
`wrangler deploy` at it through `.wrangler/deploy/config.json`. Always build and deploy with the
same environment:

```sh
pnpm --filter site deploy:dev    # CLOUDFLARE_ENV=dev astro build && wrangler deploy --env dev
pnpm --filter site deploy:prod   # CLOUDFLARE_ENV=prod astro build && wrangler deploy --env prod
```

Wrangler refuses `--env dev` when the build was made for `prod` (and vice versa). A build without
`CLOUDFLARE_ENV` targets the top-level config (`voidbinder-site`, no routes), so never deploy a
plain `pnpm build` output. Deploys run from Max's workstation with his `wrangler login`
([ADR 0002](adr/0002-deploys-from-workstation.md)); CI only checks.

The API's config is `apps/api/wrangler.jsonc`. It has no build step: `wrangler deploy --env dev|prod`
bundles `src/index.ts` itself (`pnpm --filter api deploy:dev|prod`, which also sets `VERSION` to
the short git sha). Details: [apps/api/README.md](../apps/api/README.md).

## Database

`dev` and `prod` share one self-hosted PostgreSQL 18 + TimescaleDB server (databases
`voidbinder_dev` and `voidbinder`), reached through a Cloudflare Tunnel, a Workers VPC service and
Hyperdrive configs per environment ([ADR 0003](adr/0003-price-history-storage.md)). Setup,
backups and operations: [guides/database-vps.md](guides/database-vps.md). Locally, the root
`docker-compose.yml` runs Postgres on port 5434.

| Environment | Hyperdrive config        | Caching          | Id                                 | Bound as                                                 |
| ----------- | ------------------------ | ---------------- | ---------------------------------- | -------------------------------------------------------- |
| `dev`       | `voidbinder-dev`         | disabled         | `6f5b0953850f4b7b99450961849113ab` | `HYPERDRIVE` in `apps/site` and `apps/api`               |
| `dev`       | `voidbinder-dev-cached`  | 300 s + swr 60 s | `80164a75f1224f34a30fc31f0dac35ca` | `HYPERDRIVE_CACHED` in `apps/api` (catalog, prices only) |
| `prod`      | `voidbinder-prod`        | disabled         | `2f4e2569cde54e0998b734c884432765` | `HYPERDRIVE` in `apps/site` and `apps/api`               |
| `prod`      | `voidbinder-prod-cached` | 300 s + swr 60 s | `095f0ec41117431c8b29eec7134dde62` | `HYPERDRIVE_CACHED` in `apps/api` (catalog, prices only) |

Why two configurations per environment: [ADR 0004](adr/0004-caching-catalog-reads.md). The site
and the API migrate the same databases with separate journal tables (`drizzle.__drizzle_migrations`
and `drizzle.__drizzle_migrations_api`), always from the workstation through the SSH tunnel
([apps/api/README.md](../apps/api/README.md#migrations)).

The API (ADR 0004) adds one cached configuration per environment for catalog and price reads: `voidbinder-dev-cached` `80164a75f1224f34a30fc31f0dac35ca`, `voidbinder-prod-cached` `095f0ec41117431c8b29eec7134dde62` (max_age 300 s, stale_while_revalidate 60 s, 10 connections).

## Secrets

- **Locally:** each app keeps its secrets in its own `.dev.vars` (for example
  `apps/api/.dev.vars`), read by `astro dev` / `wrangler dev`. `.dev.vars.<env>` overrides it for one
  environment. These files are gitignored, never commit them; commit a `.dev.vars.example` with
  dummy values when an app needs secrets.
- **Deployed:** set per environment with `wrangler secret put <NAME> --env dev|prod` from the app's
  directory. Non-secret settings go into `vars` in `wrangler.jsonc`.
- **Site secrets:** `apps/site` needs `UNSUBSCRIBE_SECRET` (HMAC key for the waitlist unsubscribe
  links, [waitlist.md](site/waitlist.md)). Locally `cp apps/site/.dev.vars.example
apps/site/.dev.vars`; deployed, once per environment from `apps/site`:
  `openssl rand -base64 32 | pnpm exec wrangler secret put UNSUBSCRIBE_SECRET --env dev|prod`.
  `wrangler.jsonc` lists it under `secrets.required`, so `wrangler deploy` fails while it is unset.
- **API secrets:** `apps/api` needs `ADMIN_TOKEN`, the bearer token of `/admin/**` (`POST
/admin/import/scryfall`), and `BETTER_AUTH_SECRET` (32+ bytes; signs the session cookies and
  tokens, [apps/api/README.md](../apps/api/README.md#authentication)). Locally
  `cp apps/api/.dev.vars.example apps/api/.dev.vars`; deployed, once per environment from
  `apps/api`: `openssl rand -base64 32 | pnpm exec wrangler secret put <NAME> --env dev|prod`. Both
  are under `secrets.required`, so `wrangler deploy` fails while one is unset; a Worker without
  `ADMIN_TOKEN` answers 404 on `/admin/**`, and changing `BETTER_AUTH_SECRET` signs every user out.
- **API settings** are `vars` in `apps/api/wrangler.jsonc`: `APP_URL` (CORS and the auth mail
  links), `API_URL`, `CORS_EXTRA_ORIGINS` (the Expo web dev origin, locally and in `dev` only),
  `IMAGE_BASE_URL` (base of the R2 card images; until VB-57 fills `image_key` the catalog answers
  with the source's image URL), `SCRYFALL_LANGUAGES` (print languages the Scryfall import keeps,
  `en,de`; English always comes from `default_cards`, the others from `all_cards`), `IMPORT_ENV`
  (prefix of the import's R2 keys, `raw/<env>/…` and `work/<env>/…`: `local`, `dev`, `prod`, so the
  environments sharing the bucket never touch each other's dumps), `VERSION`.
- **API bindings** besides `HYPERDRIVE`, `HYPERDRIVE_CACHED` (catalog reads only, see Database) and
  two R2 buckets (EU jurisdiction, shared by all environments): `CATALOG` → `voidbinder-catalog`,
  public through `img.voidbinder.de` and written with `images/` keys only (the Worker refuses any
  other key), and `RAW` → `voidbinder-raw`, private, for the imports' raw dumps and work chunks.
  Then `SCRYFALL_IMPORT`, the Workflow `voidbinder-scryfall-import-dev` /
  `voidbinder-scryfall-import` (class `ScryfallImportWorkflow`), started daily by the cron trigger
  (prod 03:00 UTC, dev 04:30 UTC). The API sets `limits.cpu_ms` to 300000 for it (Workers Paid).
  `EMAIL` (`send_email`, sender `hello@voidbinder.de`) sends the auth mails.
- **Analytics token (not a secret):** `PUBLIC_CF_ANALYTICS_TOKEN` is the Cloudflare Web Analytics
  site token, read by `astro build` and baked into the static pages (it is public in the HTML).
  Unset or empty means no beacon is rendered, which is the default for local builds and CI. Create
  one Web Analytics site per environment in the Cloudflare dashboard (Web Analytics, add a site,
  manual JS snippet: the workers.dev host for `dev`, `voidbinder.de` for `prod`, with automatic
  injection off) and pass its token to the build:
  `PUBLIC_CF_ANALYTICS_TOKEN=<token> pnpm --filter site deploy:dev|prod`. See
  [site/seo.md](site/seo.md).
- **GitHub:** no secrets are needed yet. CI does not deploy; a scoped Cloudflare API token is added
  only when CI deploys are introduced.

The repository is public: `.gitignore` excludes `.dev.vars*`, `.env*` (except `.env.example`),
`.wrangler/`, `node_modules`, `dist`, `.turbo` and `.worktrees/`.

## Dependency policy

pnpm 12 (pinned in `packageManager`) refuses to resolve a version published less than 24 hours ago (`minimumReleaseAge`, pnpm's default). The policy stays on. If `pnpm install` reports a lockfile entry inside the cutoff, lower the range's floor to the previous release instead of relaxing the policy. Build scripts run only for the packages listed under `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds <pkg>` adds one).
