# Go-live runbook: production (VB-69)

Max gave the production go on 2026-10-10. This runbook takes Voidbinder from today's state (the
site on `voidbinder.de`, nothing else in prod) to the web app on `app.voidbinder.de` with a full
catalog, prices and images. Run the steps in order. Each step has the command, the result to
expect, how to check it and how to undo it. Environments, secrets and bindings are described in
[environments.md](../environments.md), the database server in [database-vps.md](database-vps.md),
the API in [apps/api/README.md](../../apps/api/README.md).

Audit date: 2026-10-10, against `main` at `50a9343`; the runbook is updated to `750d6ac`
(adds #61, migration `0008_sync.sql`). Everything below was checked read-only
(dry-run deploys, `wrangler secret list`, `wrangler hyperdrive get`, `wrangler email … settings`,
`dig`, `curl`). Nothing was deployed or migrated, and the prod database was not queried (the state at audit
time, before the go-live; see the next section).

## What happened on 2026-10-10

The go-live ran the same day. It worked, but eight things were different from this runbook as
first written, and the runbook below now says what to do instead. Facts in this section were
checked on the day; the backup finding was read from the VPS afterwards (read-only).

1. **The site went out before the images were in place.** `voidbinder.de` was deployed and the
   app URL became visible before the image mirror had filled the prod `image_key` columns. The
   app showed every card as "fehlt": the CSP allows only `img.voidbinder.de`, and the API's
   source-URL fallback is blocked by it on purpose. Fix: step 8 (image keys) now gates step 11
   (site) and sharing the app URL, with a count query (step 8) that must pass first.
2. **Pokémon was copied, not imported.** The TCGdex full import (80 min) was stopped and the
   Pokémon catalog was copied from `voidbinder_dev` into `voidbinder` with Max's go, using the
   one-off script `~/copy-pokemon-dev-to-prod.sh` on the VPS (column names had to be qualified in
   the joins and the ids cast to `uuid` for the key update). VB-76 turns it into
   `scripts/vps/copy-catalog.sh`. A copy is now the default path for a database that has no
   catalog while the other one does (step 7). A copy does not bump `app_meta.catalog_version` and
   does not purge the edge cache, so an incremental import has to follow.
3. **Image keys.** The VPS mirror, run as `--verify --sm --concurrency 16`, did about 180 rows/s:
   Magic's 105k rows took about 10 minutes, Yu-Gi-Oh! likewise. A Workflow instance that shows
   `Waiting` after its catalog steps is the 7-minute purge sleep (VB-71), not a stuck run.
4. **There are no backups.** `docker exec voidbinder-db pgbackrest … backup` failed with
   `unable to open missing file /etc/pgbackrest/pgbackrest.conf`. Reading the VPS showed why:
   [database-vps.md section 7](database-vps.md#7-backups-with-pgbackrest-to-backblaze-b2) was
   never carried out. `/opt/voidbinder-db/pgbackrest/` is empty (it is mounted at
   `/etc/pgbackrest` and has no config), `ubuntu` has no crontab, `/var/log/voidbinder-db-backup.log`
   does not exist, root has no crontab, `/etc/cron.d` has no backup job, and the only timers are the
   two Voidbinder user timers and the stock system ones. **No backup of any kind has ever run, and
   nothing is archived.** It is worse than missing backups: `archive_mode=on` with
   `archive_command = pgbackrest … archive-push` is active, so every archive attempt fails.
   At 09:04 UTC, `pg_stat_archiver` showed 0 archived, 4,662 failed, no `last_archived_wal`,
   and `pg_wal` held 11 GB (645 segments waiting). PostgreSQL keeps every segment it could not
   archive, so `/var/lib/postgresql` (35 GB free of 49 GB) fills up as the catalog imports and
   the price writes continue, and PostgreSQL stops when it is full. See B6.
5. **systemd `Environment` needs quotes.** `Environment=DBS=prod dev` loses the second word.
   Write `Environment="DBS=prod dev"`. The loaded `catalog-modules` unit still had
   `GAMES=yugioh`, so it needed an override with all three games. The overrides now live in
   `~/.config/systemd/user/{image-mirror,catalog-modules}.service.d/override.conf`. The unit in
   the repo (`scripts/vps/catalog-modules.service`) already lists `yugioh pokemon mtg`; it was
   not changed.
6. **The workstation's resolver cached the NXDOMAIN** for `api.voidbinder.de` after the custom
   domain was created. `curl --resolve` or `dig @1.1.1.1` shows the real state (step 5).
7. **Step 7's curl form works:** `-o /dev/stdout -w ' %{http_code}'` printed
   `{"status":"started"} 202` (body first, then the status).
8. **Prod figures on the day:** 9 API migrations; Magic 103,435 prints, 99,799 with an image key;
   Pokémon 21,290 / 19,663; Yu-Gi-Oh! 44,266 / 44,266; catalog modules at version 3 for every
   game; the Scryfall Workflow completed (prices ok); the first TCGCSV run and a TCGdex
   incremental run started at about 09:0x UTC.

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
| Plausible (VB-74)                   | No instance on the VPS and no DNS record; the live instance is `web-analytics.voidcom.app` (N1)                                                                                                                                      |
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

- **B6. No backups, and the WAL archive fails (found 2026-10-10, after the go-live).** Do
  [database-vps.md section 7](database-vps.md#7-backups-with-pgbackrest-to-backblaze-b2) now: the
  B2 bucket and key, `pgbackrest.conf`, `stanza-create`, `check`, the first full backup and the
  crontab. Until then every archive attempt fails and `pg_wal` grows (11 GB at 09:04 UTC on
  2026-10-10, 645 segments). Watch it with
  `docker exec voidbinder-db sh -c 'du -sh /home/postgres/pgdata/data/pg_wal'` and
  `df -h /var/lib/postgresql`. This is the first thing to fix, ahead of everything else on this
  list. The audit assumed section 7 was done; the runbook now has a gate for it in step 3.
  Tracked as VB-78.
- **B1. Privacy policy (VB-62) not on `main`.** The site's `datenschutz.md` / `privacy.md` still
  describe only the waitlist and the Cloudflare beacon. Accounts, sessions, two-factor data,
  Turnstile on sign-up and Plausible need to be in the policy before the site and the app go live
  together (step 11). PR #69 is open and waiting for review and merge.
- **B2. `hello@voidbinder.de` cannot receive mail.** The 2FA screen tells users who lost both
  factors to write there (`SUPPORT_EMAIL` in `TwoFactorSettings.tsx`), and replies to the auth and
  waitlist mails go there too. The zone has no MX and Email Routing is off. Max decides: either
  Cloudflare Email Routing (dashboard → voidbinder.de → Email → Email Routing → enable, rule
  `hello@` → his inbox, confirm the destination address from the mail Cloudflare sends) or Proton
  (a `protonmail-verification` TXT is already on the zone; add Proton's MX, SPF and DKIM records).
  Use one or the other, not both, because both need the apex MX.
- **B4. The prod database state was not read.** The audit was not allowed to query prod; the
  orchestrator runs these queries himself as the first action of step 3. They settle: whether the API journal
  `drizzle.__drizzle_migrations_api` exists (expected: no, prod has had only the site's waitlist
  migration so far), whether `timescaledb` is installed in `voidbinder`, and whether
  `hyperdrive_prod` and `voidbinder_mirror` can connect.
- **B5. The mirror role has no grants on the prod catalog tables yet.** The grants in runbook
  sections 11 and 12 were run for both databases, but the prod tables did not exist then (the API
  migrations never ran on prod), so the prod part either failed or was skipped. They must be
  re-run after the migration (step 4), or the image mirror and the module builder fail on prod.

### Nice to have (go live without them, track as follow-ups)

- **N1. Plausible (VB-74).** The live instance is Max's existing `https://web-analytics.voidcom.app`
  (no instance on the VPS, no DNS record needed). PRs #64 (site, variable `PLAUSIBLE_HOST` from
  `env.prod.vars`) and #65 (app, `EXPO_PUBLIC_PLAUSIBLE_HOST` with that default in `deploy:prod`)
  point at it. Max registers `voidbinder.de` and `app.voidbinder.de` as sites in that instance.
  Until he does, the tracker is still built in and its request fails without any effect.
- **N2. Uptime monitoring.** Workers Logs are on (`observability.enabled`), but nothing alerts
  when prod is down. Minimal setup: three Uptime Kuma HTTP monitors (Kuma already runs for the
  database push monitor, runbook section 8) on `https://api.voidbinder.de/health` (expects 200 and
  `"status":"ok"`; 503 `degraded` means the database is unreachable), `https://app.voidbinder.de/`
  and `https://voidbinder.de/de/`, every 60 s, with an e-mail notification. In the Cloudflare
  dashboard → Notifications, also add "Workers: weekly summary" and "Hyperdrive" alerts if
  offered on the plan. Import failures show only as `import_runs.status = 'failed'` and in the
  logs: a daily query or a Kuma push from the VPS is a follow-up.
- **N3. (Closed 2026-10-10) The stale catalog-modules unit on the VPS.** The loaded unit still
  had `GAMES=yugioh`; the file in the clone already lists `yugioh pokemon mtg`. An override with
  all three games now sits in `~/.config/systemd/user/catalog-modules.service.d/override.conf`
  (see step 10 for how to write one).
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

- Wait until these have been merged into `main`: the VB-62 privacy policy (B1, PR #69) and #64
  (site: web app link, Plausible, removes the Cloudflare beacon). #65 (app: Plausible, sign-out
  under the avatar) is on `main` (f7e3d1d), and so is #61 (VB-32 sync, migration `0008_sync.sql`,
  750d6ac), so step 3 always applies `0008`.
- Max has done B2 (mail to `hello@`) and, if Plausible is to count from day one, N1 (the two sites
  registered in `web-analytics.voidcom.app`).
- Run at a time that does not overlap the dev crons (04:30 to 05:30 UTC) or the VPS timers (05:30,
  06:30 UTC). During the day is fine.
- Run everything from a clean checkout of `main` on the workstation, logged in with
  `wrangler login` (ADR 0002). `CLOUDFLARE_ACCOUNT_ID=152a1fcd0eebb96d1bc30d14b5a6af58` is needed
  for `wrangler r2`, `hyperdrive`, `workflows` and `email`, because the login has two accounts.

## Order rule

Nothing points users at the app until the image keys are in. That means step 8's count check must
pass **before** step 11 (the site, which links to the app) and before the app URL is shared with
anyone. Steps 5 to 7 only create the URL and fill the catalog; opening the app in a browser to see
cards waits until step 8. On 2026-10-10 this order was broken and every card showed as "fehlt".

## Steps

### 1. Preflight (read-only, 10 min)

```sh
cd ~/Documents/Git/Voidbinder && git checkout main && git pull --ff-only && git status --short
pnpm install --frozen-lockfile
pnpm lint && pnpm typecheck && pnpm test && pnpm build
export CLOUDFLARE_ACCOUNT_ID=152a1fcd0eebb96d1bc30d14b5a6af58
(cd apps/api && pnpm exec wrangler deploy --dry-run --env prod --outdir /tmp/vb-api-dry)
(cd apps/app && pnpm run build && pnpm exec wrangler deploy --dry-run --env prod --outdir /tmp/vb-app-dry)
(cd apps/site && CLOUDFLARE_ENV=prod pnpm exec astro build && pnpm exec wrangler deploy --dry-run --env prod --outdir /tmp/vb-site-dry)
(cd apps/api && pnpm exec wrangler secret list --env prod)
(cd apps/site && pnpm exec wrangler secret list --env prod)
for h in api app; do dig +short $h.voidbinder.de A; dig +short $h.voidbinder.de CNAME; done
```

**Expect:** a clean tree, all four checks green, the three dry runs (api, app, site) bundle and list the bindings above, four API
secrets and two site secrets, and no DNS answer for `api.` / `app.`.
**If not:** stop. A DNS record on `api.` or `app.` must be deleted in the dashboard first,
otherwise the custom domain cannot be created.

### 2. Admin token for prod (nothing to do)

The prod `ADMIN_TOKEN` is already set on the Worker and the orchestrator holds the value (session
scratchpad `api-secrets.env` as `ADMIN_TOKEN_prod`, backup on the VPS in
`~/.config/voidbinder/api-secrets.env`; never write the value into a file in the repo). Steps 7 and
9 read it with `read -rs TOKEN`. Do not rotate it.

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

**Gate: are backups set up?** (B6) The backup command below only works once
[database-vps.md section 7](database-vps.md#7-backups-with-pgbackrest-to-backblaze-b2) is done.
Check first:

```sh
ls /opt/voidbinder-db/pgbackrest/pgbackrest.conf && crontab -l | grep -c pgbackrest   # the file, and 2
docker exec voidbinder-db pgbackrest --stanza=voidbinder info                          # status: ok, one full backup
```

If the file is missing, do section 7 first. If you decide to go on without a backup (the
migrations are additive, so nothing is lost by migrating), write that decision down in the
go-live log and fix B6 the same day. On 2026-10-10 the command failed with
`unable to open missing file /etc/pgbackrest/pgbackrest.conf`.

Take a backup point, then migrate (the script pulls `main` on the VPS):

```sh
docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=incr backup
~/voidbinder/scripts/vps/migrate.sh site prod   # expect: no-op, "migrations applied successfully!"
~/voidbinder/scripts/vps/migrate.sh api prod    # applies 0000 … 0008
~/voidbinder/scripts/vps/migrate.sh api prod    # second run: no-op
```

**Verify:**

```sh
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "select count(*) from drizzle.__drizzle_migrations_api"            # 9
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "select hypertable_name, compression_enabled from timescaledb_information.hypertables"  # prices_daily|t
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "select proc_name from timescaledb_information.jobs where hypertable_name = 'prices_daily'"  # one row: the columnstore policy
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "set role hyperdrive_prod; select count(*) from games"             # a number, no permission error
```

**Rollback:** leave the additive migrations in place; nothing reads them and the prod database has
no API data yet. The pgBackRest restore (runbook section 7, once backups exist, B6) is cluster-wide: it rewinds
`voidbinder_dev` as well and needs the live container stopped, so it means downtime for both
databases. Use it only as a last resort for a corrupted cluster.

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

**Verify:** each `GRANT` prints `GRANT`; GRANTs are idempotent, so a second run is harmless. Then
check that the role can read, with no permission error:

```sh
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "set role voidbinder_mirror; select count(*) from prints; select count(*) from prices_current"
```

**Rollback:** not needed, the role only reads and sets `image_key`. To take the grants away, run the
matching `REVOKE` statements (same tables and columns) as `voidbinder_migrate`.

### 5. Deploy the API (5 min)

```sh
cd ~/Documents/Git/Voidbinder
pnpm --filter api deploy:prod
curl -s https://api.voidbinder.de/health
```

**Expect:** wrangler prints the custom domain `api.voidbinder.de`, five cron schedules and the
four Workflows. `/health` answers `{"status":"ok","db":"ok","version":"<short sha of main>"}`
(the certificate can take a minute or two after the first deploy). If the workstation answers
`Could not resolve host`, its resolver is holding the NXDOMAIN from before the custom domain existed
(it did on 2026-10-10). Ask a public resolver for the address and pin it:
`dig +short @1.1.1.1 api.voidbinder.de A`, then
`curl --resolve api.voidbinder.de:443:<that ip> https://api.voidbinder.de/health`. It clears on its
own after the negative TTL.
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
voidbinder-api → Settings → Domains. Cron triggers are not part of a Worker version: the five
crons keep firing against the stub, which has no scheduled handler. Delete them too: dashboard →
Workers → voidbinder-api → Settings → Triggers → delete each cron trigger (not `wrangler triggers
deploy --env prod`, which reads the crons from the config and re-adds them). **Verify:** Triggers
shows no cron. The next `pnpm --filter api deploy:prod` restores them.

### 6. Deploy the web app (5 min)

```sh
pnpm --filter app deploy:prod
curl -s https://app.voidbinder.de/api/health
curl -sI https://app.voidbinder.de/ | grep -i -E '^HTTP|content-security-policy'
```

`deploy:prod` (#65, on `main`) defaults `EXPO_PUBLIC_PLAUSIBLE_HOST` and the domain to the
Plausible instance, so the tracker is always built in; leaving the variables out or empty does not
turn it off. Until N1 is done its request fails without any effect. The site gets `PLAUSIBLE_HOST`
from `env.prod.vars` (#64), so the same applies there.

**Expect:** `/api/health` gives the same JSON as step 5 (the proxy works), `/` answers 200 with the
CSP. Do not look at card pages yet and do not share the URL: no print has an `image_key` until
step 8, and the CSP blocks the source URLs the API falls back to, so every card shows "fehlt". The
browser check (home page, a card with its image, the sign-up page with the Turnstile widget) moves
to the end of step 8.
**Rollback:** first deploy, so there is no earlier version: remove the domain `app.voidbinder.de`
in the dashboard (Workers → voidbinder-app → Settings → Domains) or `wrangler delete --env prod`
from `apps/app`. Later: `wrangler rollback --env prod`.

### 7. Catalog imports (about 45 min, mostly waiting)

Magic and Yu-Gi-Oh! come from the import Workflows. Pokémon is different: **if the other database
already holds the Pokémon catalog (dev does), copy it instead of importing it.** The TCGdex full
import takes about 80 minutes; the copy takes minutes. Use the full import on a database only to
validate the pipeline. Start the two Workflows from the workstation (they may run side by side):

```sh
read -rs TOKEN   # paste ADMIN_TOKEN_prod
for src in scryfall ygoprodeck; do
  curl -sS -o /dev/stdout -w ' %{http_code}\n' -X POST -H "Authorization: Bearer $TOKEN" "https://api.voidbinder.de/admin/import/$src"
done
unset TOKEN
```

**Expect:** `{"status":"started"} 202` twice (the `-o /dev/stdout -w` form prints the body, then the
status, on one line). `409 import_running` means one is already running; `404` means
`ADMIN_TOKEN` is not set on the Worker.

**Pokémon, the copy (default).** On the VPS, from `voidbinder_dev` into `voidbinder`. The script
that did it on 2026-10-10 is `~/copy-pokemon-dev-to-prod.sh` (not in the repo; VB-76 replaces it
with `scripts/vps/copy-catalog.sh`, use that once it is merged). Two things the first version
had to get right: qualify every column in the joins (`prints`, `sets` and `cards` share names),
and cast the ids to `uuid` when updating the keys. The copy needs Max's go, like any write to
prod. **A copy bypasses the importer**, so afterwards:

- `app_meta.catalog_version` is not bumped and the edge cache is not purged. Run an incremental
  TCGdex import (`POST /admin/import/tcgdex`, no `mode=full`) after it: it bumps the version and
  purges.
- Until that import has finished, the offline catalog modules and the cached API answers still
  show the old Pokémon data.

Durations measured on dev (`import_runs`, 2026-10-09/10), each plus the 7-minute wait before
the cache purge (VB-71):

| Import                | Dev duration                | Result on dev                                               |
| --------------------- | --------------------------- | ----------------------------------------------------------- |
| Scryfall catalog      | 8 to 10 min                 | 778 sets, 103,435 prints                                    |
| Scryfall prices       | about 6 min (same Workflow) | Cardmarket EUR, TCGplayer USD (Magic)                       |
| YGOPRODeck            | 1.5 to 3.5 min              | 662 sets, 44,266 prints                                     |
| TCGdex `full`         | 79 min                      | 205 sets, 21,290 prints (copied to prod instead, see above) |
| Workflow image deltas | seconds to a minute each    | up to 2,000 / 2,000 / 500 images (N4)                       |

**Verify** (VPS, read-only):

```sh
docker exec voidbinder-db psql -U postgres -d voidbinder -XA -c \
  "select source, kind, status, started_at, finished_at - started_at as took, error
   from import_runs order by started_at desc limit 12"
```

and per Workflow `CLOUDFLARE_ACCOUNT_ID=152a1fcd0eebb96d1bc30d14b5a6af58 pnpm --filter api exec wrangler workflows instances list voidbinder-scryfall-import`
(likewise `-ygoprodeck-`, `-tcgdex-`). An instance in `Waiting` after its catalog steps is the
7-minute purge sleep (VB-71), not a problem. Done when `scryfall` and `ygoprodeck` each have an
`ok` row, `scryfall`/`prices` is `ok`, the Pokémon copy is in and a `tcgdex` incremental run has
finished. `https://app.voidbinder.de/mtg` shows sets.
**If a run fails:** the Workflow retries each step three times and the instance resumes where it
stopped. A run marked `failed` is restarted with the same `curl` (no `409` once it is no longer
`running`). Look at the step in the dashboard (Workflows → instance) or in the Workers Logs.
**Rollback:** not needed. The catalog is upserted and idempotent, and an empty or partial catalog
only means fewer cards.

### 8. Image mirror for prod (VPS, about 30 min, gates the site and the app URL)

The objects are already in R2 from dev (the keys are source ids, shared). `--verify` HEADs them
and downloads nothing it finds, so prod only gets its `image_key` columns filled. **Do this before
step 11 and before the URL is shared** (order rule above). Start it
**after** the Scryfall and YGOPRODeck Workflows have finished their mirror step (a running import
mirror holds the lock, and the second one stops with "another image mirror is running"). Pokémon
goes last, after TCGdex.

Check first that the mirror step of both Workflows is done: the instance status must be
`complete`. A `Waiting` instance is still in the 7-minute purge sleep (VB-71) and its mirror step
comes next, so wait for `complete` before starting the VPS mirror. The `import_runs` `ok` row only
says the catalog is written:

```sh
for w in scryfall ygoprodeck; do
  (cd apps/api && CLOUDFLARE_ACCOUNT_ID=152a1fcd0eebb96d1bc30d14b5a6af58 pnpm exec wrangler workflows instances describe voidbinder-$w-import latest --env prod)
done
```

```sh
ssh voidbinder-db
tmux new -s mirror-prod
cd ~/voidbinder && git pull --ff-only && pnpm install --filter api
ENV="--env-file $HOME/.config/voidbinder/r2.env --env-file $HOME/.config/voidbinder/pg.env"
pnpm --filter api mirror-images $ENV --db prod --game mtg --limit 200 --verify --sm --dry-run
pnpm --filter api mirror-images $ENV --db prod --game mtg --verify --sm --concurrency 16 2>&1 | tee ~/mirror-prod-$(date +%F).log
pnpm --filter api mirror-images $ENV --db prod --game yugioh --verify --sm --concurrency 16 2>&1 | tee -a ~/mirror-prod-$(date +%F).log
# after the TCGdex incremental instance is complete (it follows the copy):
pnpm --filter api mirror-images $ENV --db prod --game pokemon --verify --sm --concurrency 16 2>&1 | tee -a ~/mirror-prod-$(date +%F).log
```

Never run a dev mirror at the same time (runbook section 11: the source rate limits count per IP).

**Expect:** the summary line shows mostly `reused`, few `uploaded`. On dev the full download took
2 h 15 min (Magic), 17 min (Yu-Gi-Oh!) and 73 min (Pokémon); with `--verify` the run is bound by
the HEAD requests instead: with `--concurrency 16` it did about 180 rows/s on 2026-10-10, so
Magic's 105k rows took about 10 minutes and Yu-Gi-Oh! about the same.
**Gate, per game (must pass before step 11 and before the URL is shared):**

```sh
docker exec voidbinder-db psql -U postgres -d voidbinder -XAt -c \
  "select s.game_id, count(*) as prints, count(p.image_key) as keys
   from prints p join sets s on s.id = p.set_id group by 1 order by 1"
```

`keys` per game must be at least the figure on dev (run the same query on `voidbinder_dev`) and
close to `prints`: Magic prints without a high-res scan stay without a key. On 2026-10-10 the
result was `mtg` 103,435 / 99,799, `pokemon` 21,290 / 19,663, `yugioh` 44,266 / 44,266. If a game
is far below dev, run its mirror again (it is resumable) before going on.
**Then the browser check:** on `https://app.voidbinder.de` the home page lists the games, a card
page shows its image from `img.voidbinder.de` (not "fehlt"), and the sign-up page shows the
Turnstile widget.

Then switch the nightly timer to both databases:

```sh
mkdir -p ~/.config/systemd/user/image-mirror.service.d
cat > ~/.config/systemd/user/image-mirror.service.d/override.conf <<'EOF'
[Service]
Environment="DBS=prod dev"
EOF
systemctl --user daemon-reload
systemctl --user show image-mirror.service -p Environment   # must show DBS=prod dev
```

The quotes are required: systemd splits an unquoted `Environment=DBS=prod dev` at the space and
drops `dev` (`systemctl --user edit` writes the same file, but its editor makes the quotes easy
to forget). `show` must print `DBS=prod dev`; with `DBS=prod` alone the quotes are missing.

**Rollback:** `systemctl --user revert image-mirror.service`. The keys stay; they point at
objects that exist.

### 9. First TCGCSV price import (25 min)

TCGCSV prices match products to the catalog, so they run after step 7. The prod cron runs at
20:30 UTC (and 22:30 to catch a late build). Start the first run by hand, so prices are there
today. The cron then reads `last-updated.txt`, sees the same build and ends after one request.
TCGCSV asks for one pull a day: do not also run a manual dev pull on the same day.

```sh
read -rs TOKEN   # paste ADMIN_TOKEN_prod
curl -sS -o /dev/stdout -w ' %{http_code}\n' -X POST -H "Authorization: Bearer $TOKEN" https://api.voidbinder.de/admin/import/tcgcsv
unset TOKEN
```

**Expect:** `{"status":"started"} 202`; on dev the run took 18 min, plus the 7-minute purge wait.
**Verify:** `import_runs` has `tcgcsv`/`prices` `ok`, and
`select source, count(*) from prices_current group by 1` shows `tcgplayer`, `cardmarket` and
`tcgplayer_scryfall` (dev: 498,747 rows in total). A card page in the app shows a price with its
source and date.
**Rollback:** not needed (prices are written per day and idempotent).

### 10. Offline catalog modules for prod (VPS, 15 min)

```sh
mkdir -p ~/.config/systemd/user/catalog-modules.service.d
cat > ~/.config/systemd/user/catalog-modules.service.d/override.conf <<'EOF'
[Service]
Environment="DBS=prod dev"
Environment="GAMES=yugioh pokemon mtg"
EOF
systemctl --user daemon-reload
systemctl --user show catalog-modules.service -p Environment   # must show DBS=prod dev and GAMES=yugioh pokemon mtg
systemctl --user start catalog-modules           # one run by hand now
journalctl --user -u catalog-modules -n 30
curl -s https://img.voidbinder.de/modules/prod/yugioh/manifest.json
curl -s https://api.voidbinder.de/catalog/modules
```

Quote both values (step 8). The `GAMES` line is there because the unit systemd had loaded on
2026-10-10 still said `GAMES=yugioh`; the file in the repo already lists all three, so once the
loaded unit matches it the line is redundant but harmless. `systemctl --user cat
catalog-modules.service` shows the unit and the drop-in as systemd sees them.

**Expect:** `catalog module built` for each game, the manifest has the current `catalog_version`,
and `/catalog/modules` answers the same manifests (after the 10-minute edge cache, VB-71).
**Rollback:** `systemctl --user revert catalog-modules.service`; the `modules/prod/` objects are
harmless (nothing reads them until the native app ships).

### 11. Deploy the site (5 min, needs B1 and #64 on `main`, and the step 8 gate passed)

**Do not run this before the step 8 count query passes.** The site links to the app; a visitor who
follows the link before the image keys exist sees every card as "fehlt" (2026-10-10).

```sh
pnpm --filter site deploy:prod
curl -sL https://voidbinder.de/de/ | grep -c -i -E 'server in deutschland|betrieben in deutschland'   # 0
curl -sL https://voidbinder.de/de/ | grep -o 'https://app.voidbinder.de[^"]*' | head -2
curl -sL https://voidbinder.de/de/datenschutz/ | grep -c -i 'plausible'   # > 0 once VB-62 is in
```

Do not set `PUBLIC_CF_ANALYTICS_TOKEN` (Max chose Plausible over Cloudflare Web Analytics; #64
removes the variable).

**Expect:** the German page no longer claims servers in Germany (the footer line "Mit Liebe gemacht
in Deutschland" stays, which is why the grep names only the forbidden claims, as the deny list in
`apps/site/src/i18n/i18n.test.ts` does), the hero links to the web app,
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

- B6 (VB-78): set up backups (database-vps.md section 7) if it is not done yet.
- VB-76: replace the one-off Pokémon copy script with `scripts/vps/copy-catalog.sh`.
- VB-63: price history backfill on prod, after step 9.
- The prod crons from now on, daily (UTC): Scryfall 03:00, YGOPRODeck 03:30, TCGdex 04:00
  (incremental), TCGCSV 20:30 and 22:30. VPS: image mirror 05:30 and catalog modules 06:30 (both
  `prod dev`).
- Disk: the prod catalog roughly doubles the database size (dev today is most of the 8.2 GB on
  `/var/lib/postgresql`, 39 GB free), and the price history grows by about 0.5 million rows a day
  before compression. Check `df` and the Kuma push monitor after the first week.

## Rollback overview

| Part         | How                                                                                                                                                                                                                                        |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| API Worker   | `wrangler rollback [version-id] --env prod` from `apps/api` (the last 100 versions; bindings must still exist); or remove the domain. Then delete the five cron triggers in the dashboard (they are not part of a version and keep firing) |
| App Worker   | First deploy: remove `app.voidbinder.de` or `wrangler delete --env prod`; later `wrangler rollback --env prod`                                                                                                                             |
| Site Worker  | `wrangler rollback --env prod` from `apps/site`                                                                                                                                                                                            |
| Database     | Migrations are additive only; leave them in place; a pgBackRest restore (runbook section 7) rewinds both databases and means downtime, last resort only. It exists only once B6 is fixed: until then there is nothing to restore from      |
| Catalog data | Upserts, idempotent; re-run an import to repair, never delete                                                                                                                                                                              |
| VPS timers   | `systemctl --user revert image-mirror.service catalog-modules.service`                                                                                                                                                                     |
| Secrets      | A rollback keeps today's secrets; `ADMIN_TOKEN` can be rotated any time, never rotate `BETTER_AUTH_SECRET` or `TWO_FACTOR_ENCRYPTION_KEY`                                                                                                  |

## Time

About 2.5 hours from step 1 to step 12, mostly waiting. The long part is step 7: the Magic and
Yu-Gi-Oh! Workflows (about 30 min each with the prices, the purge wait and their mirror step, side
by side) while the Pokémon copy runs on the VPS (minutes), followed by the TCGdex incremental
(about 15 min with its purge wait and mirror step). Step 8, the VPS mirror at about 180 rows/s
(about 10 min per big game), takes about 30 min and starts for each game once its Workflow instance
is `complete`; it gates step 11 (the site). Steps 9 (TCGCSV, about 25 min) and 10 (15 min) follow. Hands-on
time is about 1 hour. Not counted: Max's dashboard work (B2, N1, N2) and the VB-62 review.
