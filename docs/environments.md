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
| app  | local       | `pnpm --filter app dev` (Expo, :8081)    | `EXPO_PUBLIC_API_URL` → local API            |
| app  | `dev`       | `voidbinder-app-dev` on workers.dev      | `wrangler --env dev`                         |
| app  | `prod`      | `app.voidbinder.de` (`voidbinder-app`)   | `wrangler --env prod`                        |

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

The app's config is `apps/app/wrangler.jsonc`. `expo export --platform web` builds the same
`dist/` for every environment (the API is always the same origin, `/api`); the environment only
picks the Worker name and the API the `API` service binding points at (`voidbinder-api-dev` in
`dev`, `voidbinder-api` in `prod`): `pnpm --filter app deploy:dev|prod`. Deploy the API first, so the
binding has a Worker to point at. The app has no secrets.
Details: [apps/app/README.md](../apps/app/README.md).

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
/admin/import/scryfall`), `BETTER_AUTH_SECRET` (32+ bytes; signs the session cookies and tokens,
  [apps/api/README.md](../apps/api/README.md#authentication)) and `TWO_FACTOR_ENCRYPTION_KEY` (32
  bytes in base64; encrypts the two-factor secrets and backup codes at rest with AES-256-GCM,
  VB-68). Locally `cp apps/api/.dev.vars.example apps/api/.dev.vars`; deployed, once per
  environment from `apps/api`: `openssl rand -base64 32 | pnpm exec wrangler secret put <NAME>
--env dev|prod`. All three secrets, and `TURNSTILE_SECRET` (the Turnstile bullet below), are under `secrets.required`, so `wrangler deploy` fails while
  one is unset; a Worker without `ADMIN_TOKEN` answers 404 on `/admin/**`, changing
  `BETTER_AUTH_SECRET` signs every user out, and changing `TWO_FACTOR_ENCRYPTION_KEY` after users
  enrolled makes their second factor unreadable.
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
- **Search index (VB-98, [ADR 0006](adr/0006-search-index-d1.md)):** `SEARCH`, a D1 database per
  environment with the typeahead's copy of the catalog, migrations in `apps/api/d1/` (applied by
  `deploy:dev` / `deploy:prod`), and `SEARCH_INDEX_REFRESH`, the Workflow
  `voidbinder-search-index-refresh-dev` / `voidbinder-search-index-refresh` (class
  `SearchIndexRefreshWorkflow`) that refreshes it from Postgres after every catalog import.
  Locally `wrangler dev` simulates the database under `.wrangler/state`.

  | Environment | D1 database              | Id                      | Location | Read replication |
  | ----------- | ------------------------ | ----------------------- | -------- | ---------------- |
  | `dev`       | `voidbinder-search-dev`  | not created yet (VB-98) | `weur`   | on (dashboard)   |
  | `prod`      | `voidbinder-search-prod` | not created yet (VB-98) | `weur`   | on (dashboard)   |

  No jurisdiction: the index holds public catalog data only, and replicas should follow the
  users. Create: `pnpm exec wrangler d1 create voidbinder-search-<env> --location weur` from
  `apps/api`, the id into `wrangler.jsonc`; read replication is switched on in the dashboard (D1 →
  the database → Settings) or with the REST API, not with wrangler. After the first deploy:
  `POST /admin/search-index/rebuild`.

- **Turnstile (VB-72):** one Cloudflare Turnstile widget (managed mode, name "Voidbinder", account
  `152a1fcd0eebb96d1bc30d14b5a6af58`) protects the sign-up, the password-reset request, the
  verification resend (API, web app) and the waitlist form (site). Its hostnames are
  `voidbinder.de`, `www.voidbinder.de`, `voidbinder-site-dev.frisson.workers.dev`,
  `app.voidbinder.de`, `voidbinder-app-dev.frisson.workers.dev` and `localhost`; a new hostname
  (a preview domain, a new app origin) must be added to the widget in the dashboard (Turnstile).
  - **Sitekey** `0x4AAAAAAFS5R7qPne3TN2Nz` (public): the wrangler var `TURNSTILE_SITE_KEY` in `apps/site` (read at
    build, `env` of `cloudflare:workers` in the prerender) and `apps/api` (documentation only, the
    API verifies tokens and never renders a widget); locally and in the tests Cloudflare's
    always-passes test key `1x00000000000000000000AA`. The web app is an `expo export`, so its key
    is inlined at build time as `EXPO_PUBLIC_TURNSTILE_SITE_KEY` (listed under `build.env` in
    `turbo.json`): `pnpm --filter app deploy:dev|prod` set the real key above, a plain
    `pnpm --filter app build` (CI, local) uses the test key, and a build that forgot the key fails
    closed (the API's real secret rejects the test key's tokens).
  - **Secret** `TURNSTILE_SECRET` on `apps/api` and `apps/site`, once per environment from each
    app's directory (the value is shown once when the widget is created, and the dashboard or
    `GET /accounts/<id>/challenges/widgets/<sitekey>` returns it again):
    `pnpm exec wrangler secret put TURNSTILE_SECRET --env dev|prod`. Both list it under
    `secrets.required`, so `wrangler deploy` fails while it is unset. Locally it is the test secret
    `1x0000000000000000000000000000000AA` from `.dev.vars.example`; the API then skips the check
    when `IMPORT_ENV` is `local`, and the site when `SITE_URL` is on `localhost`, so no widget
    token is needed on a developer machine.
  - **Native bypass:** the vars `TURNSTILE_NATIVE_BYPASS` of `apps/api` (`"false"`, never
    `"true"` in prod) lets a request with an `Authorization: Bearer` header skip the check. It is
    the Sprint 3 stopgap until the React Native client has a widget; off, native sign-ups are
    refused with 400 `turnstile_failed`. The header is never validated, so `"true"` switches the
    check off for any client that sends one, not only native apps: it means no bot protection.
- **Site settings** are `vars` in `apps/site/wrangler.jsonc`, read at build (`env` of
  `cloudflare:workers` in the prerender, so build and deploy with the same `CLOUDFLARE_ENV`):
  `PUBLIC_APP_URL` is the web app the header and hero buttons link to (`https://app.voidbinder.de`
  in `prod`, `https://voidbinder-app-dev.frisson.workers.dev` in `dev`, `http://localhost:8081`
  locally), and `PLAUSIBLE_HOST` (VB-74) is the hostname of the self-hosted Plausible
  (`web-analytics.voidcom.app`), **set in `prod` only**. With it the pages carry
  `<script defer data-domain="voidbinder.de" src="https://<host>/js/script.js">` and the CSP names
  the host in `script-src` and `connect-src`; without it (local, `dev`, CI) there is no script and
  no CSP entry. Plausible stores no cookies and no personal data, so there is no consent banner
  ([site/seo.md](site/seo.md)). It replaces the Cloudflare Web Analytics beacon and its
  `PUBLIC_CF_ANALYTICS_TOKEN`, which no longer exists. The Plausible instance itself (server,
  site `voidbinder.de`) is operated outside this repository.
- **Web app analytics (not a secret):** `EXPO_PUBLIC_PLAUSIBLE_HOST` (the self-hosted Plausible,
  `https://web-analytics.voidcom.app`) and `EXPO_PUBLIC_PLAUSIBLE_DOMAIN` (`app.voidbinder.de`, as
  registered in Plausible) are inlined by `expo export` and admitted by the CSP's `connect-src`.
  Both unset means the tracker is never loaded (local builds, CI, `deploy:dev`); the app's `deploy:prod`
  sets both, overridable from the shell. See [apps/app/README.md](../apps/app/README.md).
- **GitHub:** no secrets are needed yet. CI does not deploy; a scoped Cloudflare API token is added
  only when CI deploys are introduced.

The repository is public: `.gitignore` excludes `.dev.vars*`, `.env*` (except `.env.example`),
`.wrangler/`, `node_modules`, `dist`, `.turbo` and `.worktrees/`.

## Dependency policy

pnpm 12 (pinned in `packageManager`) refuses to resolve a version published less than 24 hours ago (`minimumReleaseAge`, pnpm's default). The policy stays on. If `pnpm install` reports a lockfile entry inside the cutoff, lower the range's floor to the previous release instead of relaxing the policy. Build scripts run only for the packages listed under `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds <pkg>` adds one).
