# Go-live runbook: production (VB-69)

Max gave the production go on 2026-10-10. This runbook takes Voidbinder from today's state (the
site on `voidbinder.de`, nothing else in prod) to the web app on `app.voidbinder.de` with a full
catalog, prices and images. Run the steps in order. Each step has the command, the result to
expect, how to check it and how to undo it. Environments, secrets and bindings are described in
[environments.md](../environments.md), the database server in [database-vps.md](database-vps.md),
the API in [apps/api/README.md](../../apps/api/README.md).

Audit date: 2026-10-10, against `main` at `50a9343`. Everything below was checked read-only
(dry-run deploys, `wrangler secret list`, `wrangler hyperdrive get`, `wrangler email … settings`,
`dig`, `curl`). Nothing was deployed or migrated, and the prod database was not queried.

## State found by the audit

| Item                                | State on 2026-10-10                                                                                                                                                                                                                  |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `voidbinder-api` (prod)             | Exists only as a stub created by `wrangler secret put` (version `619760e7…`, fetch handler only, no route, no cron, no Workflows). Secrets set: `ADMIN_TOKEN`, `BETTER_AUTH_SECRET`, `TURNSTILE_SECRET`, `TWO_FACTOR_ENCRYPTION_KEY` |
| `voidbinder-app` (prod)             | Does not exist (`code 10007`)                                                                                                                                                                                                        |
| `voidbinder-site` (prod)            | Live on `voidbinder.de` and `www`, but an old build: the German page still says "Server in Deutschland" and "Betrieben in Deutschland" (removed on `main` by VB-61, and `i18n.test.ts` forbids them)                                 |
| Secrets `voidbinder-site` (prod)    | `TURNSTILE_SECRET`, `UNSUBSCRIBE_SECRET`: complete                                                                                                                                                                                   |
| Dry-run `--env prod`                | api, app and site all bundle; bindings as in the config (below)                                                                                                                                                                      |
| Hyperdrive `voidbinder-prod`        | `2f4e2569…`, database `voidbinder`, user `hyperdrive_prod`, VPC service `01a12102…`, caching disabled, 10 connections                                                                                                                |
| Hyperdrive `voidbinder-prod-cached` | `095f0ec4…`, same origin, caching 300 s + swr 60 s, 10 connections                                                                                                                                                                   |
| Prod Workflows                      | None yet; `wrangler deploy --env prod` creates the four `voidbinder-*-import` Workflows                                                                                                                                              |
| DNS `api.` / `app.voidbinder.de`    | No record of any type, so the custom domains can be created by `wrangler deploy` without a conflict                                                                                                                                  |
| DNS `img.voidbinder.de`             | Live (R2 custom domain, WAF block and cache rule from VB-73)                                                                                                                                                                         |
| DNS `plausible.voidbinder.de`       | No record (VB-74 needs it)                                                                                                                                                                                                           |
| Email Sending `voidbinder.de`       | Enabled, DKIM `cf-bounce._domainkey`, return path `cf-bounce.voidbinder.de` (SPF + MX present), DMARC `p=reject`. The `send_email` sender `hello@voidbinder.de` is allowed                                                           |
| Email Routing `voidbinder.de`       | **Disabled, no MX on the apex**: mail to `hello@voidbinder.de` bounces (see gap B2)                                                                                                                                                  |
| VPS timers                          | `image-mirror` and `catalog-modules` run `DBS=dev` only. Disks: `/` 15 %, `/var/lib/postgresql` 18 % (39 GB free)                                                                                                                    |
| VPS `~/.config/voidbinder/pg.env`   | Has `PG_MIGRATE_URL_{DEV,PROD}` and `PG_MIRROR_URL_{DEV,PROD}` (names only were read)                                                                                                                                                |

Bindings of the prod API (dry run): `HYPERDRIVE`, `HYPERDRIVE_CACHED` (ids above), R2 `CATALOG`
(`voidbinder-catalog`, eu) and `RAW` (`voidbinder-raw`, eu), the Workflows `SCRYFALL_IMPORT`,
`YGOPRODECK_IMPORT`, `TCGDEX_IMPORT`, `TCGCSV_IMPORT`, `EMAIL` (sender `hello@voidbinder.de`),
`cache: { enabled: true }`, crons `0 3`, `30 3`, `0 4`, `30 20`, `30 22` (UTC), vars `APP_URL`
`https://app.voidbinder.de`, `API_URL` `https://api.voidbinder.de`, `IMPORT_ENV` `prod`,
`TURNSTILE_SITE_KEY` the real key, `TURNSTILE_NATIVE_BYPASS` `"false"`. Wrangler warns that
`CORS_EXTRA_ORIGINS` is not in `env.prod.vars`; that is intended (`app.test.ts` forbids it in prod,
and `appDeps` reads an unset value as no extra origin).

The app reaches the API as `/api/*` on its own origin through the `API` service binding, so the
session cookie is a host-only `__Secure-` cookie on `app.voidbinder.de`. Better Auth's trusted
origins and CORS in prod are exactly `https://app.voidbinder.de`. Turnstile's widget already lists
`app.voidbinder.de`, and `deploy:prod` of the app bakes the real sitekey.

## Gaps

### Blocking (fix before the app URL is shared)

- **B1. Privacy policy (VB-62) not on `main`.** The site's `datenschutz.md` / `privacy.md` still
  describe only the waitlist and the Cloudflare beacon. Accounts, sessions, two-factor data,
  Turnstile on sign-up and Plausible need to be in the policy before the site and the app go live
  together (step 11). No PR is open for it yet.
- **B2. `hello@voidbinder.de` cannot receive mail.** The 2FA screen tells users who lost both
  factors to write there (`SUPPORT_EMAIL` in `TwoFactorSettings.tsx`), and replies to the auth and
  waitlist mails go there too. The zone has no MX and Email Routing is off. Max decides: either
  Cloudflare Email Routing (dashboard → voidbinder.de → Email → Email Routing → enable, rule
  `hello@` → his inbox, confirm the destination address from the mail Cloudflare sends) or Proton
  (a `protonmail-verification` TXT is already on the zone; add Proton's MX, SPF and DKIM records).
  Use one or the other, not both, because both need the apex MX.
- **B3. The prod `ADMIN_TOKEN` value is not stored where the orchestrator can read it.** The
  secret is set on the stub, but `~/.config/voidbinder/api-secrets.env` on the VPS and the session
  scratchpad hold only the test user. Without the token the first imports cannot be started by
  hand, and the crons would only start them at 03:00 UTC. If no copy turns up, rotate it in step 2.
  That is safe because nothing uses the prod token yet.
- **B4. The prod database state was not read.** The audit was not allowed to query prod. Step 3
  starts with the read-only checks that settle it: whether the API journal
  `drizzle.__drizzle_migrations_api` exists (expected: no, prod has had only the site's waitlist
  migration so far), whether `timescaledb` is installed in `voidbinder`, and whether
  `hyperdrive_prod` and `voidbinder_mirror` can connect.
- **B5. The mirror role has no grants on the prod catalog tables yet.** The grants in runbook
  sections 11 and 12 were run for both databases, but the prod tables did not exist then (the API
  migrations never ran on prod), so the prod part either failed or was skipped. They must be
  re-run after the migration (step 4), or the image mirror and the module builder fail on prod.

### Nice to have (go live without them, track as follow-ups)

- **N1. Plausible (VB-74).** PRs #64 (site) and #65 (app) render the tracker only when
  `PLAUSIBLE_HOST` / `EXPO_PUBLIC_PLAUSIBLE_*` are set at build. The VPS part has no PR yet, and
  `plausible.voidbinder.de` has no DNS record (the zone token on the VPS is invalid, VB-73, so Max
  creates the record or a new token). If the site and the app ship before Plausible runs, the
  script request fails quietly and nothing is counted. In Plausible CE, add the two sites
  `voidbinder.de` and `app.voidbinder.de`.
- **N2. Uptime monitoring.** Workers Logs are on (`observability.enabled`), but nothing alerts
  when prod is down. Minimal setup: three Uptime Kuma HTTP monitors (Kuma already runs for the
  database push monitor, runbook section 8) on `https://api.voidbinder.de/health` (expects 200 and
  `"status":"ok"`; 503 `degraded` means the database is unreachable), `https://app.voidbinder.de/`
  and `https://voidbinder.de/de/`, every 60 s, with an e-mail notification. In the Cloudflare
  dashboard → Notifications, also add "Workers: weekly summary" and "Hyperdrive" alerts if
  offered on the plan. Import failures show only as `import_runs.status = 'failed'` and in the
  logs: a daily query or a Kuma push from the VPS is a follow-up.
- **N3. The stale catalog-modules unit on the VPS.** systemd still runs the version it loaded
  earlier (`GAMES=yugioh`). The file in the clone already lists `yugioh pokemon mtg`, but nobody
  ran `daemon-reload`. Step 10's `systemctl --user edit` reloads it as a side effect, and after
  that dev gets Magic and Pokémon modules too.
- **N4. The first prod import re-downloads up to 4,500 images.** Each import Workflow's mirror
  step (Magic and Pokémon 2,000, Yu-Gi-Oh! 500) runs without `--verify` and downloads images that
  dev already put into the shared R2 keys. The result is the same object, so nothing breaks; it
  costs a few minutes of source traffic.
- **N5. Fan Content notice placement.** The Wizards notice (verbatim, English in both locales) is
  in the app footer (`Shell.tsx`, `NOTICES` from `@voidbinder/shared/notices`), which shows on
  wide screens on every page and on phones only on the profile and the sign-in page. The site has
  no card images and only a generic trademark line (`en.ts` line 270), so it shows no Wizards
  notice. That matches the policy's trigger (use of Wizards IP), but if Max wants it on the site
  as well, it is one line in the site footer. The catalog is public without an account, which the
  Fan Content Policy and Scryfall's no-paywall rule require.
- **N6. Price history backfill (VB-63).** The TCGCSV archive is back; the backfill runs on dev
  first and on prod after the first prod TCGCSV import (step 9). It is not part of the go-live.
- **N7. Secrets in the password manager.** Max should confirm that the prod
  `TWO_FACTOR_ENCRYPTION_KEY` and `BETTER_AUTH_SECRET` are in his password manager. Cloudflare
  cannot return them, and a lost 2FA key means every enrolled user loses their second factor on
  the next rotation.

## Before you start

- Wait until these have been merged into `main`: the VB-62 privacy policy (B1), #64 (site: web app
  link, Plausible, removes the Cloudflare beacon) and #65 (app: Plausible, sign-out under the
  avatar). #61 (VB-32 sync, migration `0008_sync.sql`) is optional for the go-live. If it is
  merged first, step 3 applies `0008` as well.
- Max has done B2 (mail to `hello@`) and, if Plausible is to count from day one, N1's DNS record.
- Run at a time that does not overlap the dev crons (04:30 to 05:30 UTC) or the VPS timers (05:30,
  06:30 UTC). During the day is fine.
- Run everything from a clean checkout of `main` on the workstation, logged in with
  `wrangler login` (ADR 0002). `CLOUDFLARE_ACCOUNT_ID=152a1fcd0eebb96d1bc30d14b5a6af58` is needed
  for `wrangler r2`, `hyperdrive`, `workflows` and `email`, because the login has two accounts.

## Steps

### 1. Preflight (read-only, 10 min)

```sh
cd ~/Documents/Git/Voidbinder && git checkout main && git pull --ff-only && git status --short
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
pnpm turbo run build --filter=@voidbinder/shared --filter=@voidbinder/core --filter=@voidbinder/tokens
export CLOUDFLARE_ACCOUNT_ID=152a1fcd0eebb96d1bc30d14b5a6af58
(cd apps/api && pnpm exec wrangler deploy --dry-run --env prod --outdir /tmp/vb-api-dry)
(cd apps/api && pnpm exec wrangler secret list --env prod)
(cd apps/site && pnpm exec wrangler secret list --env prod)
for h in api app; do dig +short $h.voidbinder.de A; dig +short $h.voidbinder.de CNAME; done
```

**Expect:** a clean tree, all four checks green, the dry run lists the bindings above, four API
secrets and two site secrets, and no DNS answer for `api.` / `app.`.
**If not:** stop. A DNS record on `api.` or `app.` must be deleted in the dashboard first,
otherwise the custom domain cannot be created.

### 2. Admin token for prod (B3, 2 min, only if no copy exists)

```sh
umask 077; mkdir -p ~/.config/voidbinder
openssl rand -base64 32 | tr -d '\n' > ~/.config/voidbinder/admin-token-prod
(cd apps/api && pnpm exec wrangler secret put ADMIN_TOKEN --env prod < ~/.config/voidbinder/admin-token-prod)
```

**Verify:** `wrangler secret list --env prod` still shows four names; store the value in the
password manager (`Voidbinder ADMIN_TOKEN prod`).
**Rollback:** not needed; nothing reads the prod token before step 7.

### 3. Prod database: check, then migrate the API (10 min)

On the VPS (`ssh voidbinder-db`), read-only first (B4):

```sh
docker exec -i -e PGOPTIONS='-c default_transaction_read_only=on' voidbinder-db \
  psql -U postgres -d voidbinder -XAt <<'EOF'
select to_regclass('drizzle.__drizzle_migrations_api') as api_journal,
       to_regclass('drizzle.__drizzle_migrations') as site_journal;
select count(*) from drizzle.__drizzle_migrations;
select extname, extversion from pg_extension order by 1;
select rolname, has_database_privilege(rolname, 'voidbinder', 'CONNECT')
  from pg_roles where rolname in ('hyperdrive_prod', 'voidbinder_migrate', 'voidbinder_mirror');
EOF
```

**Expect:** `api_journal` empty (no API migrations yet), `site_journal` set and 1 site migration,
`timescaledb` and `pg_stat_statements` installed, all three roles `t`. If `timescaledb` is
missing, run the extension block of runbook section 5 for `voidbinder` first, because
`0004_prices.sql` only makes `prices_daily` a hypertable when the extension exists.

Take a backup point, then migrate (the script pulls `main` on the VPS):

```sh
docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=incr backup
~/voidbinder/scripts/vps/migrate.sh site prod   # expect: no-op, "migrations applied successfully!"
~/voidbinder/scripts/vps/migrate.sh api prod    # applies 0000 … 0007 (0008 if #61 is merged)
~/voidbinder/scripts/vps/migrate.sh api prod    # second run: no-op
```

**Verify:**

```sh
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "select count(*) from drizzle.__drizzle_migrations_api"            # 8 (9 with #61)
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "select hypertable_name, compression_enabled from timescaledb_information.hypertables"  # prices_daily|t
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "select proc_name from timescaledb_information.jobs where hypertable_name = 'prices_daily'"  # one row: the columnstore policy
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "set role hyperdrive_prod; select count(*) from games"             # a number, no permission error
```

**Rollback:** the migrations are additive and nothing reads them yet. To undo them, restore the
backup point taken above (runbook section 7); otherwise leave them in place.

### 4. Mirror role grants on prod (B5, 2 min)

On the VPS, after step 3:

```sh
docker exec -i voidbinder-db psql -U postgres -d voidbinder -v ON_ERROR_STOP=1 <<'EOF'
SET ROLE voidbinder_migrate;
GRANT USAGE ON SCHEMA public TO voidbinder_mirror;
GRANT SELECT ON sets, prints, print_localizations TO voidbinder_mirror;
GRANT UPDATE (image_key) ON prints, print_localizations TO voidbinder_mirror;
GRANT SELECT, INSERT, UPDATE ON import_runs TO voidbinder_mirror;
GRANT SELECT ON cards, set_localizations, prices_current, app_meta TO voidbinder_mirror;
EOF
```

**Verify:** each `GRANT` prints `GRANT`; GRANTs are idempotent, so a second run is harmless.

### 5. Deploy the API (5 min)

```sh
cd ~/Documents/Git/Voidbinder
pnpm --filter api deploy:prod
curl -s https://api.voidbinder.de/health
```

**Expect:** wrangler prints the custom domain `api.voidbinder.de`, five cron schedules and the
four Workflows. `/health` answers `{"status":"ok","db":"ok","version":"<short sha of main>"}`
(the certificate can take a minute or two after the first deploy).
**Verify also:**

```sh
CLOUDFLARE_ACCOUNT_ID=152a1fcd0eebb96d1bc30d14b5a6af58 pnpm --filter api exec wrangler workflows list | grep -v dev
curl -s https://api.voidbinder.de/catalog/games                    # 200, the games (seeded by 0001)
curl -s -o /dev/null -w '%{http_code}\n' https://api.voidbinder.de/admin/import/scryfall -X POST   # 401 without the token
```

**Rollback:** `cd apps/api && pnpm exec wrangler rollback --env prod -m "go-live rollback"` (picks
the previous version, the secret-only stub) or `wrangler deployments list --env prod` and
`wrangler rollback <version-id> --env prod`. The stub keeps the custom domain but answers
nothing useful; to take the hostname away entirely, remove `api.voidbinder.de` under Workers →
voidbinder-api → Settings → Domains. The crons go with the rolled-back version.

### 6. Deploy the web app (5 min)

```sh
EXPO_PUBLIC_PLAUSIBLE_HOST=https://plausible.voidbinder.de EXPO_PUBLIC_PLAUSIBLE_DOMAIN=app.voidbinder.de \
  pnpm --filter app deploy:prod
curl -s https://app.voidbinder.de/api/health
curl -sI https://app.voidbinder.de/ | grep -i -E '^HTTP|content-security-policy'
```

Check the variable names against `apps/app/README.md` once #65 is merged. If its `deploy:prod`
already sets them, run the plain `pnpm --filter app deploy:prod`. Leave them out while Plausible
is not running (N1).

**Expect:** `/api/health` gives the same JSON as step 5 (the proxy works), `/` answers 200 with the
CSP. In a browser: the home page lists the games, the sign-up page shows the Turnstile widget.
**Rollback:** first deploy, so there is no earlier version: remove the domain `app.voidbinder.de`
in the dashboard (Workers → voidbinder-app → Settings → Domains) or `wrangler delete --env prod`
from `apps/app`. Later: `wrangler rollback --env prod`.

### 7. Catalog imports (about 90 min, mostly waiting)

The three catalog imports may run side by side (dev did: Scryfall and TCGdex overlapped without
problems). Start them from the workstation:

```sh
TOKEN=$(cat ~/.config/voidbinder/admin-token-prod)
for src in scryfall ygoprodeck 'tcgdex?mode=full'; do
  curl -sS -X POST -H "Authorization: Bearer $TOKEN" "https://api.voidbinder.de/admin/import/$src"; echo
done
unset TOKEN
```

**Expect:** three `202` answers with the instance id. `409 import_running` means one is already
running; `404` means `ADMIN_TOKEN` is not set (step 2).

Durations measured on dev (`import_runs`, 2026-10-09/10), each plus the 7-minute wait before
the cache purge (VB-71):

| Import                | Dev duration                | Result on dev                         |
| --------------------- | --------------------------- | ------------------------------------- |
| Scryfall catalog      | 8 to 10 min                 | 778 sets, 103,435 prints              |
| Scryfall prices       | about 6 min (same Workflow) | Cardmarket EUR, TCGplayer USD (Magic) |
| YGOPRODeck            | 1.5 to 3.5 min              | 662 sets, 44,266 prints               |
| TCGdex `full`         | 79 min                      | 205 sets, 21,290 prints               |
| Workflow image deltas | seconds to a minute each    | up to 2,000 / 2,000 / 500 images (N4) |

**Verify** (VPS, read-only):

```sh
docker exec voidbinder-db psql -U postgres -d voidbinder -XA -c \
  "select source, kind, status, started_at, finished_at - started_at as took, error
   from import_runs order by started_at desc limit 12"
```

and per Workflow `pnpm --filter api exec wrangler workflows instances list voidbinder-scryfall-import`
(likewise `-ygoprodeck-`, `-tcgdex-`). Done when `scryfall`, `ygoprodeck` and `tcgdex` each have
an `ok` row and `scryfall`/`prices` is `ok`. `https://app.voidbinder.de/mtg` shows sets.
**If a run fails:** the Workflow retries each step three times and the instance resumes where it
stopped. A run marked `failed` is restarted with the same `curl` (no `409` once it is no longer
`running`). Look at the step in the dashboard (Workflows → instance) or in the Workers Logs.
**Rollback:** not needed. The catalog is upserted and idempotent, and an empty or partial catalog
only means fewer cards.

### 8. Image mirror for prod (VPS, 30 to 60 min, in parallel with TCGdex)

The objects are already in R2 from dev (the keys are source ids, shared). `--verify` HEADs them
and downloads nothing it finds, so prod only gets its `image_key` columns filled. Start it
**after** the Scryfall and YGOPRODeck Workflows have finished their mirror step (a running import
mirror holds the lock, and the second one stops with "another image mirror is running"). Pokémon
goes last, after TCGdex.

```sh
ssh voidbinder-db
tmux new -s mirror-prod
cd ~/voidbinder && git pull --ff-only && pnpm install --filter api
ENV="--env-file $HOME/.config/voidbinder/r2.env --env-file $HOME/.config/voidbinder/pg.env"
pnpm --filter api mirror-images $ENV --db prod --game mtg --limit 200 --verify --sm --dry-run
pnpm --filter api mirror-images $ENV --db prod --game mtg --verify --sm 2>&1 | tee ~/mirror-prod-$(date +%F).log
pnpm --filter api mirror-images $ENV --db prod --game yugioh --verify --sm 2>&1 | tee -a ~/mirror-prod-$(date +%F).log
# after TCGdex finished:
pnpm --filter api mirror-images $ENV --db prod --game pokemon --verify --sm 2>&1 | tee -a ~/mirror-prod-$(date +%F).log
```

Never run a dev mirror at the same time (runbook section 11: the source rate limits count per IP).

**Expect:** the summary line shows mostly `reused`, few `uploaded`. On dev the full download took
2 h 15 min (Magic), 17 min (Yu-Gi-Oh!) and 73 min (Pokémon); with `--verify` the run is bound by
the HEAD requests instead (about 170,000 rows; raise `--concurrency` to 16 if it is slow).
**Verify:**

```sh
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "select count(*) filter (where image_key like '%/sm.webp'), count(*) from prints"
```

The two numbers are close (Magic prints without a high-res scan stay without a key). On a card page
of the app, the image comes from `img.voidbinder.de`.

Then switch the nightly timer to both databases:

```sh
systemctl --user edit image-mirror.service    # add: [Service] / Environment=DBS=prod dev
systemctl --user show image-mirror.service -p Environment   # DBS=prod dev
```

**Rollback:** `systemctl --user revert image-mirror.service`. The keys stay; they point at
objects that exist.

### 9. First TCGCSV price import (25 min)

TCGCSV prices match products to the catalog, so they run after step 7. The prod cron runs at
20:30 UTC (and 22:30 to catch a late build). Start the first run by hand, so prices are there
today. The cron then reads `last-updated.txt`, sees the same build and ends after one request.
TCGCSV asks for one pull a day: do not also run a manual dev pull on the same day.

```sh
TOKEN=$(cat ~/.config/voidbinder/admin-token-prod)
curl -sS -X POST -H "Authorization: Bearer $TOKEN" https://api.voidbinder.de/admin/import/tcgcsv; echo
unset TOKEN
```

**Expect:** `202`; on dev the run took 18 min, plus the 7-minute purge wait.
**Verify:** `import_runs` has `tcgcsv`/`prices` `ok`, and
`select source, count(*) from prices_current group by 1` shows `tcgplayer`, `cardmarket` and
`tcgplayer_scryfall` (dev: 498,747 rows in total). A card page in the app shows a price with its
source and date.
**Rollback:** not needed (prices are written per day and idempotent).

### 10. Offline catalog modules for prod (VPS, 15 min)

```sh
systemctl --user edit catalog-modules.service   # add: [Service] / Environment=DBS=prod dev
systemctl --user show catalog-modules.service -p Environment   # DBS=prod dev GAMES=yugioh pokemon mtg
systemctl --user start catalog-modules           # one run by hand now
journalctl --user -u catalog-modules -n 30
curl -s https://img.voidbinder.de/modules/prod/yugioh/manifest.json
curl -s https://api.voidbinder.de/catalog/modules
```

**Expect:** `catalog module built` for each game, the manifest has the current `catalog_version`,
and `/catalog/modules` answers the same manifests (after the 10-minute edge cache, VB-71).
**Rollback:** `systemctl --user revert catalog-modules.service`; the `modules/prod/` objects are
harmless (nothing reads them until the native app ships).

### 11. Deploy the site (5 min, needs B1 and #64 on `main`)

```sh
pnpm --filter site deploy:prod
curl -sL https://voidbinder.de/de/ | grep -c -i 'in deutschland'     # 0
curl -sL https://voidbinder.de/de/ | grep -o 'https://app.voidbinder.de[^"]*' | head -2
curl -sL https://voidbinder.de/de/datenschutz/ | grep -c -i 'plausible'   # > 0 once VB-62 is in
```

Do not set `PUBLIC_CF_ANALYTICS_TOKEN` (Max chose Plausible over Cloudflare Web Analytics; #64
removes the variable).

**Expect:** the German page no longer claims servers in Germany, the hero links to the web app,
the privacy policy covers app accounts and Plausible, the Plausible script loads (once N1 is
done). The waitlist form still works: sign up with a test address, the confirmation mail arrives
from `hello@voidbinder.de`.
**Rollback:** `cd apps/site && pnpm exec wrangler rollback --env prod` returns to the current live
build (the one with the Germany claims). Prefer a fix-forward deploy.

### 12. End-to-end smoke test (15 min)

On `https://app.voidbinder.de`, with a real address that is not the dev test account:

1. Sign up (Turnstile passes); the verification mail arrives within a minute, sender
   `hello@voidbinder.de`, link to `https://app.voidbinder.de/verify?token=…`.
2. Verify, sign in, open the profile; set language and currency.
3. Turn on two-factor, sign out, sign in with the TOTP code; the backup codes download.
4. Search a card, open it (image from `img.voidbinder.de`, price, Fan Content notice in the footer
   on a wide window), add it to the collection, create a deck.
5. Sign out from the avatar menu (#65); request a password reset; the mail arrives.
6. Delete the test account (profile → delete), or keep it as the prod smoke account.

**If the mail does not arrive:** check the Worker logs for `auth mail "verify" failed`; the
`send_email` binding only delivers from `hello@voidbinder.de` on the onboarded domain
(Email Sending is enabled for `voidbinder.de`).

### 13. Monitoring (Max, 10 min, N2)

Add the three Kuma HTTP monitors and the Cloudflare notifications from N2. Not required for the
go, but before the URL is shared widely.

### 14. After the go-live

- VB-63: price history backfill on prod, after step 9.
- The prod crons from now on, daily (UTC): Scryfall 03:00, YGOPRODeck 03:30, TCGdex 04:00
  (incremental), TCGCSV 20:30 and 22:30. VPS: image mirror 05:30 and catalog modules 06:30 (both
  `prod dev`).
- Disk: the prod catalog roughly doubles the database size (dev today is most of the 8.2 GB on
  `/var/lib/postgresql`, 39 GB free), and the price history grows by about 0.5 million rows a day
  before compression. Check `df` and the Kuma push monitor after the first week.

## Rollback overview

| Part         | How                                                                                                                                       |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------------------- |
| API Worker   | `wrangler rollback [version-id] --env prod` from `apps/api` (the last 100 versions; bindings must still exist); or remove the domain      |
| App Worker   | First deploy: remove `app.voidbinder.de` or `wrangler delete --env prod`; later `wrangler rollback --env prod`                            |
| Site Worker  | `wrangler rollback --env prod` from `apps/site`                                                                                           |
| Database     | Migrations are additive only; restore the pgBackRest backup point of step 3 for a full undo (runbook section 7)                           |
| Catalog data | Upserts, idempotent; re-run an import to repair, never delete                                                                             |
| VPS timers   | `systemctl --user revert image-mirror.service catalog-modules.service`                                                                    |
| Secrets      | A rollback keeps today's secrets; `ADMIN_TOKEN` can be rotated any time, never rotate `BETTER_AUTH_SECRET` or `TWO_FACTOR_ENCRYPTION_KEY` |

## Time

About 3 hours from step 1 to step 12, mostly waiting on the TCGdex full import (about 90 min with
the purge wait), which runs in parallel with the Magic and Yu-Gi-Oh! image mirror. Hands-on
time is about 1 hour. Not counted: Max's dashboard work (B2, N1, N2) and the VB-62 review.
