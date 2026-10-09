# Database VPS runbook

How to set up and run the PostgreSQL + TimescaleDB server behind voidbinder.de
([ADR 0003](../adr/0003-price-history-storage.md)). One OVH VPS in Gravelines runs PostgreSQL 18
with TimescaleDB in Docker. Cloudflare Workers reach it only through a Cloudflare Tunnel, a Workers
VPC service and Hyperdrive. pgBackRest backs it up to Backblaze B2. The server has no public
Postgres port.

```text
Worker ── Hyperdrive ── Workers VPC service ── Tunnel ── cloudflared (host) ── 172.30.0.10:5432 (container)
Max's workstation ── SSH tunnel ── 172.30.0.10:5432 (migrations only)
container ── pgBackRest ── Backblaze B2 (EU Central)
```

Run every step in order. Each one ends with **verify:** and the output to expect. `<…>` marks a
value you fill in. Passwords, keys and tokens go into the files named here or into a password
manager, never into this repository.

Versions checked on 2026-10-09:

| Component         | Version / tag                               | Source                                                                                                                                                                                              |
| ----------------- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TimescaleDB image | `timescale/timescaledb-ha:pg18.6-ts2.30.2`  | [Docker Hub](https://hub.docker.com/r/timescale/timescaledb-ha/tags), [repo](https://github.com/timescale/timescaledb-docker-ha)                                                                    |
| PostgreSQL        | 18.6                                        | in the image                                                                                                                                                                                        |
| TimescaleDB       | 2.30.2 (Community, Timescale License)       | in the image                                                                                                                                                                                        |
| pgBackRest        | 2.59.3, shipped in the image                | [pgbackrest.org](https://pgbackrest.org/configuration.html)                                                                                                                                         |
| cloudflared       | 2026.10.0 from `pkg.cloudflare.com`         | [pkg.cloudflare.com](https://pkg.cloudflare.com/index.html)                                                                                                                                         |
| wrangler          | `apps/site` devDependency (4.148+)          | [Workers VPC](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/), [Hyperdrive](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/) |
| Docker Engine     | current stable from Docker's apt repository | [docs.docker.com](https://docs.docker.com/engine/install/debian/)                                                                                                                                   |

## 1. Order and prepare

Order at OVHcloud:

- [ ] **VPS-2**: 4 vCores, 8 GB RAM, 75 GB NVMe system disk.
- [ ] Location **Gravelines (France)**.
- [ ] Image **Debian 13** (this runbook). Ubuntu 24.04 LTS works too: the login user is then
      `ubuntu` instead of `debian`, and the Docker repository URL changes (section 4).
- [ ] Option **additional disk, 50 GB**.
- [ ] Option **snapshot**. A snapshot covers the system disk only, not the additional disk: it
      saves the OS, Docker and the config under `/opt` and `/etc`, while the data is covered by
      pgBackRest (section 7).
- [ ] Your **SSH public key** in the order form, so the server boots with key login.

Have at hand:

- The SSH key pair named in the order.
- The Cloudflare account `152a1fcd0eebb96d1bc30d14b5a6af58` with `wrangler login` done on the
  workstation. Creating VPC services needs the role Connectivity Directory Admin (Super
  Administrator includes it).
- A Backblaze B2 account in the **EU Central** region. The region is fixed when the account is
  created; a US account cannot hold EU buckets, so create a new account if yours is US.
- Optional: an Uptime Kuma instance for the push monitor in section 8.

**verify:** the OVH control panel shows the VPS as active with one additional disk, and
`ssh debian@<vps-ip>` from the workstation logs in without a password prompt.

## 2. Base system

All commands below run on the VPS as `debian` with `sudo`.

```sh
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone UTC
```

**SSH: keys only, no root login.**

```sh
sudo tee /etc/ssh/sshd_config.d/10-voidbinder.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl reload ssh
```

**verify:** `sudo sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '`
prints `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin no`. Keep
the current session open and log in again from a second terminal before you close it.

**Firewall: deny everything inbound except SSH.** Port 5432 is never opened; Postgres is reached
through the tunnel. Outbound stays open (cloudflared needs UDP 7844 out for QUIC, pgBackRest needs
HTTPS out).

```sh
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw enable
```

**verify:** `sudo ufw status verbose` shows `Status: active`,
`Default: deny (incoming), allow (outgoing)` and one rule `22/tcp ALLOW IN Anywhere` (plus its v6
twin).

**Unattended security upgrades.**

```sh
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # answer "Yes"
```

**verify:** `cat /etc/apt/apt.conf.d/20auto-upgrades` shows
`APT::Periodic::Update-Package-Lists "1";` and `APT::Periodic::Unattended-Upgrade "1";`.

**Time sync.**

**verify:** `timedatectl` shows `Time zone: Etc/UTC (UTC, +0000)` and
`System clock synchronized: yes`. If it says `no`, run `sudo apt install -y systemd-timesyncd`
and check again.

**Optional: fail2ban.** With password login off it only trims log noise:
`sudo apt install -y fail2ban` (the Debian package enables the `sshd` jail).
**verify:** `sudo fail2ban-client status sshd` shows `Currently banned:` with a number.

**Tools used later:**

```sh
sudo apt install -y jq curl ca-certificates openssl
```

## 3. Additional disk

Find the disk: the 50 GB one without partitions or mount point.

```sh
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS
```

**verify:** one disk of 50G (usually `sdb`) has no children and no `FSTYPE`. The commands below use
`/dev/sdb`; replace it if yours differs. `mkfs` erases the disk, so check the name twice.

Format it as a whole-disk ext4 (no partition, so growing it later is one `resize2fs`):

```sh
sudo mkfs.ext4 -L pgdata /dev/sdb
sudo mkdir -p /var/lib/postgresql
UUID=$(sudo blkid -s UUID -o value /dev/sdb); echo "$UUID"
echo "UUID=$UUID /var/lib/postgresql ext4 defaults,noatime,nofail 0 2" | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo mount /var/lib/postgresql
```

`nofail` lets the VPS boot when the disk is missing. Postgres then refuses to start instead of
creating an empty cluster, because its data directory below only exists on this disk and the
compose file forbids Docker to create it.

Create the data directory, owned by UID 1000 (the `postgres` user inside the image):

```sh
sudo install -d -o 1000 -g 1000 -m 700 /var/lib/postgresql/voidbinder
```

**verify:** `findmnt /var/lib/postgresql` shows `/dev/sdb ext4 rw,noatime`, `df -h /var/lib/postgresql`
shows about 49G, and `stat -c '%u:%g %a' /var/lib/postgresql/voidbinder` prints `1000:1000 700`.
Then `sudo reboot`, log in again, and `findmnt /var/lib/postgresql` still shows the disk.

## 4. Docker and PostgreSQL

**Docker Engine from Docker's repository** (commands from docs.docker.com, Debian):

```sh
sudo install -m 0755 -d /etc/apt/keyrings
sudo curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc
sudo chmod a+r /etc/apt/keyrings/docker.asc
sudo tee /etc/apt/sources.list.d/docker.sources <<EOF
Types: deb
URIs: https://download.docker.com/linux/debian
Suites: $(. /etc/os-release && echo "$VERSION_CODENAME")
Components: stable
Architectures: $(dpkg --print-architecture)
Signed-By: /etc/apt/keyrings/docker.asc
EOF
sudo apt update
sudo apt install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
```

(On Ubuntu replace both `debian` in the URLs with `ubuntu`.) Docker bypasses `ufw` for published
ports; the compose file below publishes none.

**verify:** `sudo docker run --rm hello-world` prints `Hello from Docker!` and
`sudo docker compose version` prints `Docker Compose version v…`.

**Directory layout.**

```sh
sudo install -d -m 755 /opt/voidbinder-db
sudo install -d -o 1000 -g 1000 -m 700 /opt/voidbinder-db/tls
sudo install -d -m 700 /etc/pgbackrest
```

**TLS certificate.** Hyperdrive always speaks TLS to Postgres. A self-signed certificate for the
name `db.voidbinder.de` (no DNS record needed) encrypts the last hop from cloudflared to the
container; the hop from Cloudflare to the VPS is already inside the tunnel.

```sh
TLS=/opt/voidbinder-db/tls
sudo openssl req -x509 -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes -days 3650 \
  -subj "/CN=db.voidbinder.de" -addext "subjectAltName=DNS:db.voidbinder.de" \
  -keyout $TLS/server.key -out $TLS/server.crt
sudo chown 1000:1000 $TLS/server.key $TLS/server.crt
sudo chmod 600 $TLS/server.key && sudo chmod 644 $TLS/server.crt
```

**verify:** `sudo openssl x509 -in /opt/voidbinder-db/tls/server.crt -noout -subject -enddate` prints
`subject=CN=db.voidbinder.de` and a `notAfter` ten years ahead.

Workers VPC trusts only publicly trusted and Cloudflare Origin CA certificates, so with this
self-signed certificate the VPC service in section 6 uses `--cert-verification-mode disabled`. To
get verification, replace it with a Let's Encrypt certificate through DNS-01 (no inbound port
needed):

```sh
sudo apt install -y certbot python3-certbot-dns-cloudflare
# API token with Zone > DNS > Edit for voidbinder.de only
sudo install -m 600 /dev/null /etc/letsencrypt/cloudflare.ini
echo 'dns_cloudflare_api_token = <token>' | sudo tee /etc/letsencrypt/cloudflare.ini >/dev/null
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d db.voidbinder.de --deploy-hook /usr/local/bin/voidbinder-db-cert
```

with `/usr/local/bin/voidbinder-db-cert` (mode 755) copying the renewed files and reloading
Postgres, which re-reads certificates on reload:

```sh
#!/bin/sh
set -eu
install -o 1000 -g 1000 -m 644 "$RENEWED_LINEAGE/fullchain.pem" /opt/voidbinder-db/tls/server.crt
install -o 1000 -g 1000 -m 600 "$RENEWED_LINEAGE/privkey.pem" /opt/voidbinder-db/tls/server.key
docker exec voidbinder-db psql -U postgres -Atc 'SELECT pg_reload_conf()'
```

then switch the VPC service to `--cert-verification-mode verify_ca` with `wrangler vpc service update`
(section 6). `verify_ca` because the service addresses the container by IP, not by name.

**Client authentication: `/opt/voidbinder-db/pg_hba.conf`.** cloudflared and the SSH tunnel
both reach the container from the host side of the Docker network, `172.30.0.1`. Every TCP
login needs TLS and SCRAM; anything that matches no line is rejected. Inside the container the
`postgres` superuser logs in over the Unix socket only (pgBackRest, maintenance).

```sh
sudo tee /opt/voidbinder-db/pg_hba.conf >/dev/null <<'EOF'
# TYPE   DATABASE                  USER                ADDRESS         METHOD
local    all                       postgres                            peer
local    all                       all                                 scram-sha-256
hostssl  voidbinder_dev            hyperdrive_dev      172.30.0.1/32   scram-sha-256
hostssl  voidbinder                hyperdrive_prod     172.30.0.1/32   scram-sha-256
hostssl  voidbinder_dev,voidbinder voidbinder_migrate  172.30.0.1/32   scram-sha-256
EOF
sudo chmod 644 /opt/voidbinder-db/pg_hba.conf
```

**Superuser password.** The image needs one for its first start; `postgres` then logs in by
`peer` only, so the password is never used, but keep it in the password manager:

```sh
sudo install -m 600 /dev/null /opt/voidbinder-db/.env
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')" | sudo tee /opt/voidbinder-db/.env >/dev/null
```

**pgBackRest config placeholder.** The container mounts `/etc/pgbackrest/pgbackrest.conf`; create
it now and fill it in section 7. Until the stanza exists, WAL archiving fails and Postgres keeps
the WAL and retries; that is expected for the minutes in between.

```sh
sudo install -o 1000 -g 1000 -m 600 /dev/null /etc/pgbackrest/pgbackrest.conf
```

**`/opt/voidbinder-db/docker-compose.yml`.** Memory settings for 8 GB RAM. The image starts as
`postgres` (UID 1000); `NO_TS_TUNE` stops `timescaledb-tune` from rewriting the config, so the
command line below is the whole tuning. `-c` options override `postgresql.conf` in the data
directory.

```yaml
name: voidbinder-db

services:
  db:
    image: timescale/timescaledb-ha:pg18.6-ts2.30.2
    container_name: voidbinder-db
    restart: unless-stopped
    env_file: .env
    environment:
      NO_TS_TUNE: 'true'
      TIMESCALEDB_TELEMETRY: 'off'
      PGBACKREST_CONFIG: /etc/pgbackrest/pgbackrest.conf
      PGBACKREST_STANZA: voidbinder
    command:
      - postgres
      - -c
      - shared_preload_libraries=timescaledb,pg_stat_statements
      - -c
      - listen_addresses=*
      - -c
      - unix_socket_directories=/var/run/postgresql
      - -c
      - hba_file=/etc/postgresql/pg_hba.conf
      - -c
      - ssl=on
      - -c
      - ssl_cert_file=/etc/postgresql/tls/server.crt
      - -c
      - ssl_key_file=/etc/postgresql/tls/server.key
      - -c
      - shared_buffers=2GB
      - -c
      - effective_cache_size=6GB
      - -c
      - maintenance_work_mem=512MB
      - -c
      - work_mem=16MB
      - -c
      - max_parallel_workers=4
      - -c
      - timescaledb.max_background_workers=8
      - -c
      - max_worker_processes=16
      - -c
      - wal_level=replica
      - -c
      - max_wal_size=2GB
      - -c
      - archive_mode=on
      - -c
      - archive_command=pgbackrest --stanza=voidbinder archive-push %p
      - -c
      - archive_timeout=300
      - -c
      - 'log_line_prefix=%m [%p] %q%u@%d '
      - -c
      - log_min_duration_statement=500ms
      - -c
      - log_lock_waits=on
      - -c
      - log_temp_files=0
    volumes:
      - type: bind
        source: /var/lib/postgresql/voidbinder
        target: /home/postgres/pgdata
        bind: { create_host_path: false }
      - type: bind
        source: /opt/voidbinder-db/pg_hba.conf
        target: /etc/postgresql/pg_hba.conf
        read_only: true
        bind: { create_host_path: false }
      - type: bind
        source: /opt/voidbinder-db/tls
        target: /etc/postgresql/tls
        read_only: true
        bind: { create_host_path: false }
      - type: bind
        source: /etc/pgbackrest/pgbackrest.conf
        target: /etc/pgbackrest/pgbackrest.conf
        read_only: true
        bind: { create_host_path: false }
    networks:
      db:
        ipv4_address: 172.30.0.10
    shm_size: 1g
    stop_grace_period: 60s
    logging:
      driver: local
    healthcheck:
      test: ['CMD', 'pg_isready', '-h', '/var/run/postgresql', '-U', 'postgres']
      interval: 10s
      timeout: 5s
      retries: 5

networks:
  db:
    name: voidbinder-db
    ipam:
      config:
        - subnet: 172.30.0.0/24
```

Notes on the values: `timescaledb.max_background_workers` is the number of databases (4 with
`postgres` and `template1`) plus concurrent jobs; `max_worker_processes` is at least that plus
`max_parallel_workers`. `archive_timeout=300` closes a WAL segment at least every five minutes, so
at most five minutes of writes are not yet in B2. `logging: local` rotates the container log
(5 × 20 MB).

Start it:

```sh
cd /opt/voidbinder-db
sudo docker compose up -d
```

**verify:**

- `sudo docker compose ps` shows `voidbinder-db` with `Up … (healthy)` after about 30 s.
- `sudo docker logs voidbinder-db 2>&1 | grep 'ready to accept connections'` prints a line
  (twice on the first start: once for the init server, once for the real one).
- `sudo docker exec voidbinder-db psql -U postgres -Atc "SELECT version()"` starts with
  `PostgreSQL 18.6`.
- `sudo docker exec voidbinder-db psql -U postgres -Atc "SHOW shared_preload_libraries; SHOW ssl; SHOW hba_file; SHOW shared_buffers"`
  prints `timescaledb,pg_stat_statements`, `on`, `/etc/postgresql/pg_hba.conf`, `2GB`.
- `sudo ss -ltnp | grep 5432` prints nothing: no port on the host.
- `ls /var/lib/postgresql/voidbinder/data/PG_VERSION` exists (the data is on the additional disk).

## 5. Roles and databases

| Role                 | Login | Rights                                                                  |
| -------------------- | ----- | ----------------------------------------------------------------------- |
| `voidbinder_migrate` | yes   | Owns both databases; runs `pnpm --filter site db:migrate` (DDL).        |
| `voidbinder_app`     | no    | Group role: `SELECT, INSERT, UPDATE, DELETE` on the app tables, no DDL. |
| `hyperdrive_dev`     | yes   | Member of `voidbinder_app`, may connect to `voidbinder_dev` only.       |
| `hyperdrive_prod`    | yes   | Member of `voidbinder_app`, may connect to `voidbinder` only.           |

Both databases live on this instance: `voidbinder_dev` for the `dev` environment, `voidbinder`
for `prod`.

```sh
sudo docker exec -i voidbinder-db psql -U postgres -v ON_ERROR_STOP=1 <<'EOF'
CREATE ROLE voidbinder_migrate LOGIN;
CREATE ROLE voidbinder_app NOLOGIN;
CREATE ROLE hyperdrive_dev LOGIN IN ROLE voidbinder_app;
CREATE ROLE hyperdrive_prod LOGIN IN ROLE voidbinder_app;
CREATE DATABASE voidbinder_dev OWNER voidbinder_migrate;
CREATE DATABASE voidbinder OWNER voidbinder_migrate;
REVOKE ALL ON DATABASE voidbinder_dev FROM PUBLIC;
REVOKE ALL ON DATABASE voidbinder FROM PUBLIC;
GRANT CONNECT ON DATABASE voidbinder_dev TO hyperdrive_dev;
GRANT CONNECT ON DATABASE voidbinder TO hyperdrive_prod;
EOF

for db in voidbinder_dev voidbinder; do
sudo docker exec -i voidbinder-db psql -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'EOF'
CREATE EXTENSION IF NOT EXISTS timescaledb;
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
GRANT USAGE ON SCHEMA public TO voidbinder_app;
ALTER DEFAULT PRIVILEGES FOR ROLE voidbinder_migrate IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO voidbinder_app;
ALTER DEFAULT PRIVILEGES FOR ROLE voidbinder_migrate IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO voidbinder_app;
EOF
done
```

`public` belongs to the database owner (PostgreSQL 15+), so only `voidbinder_migrate` can create
objects there; the default privileges hand every table it creates to `voidbinder_app`.

Set the three passwords. `\password` sends only the SCRAM hash, so the clear text never lands in
a log or the shell history. Generate each with `openssl rand -base64 32 | tr -d '/+='` and store
it in the password manager first.

```sh
sudo docker exec -it voidbinder-db psql -U postgres -c '\password voidbinder_migrate'
sudo docker exec -it voidbinder-db psql -U postgres -c '\password hyperdrive_dev'
sudo docker exec -it voidbinder-db psql -U postgres -c '\password hyperdrive_prod'
```

**verify:**

- `sudo docker exec voidbinder-db psql -U postgres -c '\l voidbinder*'` lists `voidbinder` and
  `voidbinder_dev` with owner `voidbinder_migrate`.
- `sudo docker exec voidbinder-db psql -U postgres -d voidbinder_dev -c '\dx'` lists
  `timescaledb` 2.30.2 and `pg_stat_statements`.
- `sudo docker exec voidbinder-db psql -U postgres -d voidbinder_dev -c 'SET ROLE hyperdrive_dev; CREATE TABLE ddl_probe (i int)'`
  fails with `ERROR:  permission denied for schema public`.

**Apply the app migrations from the workstation.** Open a temporary SSH tunnel in one terminal
(local port 15432, since 5434 is the local Docker Postgres):

```sh
ssh -N -L 15432:172.30.0.10:5432 debian@<vps-ip>
```

and run the migrations in another, from the repository root. `sslmode=no-verify` keeps TLS on
without checking the self-signed certificate; SSH already authenticates the server.

```sh
read -rs PGPW   # voidbinder_migrate password
DATABASE_URL="postgres://voidbinder_migrate:$PGPW@localhost:15432/voidbinder_dev?sslmode=no-verify" \
  pnpm --filter site db:migrate
DATABASE_URL="postgres://voidbinder_migrate:$PGPW@localhost:15432/voidbinder?sslmode=no-verify" \
  pnpm --filter site db:migrate
unset PGPW
```

Close the tunnel with Ctrl-C afterwards.

**verify:** both runs end without an error, and
`sudo docker exec voidbinder-db psql -U postgres -d voidbinder_dev -c 'SET ROLE hyperdrive_dev; SELECT count(*) FROM waitlist_signups'`
prints `0` (the app role can read the migrated table). Same for `-d voidbinder` with
`hyperdrive_prod`.

**Preview: price history (arrives with VB-30).** The app migrations create the tables. The price
pipeline (VB-30) will turn `prices_daily` into a hypertable with compression, roughly as below.
Column names are placeholders until VB-30 fixes the schema; a hypertable's primary key and unique
constraints must include the time column. Do not run this now.

```sql
SELECT create_hypertable('prices_daily', by_range('observed_at', INTERVAL '1 month'));
ALTER TABLE prices_daily SET (
  timescaledb.enable_columnstore = true,
  timescaledb.segmentby = 'print_id, source',
  timescaledb.orderby = 'observed_at DESC'
);
CALL add_columnstore_policy('prices_daily', after => INTERVAL '30 days');
```

`add_columnstore_policy` replaced `add_compression_policy` in TimescaleDB 2.18
([docs](https://www.tigerdata.com/docs/api/latest/hypercore/add_columnstore_policy)).

## 6. Cloudflare Tunnel, Workers VPC and Hyperdrive

**Create the tunnel** (the Voidbinder one; do not reuse the Voidcom tunnel). In the dashboard:
Workers & Pages → **Workers VPC** → **Tunnels** → **Create**, name `voidbinder-db`, **Save
tunnel**, choose Debian / 64-bit and copy the token (the `eyJ…` string in the install command;
do not run the dashboard's install command as is). Note the **tunnel ID** (UUID) from the
tunnel's page.

**Install cloudflared as a systemd service** (repository from pkg.cloudflare.com, Debian/Ubuntu
"any"):

```sh
sudo mkdir -p --mode=0755 /usr/share/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo 'deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared any main' \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt update && sudo apt install -y cloudflared
read -rs TUNNEL_TOKEN
sudo cloudflared service install "$TUNNEL_TOKEN"
unset TUNNEL_TOKEN
```

The tunnel token now lives in `/etc/systemd/system/cloudflared.service` (root only). Unattended
upgrades install Debian security updates only; cloudflared is updated with the monthly
`apt upgrade` in section 8.

**verify:**

- `cloudflared --version` prints `cloudflared version 2026.10.0` or newer.
- `systemctl status cloudflared` shows `active (running)`, and
  `journalctl -u cloudflared --since -5min | grep -i 'registered tunnel connection'` shows
  connections with `protocol=quic` (Workers VPC needs QUIC, UDP 7844 out).
- The tunnel shows **Healthy** in the dashboard.

No public hostname and no private network route are needed: the VPC service is the route. The
host reaches the container at `172.30.0.10` directly.

**Create the Workers VPC service** from the workstation, in `apps/site` (so wrangler picks up
`account_id` `152a1fcd0eebb96d1bc30d14b5a6af58` from `wrangler.jsonc`):

```sh
cd apps/site
pnpm exec wrangler vpc service create voidbinder-psql \
  --type tcp --tcp-port 5432 --app-protocol postgresql \
  --tunnel-id <tunnel-id> --ipv4 172.30.0.10 \
  --cert-verification-mode disabled
```

`disabled` because of the self-signed certificate (section 4); with a Let's Encrypt certificate run
`pnpm exec wrangler vpc service update <vpc-service-id> --name voidbinder-psql --type tcp --tcp-port 5432 --app-protocol postgresql --tunnel-id <tunnel-id> --ipv4 172.30.0.10 --cert-verification-mode verify_ca`.

**verify:** the command prints a service ID; `pnpm exec wrangler vpc service list` lists
`voidbinder-psql` with type `tcp`, port 5432 and the tunnel ID.

**Create one Hyperdrive config per environment**, caching off (the waitlist reads rows right after
writing them), at most 10 connections each. Hyperdrive connects once to check the credentials, so
section 5 must be done.

```sh
read -rs HD_PW   # hyperdrive_dev password
pnpm exec wrangler hyperdrive create voidbinder-dev \
  --service-id <vpc-service-id> --database voidbinder_dev \
  --user hyperdrive_dev --password "$HD_PW" --scheme postgresql \
  --caching-disabled --origin-connection-limit 10
read -rs HD_PW   # hyperdrive_prod password
pnpm exec wrangler hyperdrive create voidbinder-prod \
  --service-id <vpc-service-id> --database voidbinder \
  --user hyperdrive_prod --password "$HD_PW" --scheme postgresql \
  --caching-disabled --origin-connection-limit 10
unset HD_PW
```

Each command prints an `id`. Put them into `apps/site/wrangler.jsonc`: the `dev` id replaces the
all-zero `id` in `env.dev.hyperdrive[0]`, the `prod` id the one in `env.prod.hyperdrive[0]`.
Leave the top-level entry (local Docker Postgres) as it is. The ids are not secrets; commit them
in a small PR.

**verify:**

- `pnpm exec wrangler hyperdrive list` lists `voidbinder-dev` and `voidbinder-prod` with the
  ids, origin `voidbinder-psql` / the VPC service ID, and caching disabled.
- End to end: `wrangler dev` uses `localConnectionString` and never goes through Hyperdrive, so
  test the deployed `dev` Worker. Deploy it with `pnpm --filter site deploy:dev`, then

  ```sh
  curl -s -X POST https://voidbinder-site-dev.frisson.workers.dev/api/waitlist \
    -H 'Content-Type: application/json' \
    -d '{"email":"<your address>","locale":"en","consent":true,"website":""}'
  ```

  answers `{"status":"pending"}`, the confirmation mail arrives, and on the VPS
  `sudo docker exec voidbinder-db psql -U postgres -d voidbinder_dev -Atc 'SELECT status FROM waitlist_signups'`
  prints `pending`. `SELECT usename, ssl FROM pg_stat_ssl JOIN pg_stat_activity USING (pid) WHERE usename LIKE 'hyperdrive%'`
  shows Hyperdrive's pooled connections with `ssl = t`. Repeat for `prod` once it goes live.

## 7. Backups with pgBackRest to Backblaze B2

pgBackRest runs inside the database container (the image ships it); it reaches Postgres through
the Unix socket and B2 through its own S3 client. Plan: a full backup every Sunday, an
incremental one on the other days, WAL archived continuously, four full backups kept (about four
weeks of point-in-time recovery).

**Bucket and key in B2** (web UI, EU Central account):

1. **Buckets → Create a Bucket**: a globally unique name such as
   `voidbinder-db-backup-<random>`, **Private**, Object Lock **off** (pgBackRest deletes expired
   backups itself).
2. On the bucket, **Lifecycle Settings → Keep only the last version of the file**. B2 keeps old
   versions by default; without this rule the files pgBackRest expires would still be stored and
   billed. Add no other lifecycle rule, retention is pgBackRest's job.
3. Note the bucket's **Endpoint**, for example `s3.eu-central-003.backblazeb2.com`. The region is
   the part between `s3.` and `.backblazeb2.com` (`eu-central-003`).
4. **Application Keys → Add a New Application Key**: name `voidbinder-pgbackrest`, **Allow access
   to Bucket(s)**: only the new bucket, **Type of Access: Read and Write**, leave **Allow List All
   Bucket Names** off (pgBackRest does not list buckets). Copy `keyID` and `applicationKey`; the
   key is shown only once.

**Config.** Generate the encryption passphrase and keep it in the password manager next to the B2
key: without it no backup can ever be restored.

```sh
openssl rand -base64 48   # repo1-cipher-pass
sudo tee /etc/pgbackrest/pgbackrest.conf >/dev/null <<'EOF'
[global]
repo1-type=s3
repo1-s3-endpoint=s3.<region>.backblazeb2.com
repo1-s3-region=<region>
repo1-s3-bucket=<bucket>
repo1-s3-key=<keyID>
repo1-s3-key-secret=<applicationKey>
repo1-path=/pgbackrest
repo1-retention-full=4
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=<passphrase>
compress-type=zst
process-max=2
start-fast=y
log-level-console=info

[voidbinder]
pg1-path=/home/postgres/pgdata/data
pg1-socket-path=/var/run/postgresql
EOF
sudo chown 1000:1000 /etc/pgbackrest/pgbackrest.conf && sudo chmod 600 /etc/pgbackrest/pgbackrest.conf
```

`tee` keeps the existing file, so owner and mode stay as created in section 4; the last line makes
sure. On OVH's Debian image UID 1000 on the host is usually the `debian` login user, which has `sudo` anyway.

The `archive_command` in the compose file (`pgbackrest --stanza=voidbinder archive-push %p`) is
already active. Create the stanza and check archiving:

```sh
sudo docker exec voidbinder-db pgbackrest --stanza=voidbinder stanza-create
sudo docker exec voidbinder-db pgbackrest --stanza=voidbinder check
```

**verify:** `stanza-create` ends with `stanza-create command end: completed successfully`, `check`
with `check command end: completed successfully` (it forces a WAL switch and waits until that
segment is in B2). The bucket now has `pgbackrest/archive/voidbinder/` and
`pgbackrest/backup/voidbinder/`.

**First full backup:**

```sh
sudo docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=full backup
```

**verify:** `sudo docker exec voidbinder-db pgbackrest --stanza=voidbinder info` shows
`status: ok`, `cipher: aes-256-cbc` and one `full backup` with its timestamp, and
`sudo docker exec voidbinder-db pgbackrest version` prints the pgBackRest version of the image
(`pgBackRest 2.59.3` for the tag above).

**Schedule** (`/etc/cron.d/voidbinder-db`, times in UTC):

```sh
sudo tee /etc/cron.d/voidbinder-db >/dev/null <<'EOF'
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
30 2 * * 0   root docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=full backup >>/var/log/voidbinder-db-backup.log 2>&1
30 2 * * 1-6 root docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=incr backup >>/var/log/voidbinder-db-backup.log 2>&1
EOF
```

**verify:** the next morning `grep 'command end' /var/log/voidbinder-db-backup.log | tail -n 2`
shows `backup command end: completed successfully` followed by `expire command end: completed
successfully`, and `pgbackrest info` lists one more backup.

**Restore drill.** Run it once now and then every quarter: restore the latest state into a
scratch container next to the live one, compare, throw it away. The live database is not
touched; the scratch instance reads from B2 and never archives (`--archive-mode=off`).

```sh
IMAGE=timescale/timescaledb-ha:pg18.6-ts2.30.2
DRILL=/var/lib/postgresql/restore-drill
sudo install -d -o 1000 -g 1000 -m 700 "$DRILL"
sudo docker run --rm \
  -v "$DRILL":/home/postgres/pgdata \
  -v /etc/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
  -e PGBACKREST_CONFIG=/etc/pgbackrest/pgbackrest.conf \
  --entrypoint pgbackrest "$IMAGE" --stanza=voidbinder --archive-mode=off restore
sudo docker run -d --name voidbinder-restore-drill \
  -v "$DRILL":/home/postgres/pgdata \
  -v /etc/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
  -e PGBACKREST_CONFIG=/etc/pgbackrest/pgbackrest.conf \
  "$IMAGE" postgres -c max_worker_processes=16
```

The restore needs free space for one copy of the data (`df -h /var/lib/postgresql` first). The
scratch instance replays the archived WAL and then opens for writes. Recovery refuses to start
when `max_worker_processes` is lower than on the live server, hence the `-c`; keep it equal to the
compose file.

**verify:**

- `sudo docker logs voidbinder-restore-drill 2>&1 | grep -E 'archive recovery complete|ready to accept connections'`
  shows both lines.
- For each table that matters, the counts match the live database up to the last archived
  segment (at most five minutes old):

  ```sh
  for c in voidbinder-db voidbinder-restore-drill; do
    sudo docker exec "$c" psql -U postgres -d voidbinder -Atc 'SELECT count(*) FROM waitlist_signups'
  done
  ```

Clean up:

```sh
sudo docker rm -f voidbinder-restore-drill
sudo rm -rf "$DRILL"
```

A real disaster restore is the same restore command into the emptied
`/var/lib/postgresql/voidbinder` with the live container stopped (`docker compose down`), then
`docker compose up -d`; add `--type=time "--target=<timestamp>"` for a point in time.

## 8. Operations

**Minor updates** (a new `pg18.x-ts2.y.z` tag, PostgreSQL minor or TimescaleDB release). The OVH
snapshot covers the system disk only, so take both a snapshot and a fresh backup first:

1. OVH control panel → the VPS → **Snapshot → Take a snapshot**.
2. `sudo docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=incr backup`
3. Set the new tag in `/opt/voidbinder-db/docker-compose.yml` (check
   [the tags](https://hub.docker.com/r/timescale/timescaledb-ha/tags); keep `pg18`, no `-oss`,
   no `-all`), then:

   ```sh
   cd /opt/voidbinder-db
   sudo docker compose pull && sudo docker compose up -d
   for db in postgres template1 voidbinder_dev voidbinder; do
     sudo docker exec voidbinder-db psql -X -U postgres -d "$db" -c 'ALTER EXTENSION timescaledb UPDATE'
   done
   ```

   `ALTER EXTENSION` runs as the first command of a fresh session (`-X`), in every database that
   has the extension. Also update the tag in the restore drill above.

**verify:** `SELECT version()` shows the new PostgreSQL minor, `\dx timescaledb` the new version in
every database, `pgbackrest --stanza=voidbinder check` succeeds. A PostgreSQL major upgrade
(18 → 19) is not covered here; it needs `pg_upgrade` or dump and restore and gets its own ticket.

**cloudflared and the OS:** `sudo apt update && sudo apt upgrade` once a month (Docker and
cloudflared come from their own repositories, which unattended upgrades leave alone).
**verify:** `systemctl status cloudflared` is `active (running)` and the tunnel is Healthy.

**Disk usage:**

```sh
df -h / /var/lib/postgresql
sudo docker exec voidbinder-db psql -U postgres -c \
  "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database ORDER BY pg_database_size(datname) DESC"
```

Once `prices_daily` is a hypertable, `SELECT * FROM hypertable_columnstore_stats('prices_daily')`
shows how much the compression saves.

**Slow queries** (`pg_stat_statements`, per database):

```sh
sudo docker exec voidbinder-db psql -U postgres -d voidbinder -c \
  "SELECT calls, round(mean_exec_time::numeric, 1) AS mean_ms, left(query, 80) AS query
   FROM pg_stat_statements ORDER BY total_exec_time DESC LIMIT 10"
```

**Alerts (optional): disk above 80 % and backup age, as an Uptime Kuma push monitor.** Create a
**Push** monitor in Kuma with heartbeat interval 15 minutes and copy its push URL. The script
pushes only when everything is fine, so Kuma alerts on a full disk, a stale backup and a dead VPS
alike.

```sh
sudo install -m 600 /dev/null /etc/voidbinder-db-health.env
echo 'KUMA_PUSH_URL=https://<kuma-host>/api/push/<token>' | sudo tee /etc/voidbinder-db-health.env >/dev/null
sudo tee /usr/local/bin/voidbinder-db-health >/dev/null <<'EOF'
#!/bin/sh
# Pushes "up" to Uptime Kuma only when disks are below 80 % and the newest backup is under 36 h old.
set -eu
. /etc/voidbinder-db-health.env
for m in / /var/lib/postgresql; do
  use=$(df --output=pcent "$m" | tail -n 1 | tr -dc 0-9)
  [ "$use" -lt 80 ] || { echo "disk $m at $use %"; exit 1; }
done
last=$(docker exec voidbinder-db pgbackrest --stanza=voidbinder --output=json info | jq '.[0].backup[-1].timestamp.stop')
age=$(( $(date +%s) - last ))
[ "$age" -lt 129600 ] || { echo "newest backup is $age s old"; exit 1; }
curl -fsS -m 10 -o /dev/null "$KUMA_PUSH_URL?status=up&msg=OK"
EOF
sudo chmod 755 /usr/local/bin/voidbinder-db-health
echo '*/15 * * * * root /usr/local/bin/voidbinder-db-health >/dev/null' | sudo tee -a /etc/cron.d/voidbinder-db
```

**verify:** `sudo /usr/local/bin/voidbinder-db-health; echo $?` prints `0` and the Kuma monitor
turns green.

**Growing the additional disk.** OVH control panel → the VPS → **Additional disks → Increase the
disk size**, wait until the new size shows, then:

```sh
cd /opt/voidbinder-db && sudo docker compose down
sudo umount /var/lib/postgresql
sudo e2fsck -f /dev/sdb && sudo resize2fs /dev/sdb
sudo mount /var/lib/postgresql && sudo docker compose up -d
```

**verify:** `df -h /var/lib/postgresql` shows the new size and the container is `healthy` again.

## 9. Security notes

- Postgres has no public port: nothing is published by Docker and `ufw` allows only 22/tcp
  inbound. Workers reach it through the tunnel, Max through SSH.
- Every TCP login needs TLS and SCRAM (`pg_hba.conf`); each Hyperdrive user may only reach its own
  database, from the host side of the Docker network.
- `hyperdrive_dev` and `hyperdrive_prod` have DML rights only, no DDL: they cannot create, alter
  or drop anything. Schema changes go through `voidbinder_migrate` and the SSH tunnel.
- Secrets live on the VPS (`/opt/voidbinder-db/.env`, `/etc/pgbackrest/pgbackrest.conf`, the
  cloudflared unit, `/etc/voidbinder-db-health.env`, all root or UID 1000 only), in Cloudflare
  (the Hyperdrive configs) and in the password manager. None of them belong in this repository;
  the Hyperdrive and VPC service ids are not secrets.
- Backups in B2 are encrypted by pgBackRest before upload (`repo1-cipher-type`); the B2 key can
  touch only the one bucket.
- B2 holds the database backups, a provider separate from OVH (database) and Cloudflare (edge).
  App blobs (card images, catalog modules, raw dumps) stay in R2.
