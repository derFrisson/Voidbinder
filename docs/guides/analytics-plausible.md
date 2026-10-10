# Plausible analytics runbook

How to install and run the self-hosted Plausible Community Edition (CE) that counts visits on
`voidbinder.de` and `app.voidbinder.de` (VB-74). It runs on the database VPS
([database-vps.md](database-vps.md)) in its own three containers, next to `voidbinder-db` but never
inside it: Plausible's own PostgreSQL (users, sites, settings), ClickHouse (the events) and the
Plausible app. Caddy on the host terminates TLS for `plausible.voidbinder.de` with a Let's Encrypt
certificate and forwards to Plausible on loopback.

```text
browser ── (Cloudflare) ── Caddy :80/:443 (host, systemd) ── 127.0.0.1:8000 ── plausible
                                                                               ├── plausible_db (postgres 16)
                                                                               └── plausible_events_db (clickhouse 24.12)
```

The files live in the repository under [`scripts/vps/plausible/`](../../scripts/vps/plausible):

| File                                            | On the VPS                                              |
| ----------------------------------------------- | ------------------------------------------------------- |
| `compose.yml`, `clickhouse/*.xml`               | `/opt/plausible/` (copies)                              |
| `.env.example`                                  | template for `/opt/plausible/.env` (ubuntu, mode 600)   |
| `Caddyfile`                                     | `/etc/caddy/Caddyfile` (root, 644)                      |
| `backup.sh`, `plausible-backup.{service,timer}` | run from the clone `~/voidbinder` as `ubuntu` user unit |

The compose file follows [plausible/community-edition](https://github.com/plausible/community-edition)
`v3.2.1` with pinned patch tags, bind mounts under `/opt/plausible/data`, memory limits (ClickHouse
2 GB, Postgres 512 MB), `restart: unless-stopped` and the app published on `127.0.0.1:8000` only.

## Install

All commands run on the VPS as `ubuntu` (`ssh voidbinder-db`), in a normal SSH login (rootless
Docker, see [database-vps.md, section 4](database-vps.md#4-docker-and-postgresql)).

**1. Files and secrets.** Pull the repository clone and copy the stack. The secrets are made on the
VPS and never printed; `invite_only` still lets the very first user register (Plausible's
first-launch flow), after that only invited users can.

```sh
git -C ~/voidbinder pull --ff-only
sudo install -d -o ubuntu -g ubuntu -m 755 /opt/plausible /opt/plausible/data
sudo install -d -o ubuntu -g ubuntu -m 700 /opt/plausible/backups
cp -r ~/voidbinder/scripts/vps/plausible/{compose.yml,clickhouse} /opt/plausible/
cd /opt/plausible
(umask 077; {
  echo BASE_URL=https://plausible.voidbinder.de
  echo "SECRET_KEY_BASE=$(openssl rand -base64 48)"
  echo "TOTP_VAULT_KEY=$(openssl rand -base64 32)"
  echo DISABLE_REGISTRATION=invite_only
  echo HTTP_PORT=8000
} > .env)
```

`.env` belongs to `ubuntu` (mode 600), not to root: the rootless Docker client runs as `ubuntu`
and must read it. Store both secrets in the password manager folder `Voidbinder DB` (`sudo` is not
needed, `cat /opt/plausible/.env`). Losing `SECRET_KEY_BASE` signs everyone out; losing
`TOTP_VAULT_KEY` makes enrolled two-factor secrets unreadable.

**2. Data directories.** Postgres and ClickHouse start as root in the container and take over
their directories themselves. The Plausible app runs as UID 999 (group `nogroup`, 65533), which
rootless Docker maps to _subuid base + 998_ and _subgid base + 65532_:

```sh
B=$(awk -F: '$1=="ubuntu" {print $2; exit}' /etc/subuid)
G=$(awk -F: '$1=="ubuntu" {print $2; exit}' /etc/subgid)
mkdir -p data/postgres data/clickhouse data/clickhouse-logs
sudo install -d -o $((B + 998)) -g $((G + 65532)) -m 755 data/plausible
```

**3. Start.**

```sh
docker compose pull && docker compose up -d
```

**verify:** after a minute `docker compose ps` shows `plausible_db` and `plausible_events_db` as
`healthy` and `plausible` as `Up`; `curl -s http://127.0.0.1:8000/api/health` answers JSON with
`"postgres":"ok"` and `"clickhouse":"ok"`; `ss -ltn 'sport = :8000'` shows only `127.0.0.1:8000`.

**If it fails:** `docker compose logs plausible` names the reason. `permission denied` on
`/var/lib/plausible` means step 2's owner is wrong (recompute `B` and `G`). A ClickHouse
`Cannot set max size of core file` or `nofile` error means the daemon's limit is lower than the
compose `ulimits` (`systemctl --user show docker -p LimitNOFILE` must be `infinity`).

**4. Caddy.** The Caddy apt repository (Cloudsmith) answered `402 Payment Required` on 2026-10-10,
so Caddy is installed from the signed `.deb` of its GitHub release, which brings the same systemd
unit and `caddy` user. Use the [latest release](https://github.com/caddyserver/caddy/releases):

```sh
V=2.11.7
cd /tmp
curl -fsSLO https://github.com/caddyserver/caddy/releases/download/v$V/caddy_${V}_linux_amd64.deb
curl -fsSLO https://github.com/caddyserver/caddy/releases/download/v$V/caddy_${V}_checksums.txt
grep " caddy_${V}_linux_amd64.deb$" caddy_${V}_checksums.txt | sha512sum -c -
sudo apt-get install -y ./caddy_${V}_linux_amd64.deb && rm caddy_${V}_*
sudo install -m 644 ~/voidbinder/scripts/vps/plausible/Caddyfile /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile
sudo ufw allow 80,443/tcp comment 'Caddy (Plausible)'
```

Caddy is not under Docker on purpose: rootless Docker cannot bind ports below 1024 and does not pass
the client address on, which Plausible needs to count unique visitors. The Caddyfile strips the
`X-Plausible-IP` header, which Plausible would otherwise trust above all others for the visitor IP.

Until the DNS record exists, keep Caddy off (`sudo systemctl disable --now caddy`), so it does not
spend Let's Encrypt's failed-validation limit on a name that does not resolve.

## Go live

**1. DNS.** In the `voidbinder.de` zone: `A plausible → 152.228.240.226`, **DNS only** (grey cloud)
for the first issuance. `dig +short plausible.voidbinder.de @1.1.1.1` must print the address.

**2. Start Caddy.**

```sh
sudo systemctl enable --now caddy
journalctl -u caddy -n 30 --no-pager   # "certificate obtained successfully"
```

**verify:** `curl -sI https://plausible.voidbinder.de` from the workstation answers `200` (or a
redirect to `/register`) with a valid certificate.

**3. Optional: Cloudflare proxy.** Once Caddy holds its certificate, switch the record to
**Proxied** with the zone's SSL mode on Full (strict). Plausible then reads the visitor address from
`CF-Connecting-IP`. Caddy renews about 30 days before expiry over HTTP-01 through the proxy; if
`journalctl -u caddy` shows a failed renewal, set the record to DNS only until the renewal is done.

**4. First admin.** Right after step 2 (until then anyone who opens the URL first would become the
admin), Max opens `https://plausible.voidbinder.de`, registers with his address and turns on
two-factor authentication (account settings). `DISABLE_REGISTRATION=invite_only` is already set,
so the register page is closed from then on; further users join by invitation from a site's
settings. Store the login in the password manager folder `Voidbinder DB`.

No mailer is configured: invitations and password resets go out through Plausible's default
direct-to-MX delivery from the VPS, which may land in spam or be refused. Add `MAILER_*`/`SMTP_*`
from the [configuration wiki](https://github.com/plausible/community-edition/wiki/configuration#email)
to `.env` if that matters.

**5. Sites.** In the UI, **+ Add website**: `voidbinder.de` and `app.voidbinder.de` (the Sites API
is not part of CE, it is an Enterprise-only route). The tracker posts to
`https://plausible.voidbinder.de/api/event`; with the npm tracker
([`@plausible-analytics/tracker`](https://www.npmjs.com/package/@plausible-analytics/tracker))
that is `init({ domain: 'voidbinder.de', endpoint: 'https://plausible.voidbinder.de/api/event' })`,
and the site's and the app's CSP need `plausible.voidbinder.de` in `connect-src`.

**verify:** a page view on the site shows up in the dashboard's realtime view within a minute.

## Update

Read the [release notes](https://github.com/plausible/analytics/releases) first (major versions can
need migration steps). Compare the new upstream `compose.yml` and `clickhouse/` with ours, set the
new tags in `scripts/vps/plausible/compose.yml` (PR), then on the VPS:

```sh
systemctl --user start plausible-backup   # fresh dump first
git -C ~/voidbinder pull --ff-only
cp -r ~/voidbinder/scripts/vps/plausible/{compose.yml,clickhouse} /opt/plausible/
cd /opt/plausible && docker compose pull && docker compose up -d
docker image prune -f
```

The app runs its database migrations at every start. Postgres stays on the major version upstream
tests (16); a major bump needs a dump and restore
([wiki](https://github.com/plausible/community-edition/wiki/upgrade-postgresql)). Caddy: install the
newer `.deb` as in Install step 4, then `sudo systemctl restart caddy`.

## Backup and restore

**Postgres (users, sites, goals, settings):** `plausible-backup.timer` dumps it every day at 02:00
UTC into `/opt/plausible/backups/plausible_db-YYYY-MM-DD.dump` and keeps 14 days. Install once:

```sh
mkdir -p ~/.config/systemd/user
ln -sf ~/voidbinder/scripts/vps/plausible/plausible-backup.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now plausible-backup.timer
```

**verify:** `systemctl --user start plausible-backup && ls -l /opt/plausible/backups` shows
today's dump; `systemctl --user list-timers plausible-backup.timer` shows the next start.

Restore into the running stack (replaces users and sites):

```sh
cd /opt/plausible
docker compose stop plausible
docker compose exec -T plausible_db pg_restore -U postgres -d plausible_db --clean --if-exists < backups/plausible_db-YYYY-MM-DD.dump
docker compose start plausible
```

**ClickHouse (the events):** not dumped. `/opt/plausible` is on the system disk, which the OVH
snapshot covers (take one before every update). For a file copy, stop the stack
(`docker compose stop`), archive `/opt/plausible/data/clickhouse` with `sudo tar`, start it again.
ClickHouse's own `BACKUP DATABASE plausible_events_db TO File(...)` needs a `backups` disk in the
server config first, see the [ClickHouse backup docs](https://clickhouse.com/docs/operations/backup).
Neither dump nor snapshot leaves OVH; an off-site copy is a follow-up.

## Where things are

- Admin UI: `https://plausible.voidbinder.de` (before DNS: `ssh -L 8000:127.0.0.1:8000
voidbinder-db`, then `http://localhost:8000`, read-only use; logins need the real URL).
- Secrets: `/opt/plausible/.env` on the VPS and the password manager; never in this repository.
- Logs: `docker compose -f /opt/plausible/compose.yml logs`, `journalctl -u caddy`.
- Open ports: `sudo ss -ltnp` shows Caddy on `:80`/`:443` (when on), the app on `127.0.0.1:8000`,
  Caddy's admin API on `127.0.0.1:2019`, and the database's `127.0.0.1:5432`. Nothing of Plausible's
  Postgres or ClickHouse is published. `ufw` allows `22/tcp` and `80,443/tcp` in.

## Privacy facts (for the privacy policy, VB-62)

From Plausible's [data policy](https://plausible.io/data-policy) and the CE source:

- No cookies, no local storage, no persistent visitor identifier.
- Unique visitors are counted with a daily hash of the site domain, IP address and user agent with
  a random salt; the salt is rotated and deleted every 24 hours, so the same visitor cannot be
  followed from one day to the next. The raw IP address is not stored.
- The country comes from a local lookup in the bundled DB-IP Lite database; no third party is
  asked.
- Self-hosted: the data stays on our VPS (OVH, Gravelines, France); Plausible Insights OÜ does not
  process it.
- Further reading: [data policy](https://plausible.io/data-policy),
  [privacy-focused analytics](https://plausible.io/privacy-focused-web-analytics).
