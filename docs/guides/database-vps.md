# Database VPS runbook

How to set up and run the PostgreSQL + TimescaleDB server behind voidbinder.de
([ADR 0003](../adr/0003-price-history-storage.md)). One OVH VPS in Gravelines runs PostgreSQL 18
with TimescaleDB in Docker. Cloudflare Workers reach it only through a Cloudflare Tunnel, a Workers
VPC service and Hyperdrive. pgBackRest backs it up to Backblaze B2. The server has no public
Postgres port.

```text
Worker ── Hyperdrive ── Workers VPC service ── Tunnel ── cloudflared (host) ── 172.30.0.10:5432 (container)
your workstation ── SSH tunnel ── 172.30.0.10:5432 (migrations only)
container ── pgBackRest ── Backblaze B2 (EU Central)
```

**Who this is for.** You have installed Docker before and logged in to a server over SSH, but you
have not run PostgreSQL in production and do not know Cloudflare Tunnel, Hyperdrive or pgBackRest.
Every step says what it does, how to check that it worked, and what to do when it did not. Plan
about three and a half hours, plus the wait for OVH to deliver the server.

The runbook uses the project's own names: the domain `voidbinder.de`, the Cloudflare account
`152a1fcd0eebb96d1bc30d14b5a6af58` and the dev Worker URL
`voidbinder-site-dev.frisson.workers.dev`. If you run your own instance, use your domain, your
account ID (also in `apps/site/wrangler.jsonc`) and your Worker URL instead.

## Contents

| Section                                                                                             | Time                      |
| --------------------------------------------------------------------------------------------------- | ------------------------- |
| [0. Before you start](#0-before-you-start)                                                          | 20 min                    |
| [1. Order and prepare](#1-order-and-prepare)                                                        | 10 min, plus OVH delivery |
| [2. Base system](#2-base-system)                                                                    | 20 min                    |
| [3. Additional disk](#3-additional-disk)                                                            | 10 min                    |
| [4. Docker and PostgreSQL](#4-docker-and-postgresql)                                                | 40 min                    |
| [5. Roles and databases](#5-roles-and-databases)                                                    | 15 min                    |
| [6. Cloudflare Tunnel, Workers VPC and Hyperdrive](#6-cloudflare-tunnel-workers-vpc-and-hyperdrive) | 30 min                    |
| [7. Backups with pgBackRest to Backblaze B2](#7-backups-with-pgbackrest-to-backblaze-b2)            | 40 min                    |
| [8. Operations](#8-operations)                                                                      | 10 min now, then monthly  |
| [9. Security notes](#9-security-notes)                                                              | 5 min                     |
| [10. Done](#10-done)                                                                                | 10 min                    |

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

## 0. Before you start

This section gets your workstation ready and explains the pieces. The most important part is the
SSH key: section 2 switches off password login, so a working key login is your only way in
afterwards. Do not skip the key test at the end of section 1.

### How to read this runbook

- Run every step in order. Each one ends with **verify:** and the output to expect. Do not go on
  until the verify step matches.
- Each block says where it runs: **on the VPS** (logged in over SSH as `debian`) or **on the
  workstation** (your own computer). Workstation commands are written for a POSIX shell: the
  Terminal on macOS, a Linux shell, or WSL on Windows. The SSH key steps also cover plain Windows
  PowerShell.
- `<…>` marks a value you fill in. Each one is explained where it first appears and listed in the
  table below. Type the value without the angle brackets.
- Shell variables such as `TLS`, `IMAGE` or `DRILL` live only in the current terminal. If you
  reconnect in the middle of a step, set them again.
- Boxes marked **Warning** come before every step that can lock you out or destroy data. Read them
  before you run the command, not after.

### What you need

- **A workstation** with a terminal, `ssh`, `git`, Node.js 24.16 or newer and a clone of this
  repository. In the clone, run `corepack enable` and `pnpm install --frozen-lockfile` once;
  sections 5 and 6 use the repository's `pnpm` scripts and `wrangler`.
- **An OVHcloud account** to order the VPS.
- **A Cloudflare account** that holds the `voidbinder.de` zone. On the workstation, run
  `pnpm exec wrangler login` in `apps/site`. Creating VPC services needs the role Connectivity
  Directory Admin (Super Administrator includes it).
- **A Backblaze B2 account** in the **EU Central** region. The region is fixed when the account is
  created; a US account cannot hold EU buckets, so create a new account if yours is US.
- **A password manager** with a synced vault, so the secrets survive the loss of both the VPS and
  the workstation.
- Optional: an **Uptime Kuma** instance for the alert in section 8.

### Where secrets live

Every secret gets one named entry in the password manager, in a folder called `Voidbinder DB`.
Secrets never go into this repository, and as far as possible never into your shell history: the
commands below read them with `read -s` (nothing is echoed, nothing is saved in the history) or
write them into files with mode 600 that only root or the database user can read.

| Value                                      | Placeholder                                           | Where it comes from                                       | Password manager entry                                    |
| ------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| VPS IPv4 address                           | `<vps-ip>`                                            | OVH control panel, the VPS's page (also in the OVH email) | not secret; note it in `VPS`                              |
| SSH key passphrase                         |                                                       | you choose it in this section                             | `SSH key passphrase`                                      |
| `debian` console password                  |                                                       | you set it in section 2                                   | `debian console`                                          |
| Postgres superuser password                |                                                       | generated in section 4                                    | `postgres superuser`                                      |
| Role passwords                             |                                                       | generated in section 5                                    | `voidbinder_migrate`, `hyperdrive_dev`, `hyperdrive_prod` |
| Tunnel token                               |                                                       | Cloudflare dashboard, section 6                           | `tunnel token`                                            |
| Tunnel ID                                  | `<tunnel-id>`                                         | Cloudflare dashboard, section 6                           | not secret; note it in `tunnel token`                     |
| VPC service ID                             | `<vpc-service-id>`                                    | output of `wrangler vpc service create`, section 6        | not secret; note it in `tunnel token`                     |
| B2 bucket, region, key ID, application key | `<bucket>`, `<region>`, `<keyID>`, `<applicationKey>` | Backblaze web UI, section 7                               | `B2 backup key`                                           |
| pgBackRest encryption passphrase           | `<passphrase>`                                        | generated in section 7                                    | `pgBackRest cipher pass`                                  |
| Uptime Kuma push URL                       | `<kuma-host>`, `<token>`                              | Uptime Kuma, section 8                                    | `Kuma push URL`                                           |

The B2 key and the pgBackRest passphrase are the two you cannot lose: without them no backup can
ever be restored.

### What the pieces are

- **VPS:** a virtual server you rent; here an OVH machine in Gravelines, France.
- **Docker:** runs PostgreSQL in a container, so the database version is one image tag you can
  change and roll back.
- **TimescaleDB:** a PostgreSQL extension for time series; it stores the price history compactly.
  The image ships PostgreSQL, TimescaleDB and pgBackRest together.
- **Cloudflare Tunnel:** a small program on the VPS (`cloudflared`) that opens an outbound
  connection to Cloudflare. Cloudflare reaches the database through it, so the VPS needs no open
  port for the database.
- **Workers VPC:** tells Cloudflare which address behind the tunnel to reach (the database
  container) and which tunnel to use.
- **Hyperdrive:** Cloudflare's connection pool for Postgres. The Worker talks to Hyperdrive,
  Hyperdrive holds a few long-lived connections to the database through the Workers VPC service.
- **pgBackRest:** the backup tool. It takes full and incremental backups and ships the
  write-ahead log (WAL, PostgreSQL's change journal) continuously, so you can restore to any
  moment in the last weeks.
- **Backblaze B2:** S3-compatible storage at a different provider than OVH, where the encrypted
  backups go.
- **Object Lock:** a B2 setting that makes stored files undeletable for a fixed time, even for
  someone who holds the key. It protects the backups if the VPS is ever taken over.

### Create an SSH key pair

SSH logs you in with a key pair: the private key stays on the workstation, the public key goes on
the server. Skip this if you already have an `id_ed25519` key you want to use.

On macOS or Linux, in the Terminal:

```sh
ssh-keygen -t ed25519 -C "your-name@your-workstation"
```

On Windows 10 or 11, in PowerShell (the OpenSSH client is built in):

```powershell
ssh-keygen -t ed25519 -C "your-name@your-workstation"
```

The `-C` text is only a label so you recognise the key later. Accept the default file location
and set a passphrase (store it in the password manager entry `SSH key passphrase`). This creates
two files: `~/.ssh/id_ed25519` (private, never share it) and `~/.ssh/id_ed25519.pub` (public;
on Windows both are in `C:\Users\<you>\.ssh\`).

Show the public key so you can copy it:

```sh
cat ~/.ssh/id_ed25519.pub                          # macOS, Linux
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub   # Windows PowerShell
```

**verify:** the output is one line starting with `ssh-ed25519 AAAA` and ending with your label.

The public key goes into the OVH order form in section 1. If you already have a VPS, or forgot it
in the order, section 1 shows how to copy it on afterwards.

## 1. Order and prepare

This step orders the server and proves that you can log in with your key. Everything later
depends on that key login, because section 2 turns password login off.

Order at OVHcloud:

- [ ] **VPS-2**: 4 vCores, 8 GB RAM, 75 GB NVMe system disk.
- [ ] Location **Gravelines (France)**.
- [ ] Image **Debian 13** (this runbook). Ubuntu 24.04 LTS works too: the login user is then
      `ubuntu` instead of `debian`, and the Docker repository URL changes (section 4).
- [ ] Option **additional disk, 50 GB**.
- [ ] Option **snapshot**. A snapshot covers the system disk only, not the additional disk: it
      saves the OS, Docker and the config under `/opt` and `/etc`, while the data is covered by
      pgBackRest (section 7).
- [ ] Your **SSH public key** in the order form (the `ssh-ed25519 …` line from section 0), so the
      server boots with key login.

When OVH reports the VPS as delivered, note its IPv4 address from the control panel. That is
`<vps-ip>` everywhere below.

**If you did not add the key in the order:** OVH gives you a password for the `debian` user
instead (by email or in the control panel). Copy your key on with it once, from the workstation:

```sh
ssh-copy-id -i ~/.ssh/id_ed25519.pub debian@<vps-ip>   # macOS, Linux
```

Windows PowerShell has no `ssh-copy-id`; this does the same:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | ssh debian@<vps-ip> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**Test the key login.** This command forbids password login on the client side, so it can only
succeed with the key:

```sh
ssh -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no debian@<vps-ip>
```

**verify:** the OVH control panel shows the VPS as active with one additional disk, and the
command above logs you in to a `debian@…` prompt without asking for a password (it may ask for the
key's passphrase; that is the key, not the server password). Type `exit` to leave.

**If it fails:**

- `Permission denied (publickey)`: the server does not have your public key, or SSH offers a
  different key. Run `ssh-copy-id` as above, or name the key with
  `ssh -i ~/.ssh/id_ed25519 debian@<vps-ip>`. Check the user name: `debian` on Debian, `ubuntu` on
  Ubuntu, never `root`.
- `Connection timed out` or `Connection refused`: the VPS is still installing or rebooting, or the
  IP is wrong. Wait a few minutes and compare the IP with the control panel.
- `REMOTE HOST IDENTIFICATION HAS CHANGED`: the VPS was reinstalled and has a new host key. Remove
  the old one with `ssh-keygen -R <vps-ip>` and connect again.

## 2. Base system

This step updates the system, closes everything except SSH, and installs automatic security
updates. Two of the steps (SSH hardening and the firewall) can lock you out if done in the wrong
order, so each has a warning and a test.

All commands in this section run **on the VPS** as `debian` with `sudo`.

```sh
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone UTC
```

**Set a console password for `debian`.** The OVH KVM console (control panel → your VPS →
**KVM**) is a screen and keyboard on the server that works even when SSH does not. It asks for a
password, and turning off password login for SSH below does not affect it. Give `debian` a password
and store it in the password manager entry `debian console`:

```sh
sudo passwd debian
```

**verify:** `sudo passwd -S debian` prints a line with `P` in the second field (password set).

**If you lock yourself out of SSH**, this is the way back in: open the KVM console, log in as
`debian` with that password, and undo the last change (for example
`sudo rm /etc/ssh/sshd_config.d/10-voidbinder.conf && sudo systemctl reload ssh`, or
`sudo ufw disable`). If even that fails, OVH's rescue mode (control panel → your VPS → **Reboot in
rescue mode**) boots a separate system from which you can mount the disk and fix the file.

**SSH: keys only, no root login.** With passwords off, nobody can guess their way in; only holders
of an authorised key can log in.

> [!WARNING]
> **Before you run this:** the key test at the end of section 1 must have worked. Open a second
> terminal now, log in to the VPS there too, and leave it open until the verify step is done. The
> open session keeps working even if the new setting is wrong, so you can undo it from there.

```sh
sudo tee /etc/ssh/sshd_config.d/10-voidbinder.conf >/dev/null <<'EOF'
PasswordAuthentication no
KbdInteractiveAuthentication no
PermitRootLogin no
EOF
sudo sshd -t && sudo systemctl reload ssh
```

`sshd -t` checks the configuration first; the reload only runs when the check passes.

**verify:** `sudo sshd -T | grep -E '^(passwordauthentication|kbdinteractiveauthentication|permitrootlogin) '`
prints `passwordauthentication no`, `kbdinteractiveauthentication no`, `permitrootlogin no`. Then,
from a **third** terminal on the workstation, log in again with
`ssh debian@<vps-ip>`: it must work. Only then close the second session. Finally check that
passwords are really refused:

```sh
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password debian@<vps-ip>
```

prints `Permission denied (publickey).` without asking for a password.

**If it fails:**

- `sshd -T` still prints `passwordauthentication yes`: another file in `/etc/ssh/sshd_config.d/`
  sets it first (SSH uses the first value it reads, in file name order). Check with
  `grep -ri passwordauthentication /etc/ssh/sshd_config.d/`; the `10-` prefix sorts before cloud
  images' `50-cloud-init.conf`, so rename any file that sorts earlier.
- The new login is refused: use the still-open second session (or the KVM console) to remove
  `/etc/ssh/sshd_config.d/10-voidbinder.conf`, reload SSH, and go back to the key test in
  section 1.

**Firewall: deny everything inbound except SSH.** Port 5432 is never opened; Postgres is reached
through the tunnel. Outbound stays open (cloudflared needs UDP 7844 out for QUIC, pgBackRest needs
HTTPS out).

> [!WARNING]
> **Before you run this:** `ufw enable` blocks every inbound port that has no rule, including SSH.
> The `allow 22/tcp` line must run before `ufw enable`, exactly in the order below. Keep a second
> SSH session open again. `ufw enable` warns that it may disrupt existing SSH connections; answer
> `y` only after `sudo ufw show added` lists `ufw allow 22/tcp`.

```sh
sudo apt install -y ufw
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 22/tcp
sudo ufw show added
sudo ufw enable
```

**verify:** `sudo ufw status verbose` shows `Status: active`,
`Default: deny (incoming), allow (outgoing)` and one rule `22/tcp ALLOW IN Anywhere` (plus its v6
twin). Then log in from a new terminal; it must work.

**If it fails:** if the new login hangs, run `sudo ufw allow 22/tcp` in the open session (or
`sudo ufw disable` in the KVM console) and check `sudo ufw status` again.

**Unattended security upgrades.** Debian then installs security fixes every day without you.

```sh
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure -plow unattended-upgrades   # answer "Yes"
```

**verify:** `cat /etc/apt/apt.conf.d/20auto-upgrades` shows
`APT::Periodic::Update-Package-Lists "1";` and `APT::Periodic::Unattended-Upgrade "1";`.

**Time sync.** Backups, TLS and the tunnel all need a correct clock.

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

This step formats the 50 GB additional disk and mounts it where PostgreSQL keeps its data. The
data then lives apart from the system disk, so you can grow it or reinstall the system without
touching it. Formatting erases a disk completely, so the main risk here is picking the wrong one.

All commands run **on the VPS**. Find the disk: the 50 GB one without partitions or mount point.

```sh
lsblk -o NAME,SIZE,TYPE,FSTYPE,MOUNTPOINTS
```

**verify:** one disk of 50G (usually `sdb`) has no children and no `FSTYPE`. The commands below use
`/dev/sdb`; replace it everywhere if yours differs. The system disk (usually `sda`, 75G) has
children such as `sda1` mounted at `/`; never use that one.

**If it fails:**

- No 50G disk: the option is not delivered yet. Check its status on the VPS's page in the OVH
  control panel; once it is active, `sudo reboot` and run `lsblk` again.
- The disk has another name (`vdb`, `nvme1n1`): use that name in every command below.
- The 50G disk already shows an `FSTYPE` or a mount point: stop and find out why before you
  format anything. It may be the wrong disk.

> [!WARNING]
> **Before you run this:** `mkfs.ext4` erases the disk you name, without asking twice if it is
> empty. Run `lsblk /dev/sdb` and check that it prints 50G and no mount point. If it prints 75G or
> shows `/`, you have the system disk; stop.

Format it as a whole-disk ext4 (no partition, so growing it later is one `resize2fs`):

```sh
sudo mkfs.ext4 -L pgdata /dev/sdb
sudo mkdir -p /var/lib/postgresql
```

**Mount it at every boot.** `/etc/fstab` lists the disks the system mounts at boot. A wrong line
there can stop the VPS from booting normally, so make a copy first and test the new line before
any reboot.

> [!WARNING]
> **Before you run this:** keep the backup copy below. The test after it (`findmnt --verify` and
> `mount -a`) must pass before you reboot. If the VPS ever fails to boot after this step, log in on
> the KVM console and run `sudo cp /etc/fstab.bak /etc/fstab`.

```sh
sudo cp /etc/fstab /etc/fstab.bak
UUID=$(sudo blkid -s UUID -o value /dev/sdb); echo "$UUID"
echo "UUID=$UUID /var/lib/postgresql ext4 defaults,noatime,nofail 0 2" | sudo tee -a /etc/fstab
sudo systemctl daemon-reload
sudo findmnt --verify
sudo mount -a
```

The `echo "$UUID"` line must print an ID such as `3f2c…`; if it prints an empty line, stop,
restore `/etc/fstab.bak` and check the disk name. `findmnt --verify` checks every fstab line and
must print `Success, no errors or warnings detected` or a summary with `0 parse errors, 0 errors`
(warnings are fine); `mount -a` mounts everything listed and must print nothing.

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

**If it fails:** if `findmnt` shows nothing after the reboot, run `sudo mount -a` and read its
error. The usual cause is a typo in the fstab line; compare it with
`sudo blkid /dev/sdb` and fix it with `sudoedit /etc/fstab`.

## 4. Docker and PostgreSQL

This step installs Docker, prepares the TLS certificate and the access rules, and starts the
database container. When it is done, PostgreSQL runs on the additional disk, accepts only
encrypted logins, and has no port on the host.

All commands run **on the VPS**.

**Docker Engine from Docker's repository** (commands from docs.docker.com, Debian). Debian's own
`docker.io` package lags behind; Docker's repository has the current stable release.

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

**Directory layout.** Config under `/opt/voidbinder-db`, the TLS files in a folder only the
database user can read, the backup config under `/etc/pgbackrest`.

```sh
sudo install -d -m 755 /opt/voidbinder-db
sudo install -d -o 1000 -g 1000 -m 700 /opt/voidbinder-db/tls
sudo install -d -m 700 /etc/pgbackrest
```

**TLS certificate.** Hyperdrive always speaks TLS to Postgres. The default is a Cloudflare Origin
CA certificate for the name `db.voidbinder.de` (no DNS record needed). It is valid for 15 years, so
nothing renews, and Workers VPC trusts Origin CA certificates
([docs](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/#supported-tls-certificates)),
so the VPC service in section 6 runs with certificate verification on. The private key is made on
the VPS and never leaves it; Cloudflare signs only the request.

```sh
TLS=/opt/voidbinder-db/tls
sudo openssl req -new -newkey ec -pkeyopt ec_paramgen_curve:prime256v1 -nodes \
  -subj "/CN=db.voidbinder.de" -keyout $TLS/server.key -out $TLS/server.csr
sudo cat $TLS/server.csr
```

In the Cloudflare dashboard open the `voidbinder.de` zone → **SSL/TLS → Origin Server → Create
Certificate**, choose **Use my private key and CSR**, paste the request (the whole block from
`-----BEGIN CERTIFICATE REQUEST-----` to `-----END CERTIFICATE REQUEST-----`), keep the hostname
`db.voidbinder.de`, validity **15 years**, and **Create**. Copy the **Origin Certificate** (the PEM
block) and save it on the VPS:

```sh
sudo tee $TLS/server.crt >/dev/null   # paste the certificate, press Enter, then Ctrl-D
sudo rm $TLS/server.csr
sudo chown 1000:1000 $TLS/server.key $TLS/server.crt
sudo chmod 600 $TLS/server.key && sudo chmod 644 $TLS/server.crt
```

**verify:** `sudo openssl x509 -in /opt/voidbinder-db/tls/server.crt -noout -subject -issuer -enddate`
prints `subject=CN=db.voidbinder.de`, an issuer naming `CloudFlare Origin SSL Certificate Authority`
and a `notAfter` fifteen years ahead, and
`diff <(sudo openssl x509 -in /opt/voidbinder-db/tls/server.crt -noout -pubkey) <(sudo openssl pkey -in /opt/voidbinder-db/tls/server.key -pubout)`
prints nothing (certificate and key belong together).

**If it fails:** `unable to load certificate` means the paste is incomplete; repeat the `tee`
step and paste the whole block including the `BEGIN` and `END` lines. If `diff` prints lines, the
certificate was made for another request; create the certificate again from this `server.csr`
(if you already deleted it, start over from the `openssl req` line).

**Fallback: self-signed.** If you cannot use the Origin CA, a self-signed certificate encrypts the
last hop from cloudflared to the container (the hop from Cloudflare to the VPS is already inside
the tunnel), but Workers VPC does not trust it, so the VPC service in section 6 must run with
`--cert-verification-mode disabled`.

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

**Alternative: Let's Encrypt through DNS-01** (publicly trusted, no inbound port needed, renews
every 60 days by itself). First the deploy hook, `/usr/local/bin/voidbinder-db-cert` (mode 755),
which copies the renewed files and reloads Postgres (it re-reads certificates on reload):

```sh
sudo tee /usr/local/bin/voidbinder-db-cert >/dev/null <<'EOF'
#!/bin/sh
set -eu
install -o 1000 -g 1000 -m 644 "$RENEWED_LINEAGE/fullchain.pem" /opt/voidbinder-db/tls/server.crt
install -o 1000 -g 1000 -m 600 "$RENEWED_LINEAGE/privkey.pem" /opt/voidbinder-db/tls/server.key
docker exec voidbinder-db psql -U postgres -Atc 'SELECT pg_reload_conf()'
EOF
sudo chmod 755 /usr/local/bin/voidbinder-db-cert
```

then certbot (the hook also runs after the first issuance; before the container exists its
`docker exec` fails, so request the certificate after section 4 is done or run the two `install`
lines by hand). The token is a Cloudflare API token (dashboard → **My Profile → API Tokens →
Create Token**) with **Zone > DNS > Edit** for `voidbinder.de` only; store it in the password
manager entry `certbot DNS token`.

```sh
sudo apt install -y certbot python3-certbot-dns-cloudflare
sudo install -m 600 /dev/null /etc/letsencrypt/cloudflare.ini
read -rsp 'Cloudflare DNS API token: ' CF_TOKEN; echo
echo "dns_cloudflare_api_token = $CF_TOKEN" | sudo tee /etc/letsencrypt/cloudflare.ini >/dev/null
unset CF_TOKEN
sudo certbot certonly --dns-cloudflare --dns-cloudflare-credentials /etc/letsencrypt/cloudflare.ini \
  -d db.voidbinder.de --deploy-hook /usr/local/bin/voidbinder-db-cert
```

The VPC service uses `--cert-verification-mode verify_ca` with this certificate too (section 6).

**Client authentication: `/opt/voidbinder-db/pg_hba.conf`.** This file decides who may log in to
which database from where. cloudflared and the SSH tunnel both reach the container from the host
side of the Docker network, `172.30.0.1`. Every TCP login needs TLS and SCRAM (password check
without sending the password); anything that matches no line is rejected. Inside the container the
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
`peer` only, so the password is never used. This command generates it straight into the file, so
it never appears on screen or in the history:

```sh
sudo install -m 600 /dev/null /opt/voidbinder-db/.env
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')" | sudo tee /opt/voidbinder-db/.env >/dev/null
```

Copy it into the password manager entry `postgres superuser` with `sudo cat /opt/voidbinder-db/.env`.

**pgBackRest config placeholder.** The container mounts `/etc/pgbackrest/pgbackrest.conf`; create
it now and fill it in section 7. Until the stanza exists, WAL archiving fails and Postgres keeps
the WAL and retries; that is expected for the minutes in between.

```sh
sudo install -o 1000 -g 1000 -m 600 /dev/null /etc/pgbackrest/pgbackrest.conf
```

**`/opt/voidbinder-db/docker-compose.yml`.** Create the file with `sudoedit
/opt/voidbinder-db/docker-compose.yml` and paste the content below. Memory settings for 8 GB RAM.
The image starts as `postgres` (UID 1000); `NO_TS_TUNE` stops `timescaledb-tune` from rewriting
the config, so the command line below is the whole tuning. `-c` options override
`postgresql.conf` in the data directory.

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
      - -c
      - log_parameter_max_length=0
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
at most five minutes of writes are not yet in B2. `log_parameter_max_length=0` keeps bind
parameters (such as email addresses) out of the slow-query log. `logging: local` rotates the
container log (5 × 20 MB).

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

**If it fails:** read the last lines of the log first, `sudo docker logs voidbinder-db --tail 50`.

- `docker compose up` stops with `bind source path does not exist`: a file or folder from this
  section is missing, or the disk is not mounted (`findmnt /var/lib/postgresql`). Create what is
  named and start again.
- The container restarts or stays `unhealthy` with `permission denied` or `invalid permissions`
  in the log: the data directory is not `1000:1000 700`. Fix it with
  `sudo chown 1000:1000 /var/lib/postgresql/voidbinder && sudo chmod 700 /var/lib/postgresql/voidbinder`.
- `private key file … has group or world access` or `could not load server certificate file`: run
  the `chown` and `chmod` lines of the TLS step again.
- `could not load pg_hba.conf` or `invalid connection type`: a typo in `pg_hba.conf`; compare it
  with the block above.
- Log lines about `archive-push` failing are expected until section 7 and do not make the
  container unhealthy.

## 5. Roles and databases

This step creates the two databases and the logins that use them. The app logins can read and
write data but cannot change the schema, so a leaked app password cannot drop a table. Schema
changes run from the workstation through a short-lived SSH tunnel.

| Role                 | Login | Rights                                                                  |
| -------------------- | ----- | ----------------------------------------------------------------------- |
| `voidbinder_migrate` | yes   | Owns both databases; runs `pnpm --filter site db:migrate` (DDL).        |
| `voidbinder_app`     | no    | Group role: `SELECT, INSERT, UPDATE, DELETE` on the app tables, no DDL. |
| `hyperdrive_dev`     | yes   | Member of `voidbinder_app`, may connect to `voidbinder_dev` only.       |
| `hyperdrive_prod`    | yes   | Member of `voidbinder_app`, may connect to `voidbinder` only.           |

Both databases live on this instance: `voidbinder_dev` for the `dev` environment, `voidbinder`
for `prod`.

**On the VPS:**

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
a log or the shell history. For each role, first generate a password with
`openssl rand -base64 32 | tr -d '/+='` (letters and digits only, so it is safe inside a
connection URL), save it in the password manager entry with the role's name, then paste it twice
at the prompt:

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
  fails with `ERROR:  permission denied for schema public`. This error is the expected result.

**Apply the app migrations from the workstation.** The migrations create the app's tables. They
run from a clone of the repository on the workstation and reach the database through an SSH
tunnel: a port on your workstation that SSH forwards to the container. Open the tunnel in one
terminal **on the workstation** (local port 15432, since 5434 is the local Docker Postgres):

```sh
ssh -N -L 15432:172.30.0.10:5432 debian@<vps-ip>
```

The terminal shows nothing and seems to hang; that is the open tunnel. Run the migrations in a
second terminal, from the repository root. `read -rs` asks for the `voidbinder_migrate` password
without showing it. `sslmode=no-verify` keeps TLS on without checking the certificate (the Origin
CA and the self-signed certificate are not in your workstation's trust store); SSH already
authenticates the server.

```sh
read -rs PGPW   # voidbinder_migrate password
DATABASE_URL="postgres://voidbinder_migrate:$PGPW@localhost:15432/voidbinder_dev?sslmode=no-verify" \
  pnpm --filter site db:migrate
DATABASE_URL="postgres://voidbinder_migrate:$PGPW@localhost:15432/voidbinder?sslmode=no-verify" \
  pnpm --filter site db:migrate
unset PGPW
```

Close the tunnel with Ctrl-C afterwards.

**verify:** both runs end without an error, and on the VPS
`sudo docker exec voidbinder-db psql -U postgres -d voidbinder_dev -c 'SET ROLE hyperdrive_dev; SELECT count(*) FROM waitlist_signups'`
prints `0` (the app role can read the migrated table). Same for `-d voidbinder` with
`hyperdrive_prod`.

**If it fails:**

- `ECONNREFUSED` or `connect … 15432`: the tunnel terminal is closed or shows an error. Start it
  again and leave it open.
- `password authentication failed`: the password does not match. Set it again with `\password` on
  the VPS and copy it from the password manager.
- `no pg_hba.conf entry for host "172.30.0.1"`: the user or database name is misspelled, or
  `sslmode` is missing; compare with the `pg_hba.conf` lines in section 4.

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

This step connects Cloudflare to the database without opening a port. cloudflared on the VPS
dials out to Cloudflare; the Workers VPC service names the container behind that tunnel; Hyperdrive
pools connections to it for the Worker. At the end, a real request to the deployed `dev` Worker
writes a row into the database.

**Create the tunnel** (the Voidbinder one; do not reuse a tunnel of another project). In the
Cloudflare dashboard: Workers & Pages → **Workers VPC** → **Tunnels** → **Create**, name
`voidbinder-db`, **Save tunnel**, choose Debian / 64-bit and copy the token (the `eyJ…` string in
the install command; do not run the dashboard's install command as is). Save the token in the
password manager entry `tunnel token`. Note the **tunnel ID** (a UUID such as
`6ff42ae2-…`) from the tunnel's page; it is `<tunnel-id>` below.

**Install cloudflared as a systemd service** (repository from pkg.cloudflare.com, Debian/Ubuntu
"any"), **on the VPS**. `read -rs` waits for you to paste the token and shows nothing:

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

Since cloudflared 2026.7.2 the service install writes the token to `/etc/cloudflared/token` (root,
mode 0600) and the unit runs `cloudflared tunnel run --token-file /etc/cloudflared/token`, so the
token is neither on the command line nor in the unit file. Unattended
upgrades install Debian security updates only; cloudflared is updated with the monthly
`apt upgrade` in section 8.

**verify:**

- `cloudflared --version` prints `cloudflared version 2026.10.0` or newer.
- `systemctl status cloudflared` shows `active (running)`, and
  `journalctl -u cloudflared --since -5min | grep -i 'registered tunnel connection'` shows
  connections with `protocol=quic` (Workers VPC needs QUIC, UDP 7844 out).
- `sudo stat -c '%a %U' /etc/cloudflared/token` prints `600 root`.
- The tunnel shows **Healthy** in the dashboard.

**If it fails:** read the log with `journalctl -u cloudflared --since -10min`.

- `Unauthorized`, `invalid token` or the service does not start: the token was cut off while
  pasting. Run `sudo cloudflared service uninstall`, then the `read -rs` and `service install`
  lines again with the full token from the dashboard.
- Connections register with `protocol=http2` instead of `quic`, or `failed to dial … quic`:
  outbound UDP 7844 is blocked. `ufw` allows all outbound traffic by default
  (`sudo ufw status verbose` must show `allow (outgoing)`); if you enabled OVH's network firewall
  in the control panel, allow outbound UDP 7844 there.
- TLS or certificate errors in the log: the clock is wrong. Check `timedatectl` (section 2).

No public hostname and no private network route are needed: the VPC service is the route. The
host reaches the container at `172.30.0.10` directly.

**Create the Workers VPC service** **on the workstation**, in `apps/site` (so wrangler picks up
`account_id` `152a1fcd0eebb96d1bc30d14b5a6af58` from `wrangler.jsonc`):

```sh
cd apps/site
pnpm exec wrangler vpc service create voidbinder-psql \
  --type tcp --tcp-port 5432 --app-protocol postgresql \
  --tunnel-id <tunnel-id> --ipv4 172.30.0.10 \
  --cert-verification-mode verify_ca
```

`verify_ca` checks the certificate chain (Origin CA or Let's Encrypt, section 4) and skips the host
name check, because the service addresses the container by IP, not by name. With the self-signed
fallback use `--cert-verification-mode disabled` instead, or switch later with
`pnpm exec wrangler vpc service update <vpc-service-id> --name voidbinder-psql --type tcp --tcp-port 5432 --app-protocol postgresql --tunnel-id <tunnel-id> --ipv4 172.30.0.10 --cert-verification-mode <mode>`,
where `<mode>` is `verify_ca` or `disabled`.

**verify:** the command prints a service ID; this is `<vpc-service-id>` below (note it next to the
tunnel ID). `pnpm exec wrangler vpc service list` lists `voidbinder-psql` with type `tcp`, port
5432 and the tunnel ID.

**Create one Hyperdrive config per environment**, caching off (the waitlist reads rows right after
writing them), at most 10 connections each. Hyperdrive connects once to check the credentials, so
section 5 must be done and the tunnel must be Healthy. Each `read -rs` asks for one password
from the password manager.

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

Each command prints an `id`. Put them into `apps/site/wrangler.jsonc`: in `env.dev`, replace the
commented-out `"hyperdrive"` line with the real entry and the `dev` id; in `env.prod`, replace the
all-zero `id` in `hyperdrive[0]` with the `prod` id. Leave the top-level entry (local Docker
Postgres) as it is. The ids are not secrets; commit them in a small PR.

**verify:**

- `pnpm exec wrangler hyperdrive list` lists `voidbinder-dev` and `voidbinder-prod` with the
  ids, origin `voidbinder-psql` / the VPC service ID, and caching disabled.
- End to end: `wrangler dev` uses `localConnectionString` and never goes through Hyperdrive, so
  test the deployed `dev` Worker. Deploy it with `pnpm --filter site deploy:dev`, then send a
  waitlist sign-up with an address you can read in place of `<your address>`:

  ```sh
  curl -s -X POST https://voidbinder-site-dev.frisson.workers.dev/api/waitlist \
    -H 'Content-Type: application/json' \
    -d '{"email":"<your address>","locale":"en","consent":true,"website":""}'
  ```

  answers `{"status":"pending"}`, the confirmation mail arrives, and on the VPS
  `sudo docker exec voidbinder-db psql -U postgres -d voidbinder_dev -Atc 'SELECT status FROM waitlist_signups'`
  prints `pending`. `SELECT usename, ssl FROM pg_stat_ssl JOIN pg_stat_activity USING (pid) WHERE usename LIKE 'hyperdrive%'`
  shows Hyperdrive's pooled connections with `ssl = t`. Repeat for `prod` once it goes live.

**If it fails:**

- `hyperdrive create` reports `password authentication failed`: the password differs from the one
  set with `\password` in section 5. Set it again there and repeat.
- `no pg_hba.conf entry`: the database and user do not match a `pg_hba.conf` line (for example
  `hyperdrive_dev` with `voidbinder`). Check the names in the command.
- A certificate or TLS error: the VPC service verifies a certificate the container does not have.
  With the self-signed fallback, switch the service to `disabled` with the `update` command above.
- A timeout or connection error: the tunnel is not Healthy, or `<tunnel-id>` or the IP in the VPC
  service is wrong. Check `pnpm exec wrangler vpc service list` against the dashboard.
- The `curl` call returns an error page instead of `{"status":"pending"}`: the deployed Worker has
  no Hyperdrive id yet. Check `wrangler.jsonc`, deploy again, and watch the Worker's errors with
  `pnpm exec wrangler tail --env dev` while you repeat the request.

## 7. Backups with pgBackRest to Backblaze B2

This step makes sure the data survives the loss of the VPS. pgBackRest runs inside the database
container (the image ships it); it reaches Postgres through the Unix socket and B2 through its own
S3 client. Plan: a full backup every Sunday, an incremental one on the other days, WAL archived
continuously, four full backups kept (about four weeks of point-in-time recovery). The restore
drill at the end proves the backups can actually be restored.

**Bucket and key in B2** (web UI, EU Central account):

1. **Buckets → Create a Bucket**: a globally unique name such as
   `voidbinder-db-backup-<random>`, where `<random>` is a few random letters or digits so the name
   is not taken. **Private**, **Enable Object Lock** on (set it when the bucket is created, default
   retention needs it; it can never be switched off again). This name is `<bucket>`.
2. On the bucket, set the **Default Retention** of Object Lock: mode **Governance**, **45 days**
   (longer than the backup window: four weekly full backups plus the incrementals of the newest
   one span up to five weeks). This is what keeps the backups alive when the VPS is compromised:
   the VPS holds the B2 key, and without Object Lock an attacker with that key deletes the
   database and all backups in one go. A locked file cannot be deleted or overwritten for 45
   days, not even with the key; never give the application key the `bypassGovernance`
   capability. pgBackRest's own expiry still works: its deletes only hide the file, and the
   lifecycle rule below removes it once the lock has lapsed, so expired backups stay stored and
   billed for up to 45 days longer. Docs:
   [Backblaze Object Lock](https://www.backblaze.com/docs/cloud-storage-object-lock).
3. On the bucket, **Lifecycle Settings → Keep only the last version of the file**. B2 keeps old
   versions by default; without this rule the files pgBackRest expires would still be stored and
   billed. Add no other lifecycle rule, retention is pgBackRest's job.
4. Note the bucket's **Endpoint**, for example `s3.eu-central-003.backblazeb2.com`. The region is
   the part between `s3.` and `.backblazeb2.com` (`eu-central-003`); this is `<region>`.
5. **Application Keys → Add a New Application Key**: name `voidbinder-pgbackrest`, **Allow access
   to Bucket(s)**: only the new bucket, **Type of Access: Read and Write**, leave **Allow List All
   Bucket Names** off (pgBackRest does not list buckets). Copy `keyID` (this is `<keyID>`) and
   `applicationKey` (this is `<applicationKey>`); the key is shown only once. Save both, with the
   bucket name and region, in the password manager entry `B2 backup key`.

> [!WARNING]
> **Never delete backup files in the bucket by hand**, and never delete old backups to save space.
> pgBackRest removes expired backups by itself (`repo1-retention-full`), and it needs every file of
> a backup and the WAL in between to restore. A file deleted by hand can make every later backup
> unusable without any error until the day you restore.

**Config.** First generate the encryption passphrase and store it in the password manager entry
`pgBackRest cipher pass`: without it no backup can ever be restored. This is `<passphrase>`.

```sh
openssl rand -base64 48   # repo1-cipher-pass
```

Then write the config **on the VPS**. The `read` lines ask for the values from the password
manager; the secret ones are not shown, and none of them end up in the shell history. The file
gets `s3.<region>.backblazeb2.com` as endpoint and each value in its place.

```sh
read -rp  'B2 region, for example eu-central-003: ' B2_REGION
read -rp  'B2 bucket name: ' B2_BUCKET
read -rp  'B2 keyID: ' B2_KEY_ID
read -rsp 'B2 applicationKey: ' B2_APP_KEY; echo
read -rsp 'pgBackRest cipher pass: ' PGBR_CIPHER; echo
sudo tee /etc/pgbackrest/pgbackrest.conf >/dev/null <<EOF
[global]
repo1-type=s3
repo1-s3-endpoint=s3.$B2_REGION.backblazeb2.com
repo1-s3-region=$B2_REGION
repo1-s3-bucket=$B2_BUCKET
repo1-s3-key=$B2_KEY_ID
repo1-s3-key-secret=$B2_APP_KEY
repo1-path=/pgbackrest
repo1-retention-full=4
repo1-cipher-type=aes-256-cbc
repo1-cipher-pass=$PGBR_CIPHER
repo1-bundle=y
repo1-block=y
archive-async=y
archive-push-queue-max=4GiB
compress-type=zst
process-max=2
start-fast=y
log-level-console=info

[voidbinder]
pg1-path=/home/postgres/pgdata/data
pg1-socket-path=/var/run/postgresql
EOF
unset B2_REGION B2_BUCKET B2_KEY_ID B2_APP_KEY PGBR_CIPHER
sudo chown 1000:1000 /etc/pgbackrest/pgbackrest.conf && sudo chmod 600 /etc/pgbackrest/pgbackrest.conf
```

**verify:** `sudo grep -E '=$' /etc/pgbackrest/pgbackrest.conf` prints nothing (no value is
empty), and `sudo stat -c '%u:%g %a' /etc/pgbackrest/pgbackrest.conf` prints `1000:1000 600`.

`repo1-bundle=y` and `repo1-block=y` (block incremental backups need bundling) pack the many small
files into few objects and store only changed blocks, which suits S3; set them before the first
full backup, because they only apply to backups made after. `archive-async=y` with
`archive-push-queue-max=4GiB` is a deliberate trade-off
([docs](https://pgbackrest.org/configuration.html#section-archive/option-archive-push-queue-max)):
when B2 is unreachable for long, pgBackRest drops the queued WAL once 4 GiB are waiting, which
ends point-in-time recovery until the next full backup, instead of letting `pg_wal` fill the data
disk and stop Postgres; the WAL archive check in section 8 alerts long before that.

`tee` keeps the existing file, so owner and mode stay as created in section 4; the `chown` line
makes sure. On OVH's Debian image UID 1000 on the host is usually the `debian` login user, which
has `sudo` anyway.

The `archive_command` in the compose file (`pgbackrest --stanza=voidbinder archive-push %p`) is
already active. A stanza is pgBackRest's name for the backup set of one database cluster. Create
it and check archiving:

```sh
sudo docker exec voidbinder-db pgbackrest --stanza=voidbinder stanza-create
sudo docker exec voidbinder-db pgbackrest --stanza=voidbinder check
```

**verify:** `stanza-create` ends with `stanza-create command end: completed successfully`, `check`
with `check command end: completed successfully` (it forces a WAL switch and waits until that
segment is in B2). The bucket now has `pgbackrest/archive/voidbinder/` and
`pgbackrest/backup/voidbinder/`.

**If it fails:** the error line just before `command end: aborted` names the cause.

- `unable to open file '/etc/pgbackrest/pgbackrest.conf'` or `Permission denied`: the file is not
  `1000:1000 600`. Run the `chown` line above again.
- `HostConnectError`, `unable to get address` or `403` / `InvalidAccessKeyId` /
  `SignatureDoesNotMatch`: the region, bucket or key is wrong. Compare the file
  (`sudo cat /etc/pgbackrest/pgbackrest.conf`) with the password manager entry; the key must have
  access to this bucket.
- `WAL segment … was not archived before the … timeout`: archiving itself fails. Look for
  `archive-push` errors in `sudo docker logs voidbinder-db --tail 50`; they usually point to the
  same key or region problem.

**First full backup:**

```sh
sudo docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=full backup
```

**verify:** `sudo docker exec voidbinder-db pgbackrest --stanza=voidbinder info` shows
`status: ok`, `cipher: aes-256-cbc` and one `full backup` with its timestamp, and
`sudo docker exec voidbinder-db pgbackrest version` prints the pgBackRest version of the image
(`pgBackRest 2.59.3` for the tag above).

**Schedule** (`/etc/cron.d/voidbinder-db`, times in UTC). cron runs the backups by itself every
night:

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

**Restore drill.** A backup you have never restored is a hope, not a backup. Run the drill once
now and then every quarter: restore the latest state into a scratch container next to the live
one, compare, throw it away. The live database is not touched; the scratch instance reads from B2
and never archives (`--archive-mode=off`).

> [!WARNING]
> **Before you run this:** the drill writes only to `/var/lib/postgresql/restore-drill` and a
> container named `voidbinder-restore-drill`. Never point `DRILL` at
> `/var/lib/postgresql/voidbinder`, and never leave out `--archive-mode=off`: a drill instance that
> archives would write into the live backup set.

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

**If it fails:** `sudo docker logs voidbinder-restore-drill --tail 50` names the cause. A
`max_worker_processes` error means the `-c` value is lower than in the compose file; a pgBackRest
error during the restore has the same causes as a failing `check` above.

Clean up, in the same terminal (so `DRILL` is still set). The `echo` must print
`/var/lib/postgresql/restore-drill`; if it prints anything else or an empty line, set `DRILL`
again before the `rm`:

```sh
echo "$DRILL"
sudo docker rm -f voidbinder-restore-drill
sudo rm -rf "$DRILL"
```

**Disaster restore on the same VPS** (the data is damaged or a bad change must be undone). This
replaces the live database with the backup, so read the whole procedure first.

> [!WARNING]
> **Before you run this:** check that `pgbackrest info` shows a recent backup and that the B2 key
> and cipher pass are in the password manager. The steps below move the damaged data aside instead
> of deleting it, so you can go back if the restore goes wrong; that needs free space for a second
> copy (`df -h /var/lib/postgresql`). Take an OVH snapshot first if you have not since the last
> config change.

The steps stop the live container, move the damaged data aside, restore into a fresh empty
`/var/lib/postgresql/voidbinder` and start the container again. The restore is the drill's
command without `--archive-mode=off`: the restored server must archive again.

```sh
cd /opt/voidbinder-db && sudo docker compose down
sudo mv /var/lib/postgresql/voidbinder /var/lib/postgresql/voidbinder.broken
sudo install -d -o 1000 -g 1000 -m 700 /var/lib/postgresql/voidbinder
IMAGE=timescale/timescaledb-ha:pg18.6-ts2.30.2
sudo docker run --rm \
  -v /var/lib/postgresql/voidbinder:/home/postgres/pgdata \
  -v /etc/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
  -e PGBACKREST_CONFIG=/etc/pgbackrest/pgbackrest.conf \
  --entrypoint pgbackrest "$IMAGE" --stanza=voidbinder restore
sudo docker compose up -d
```

A plain restore brings back the latest state, including a bad change that was already archived.
To undo a bad change, restore to a point in time before it: add `--type=time "--target=<timestamp>" --target-action=promote` to the
`pgbackrest` restore line, where `<timestamp>` is the moment to go back to, in UTC, for example
`2026-10-09 14:30:00+00`. Without `--target-action=promote` recovery pauses at the target and
stays read-only until you run `SELECT pg_wal_replay_resume()`.

**verify:** the same checks as for a restore onto a new VPS below. Once the restored database is
right, remove the old copy with `sudo rm -rf /var/lib/postgresql/voidbinder.broken`; check the
path twice, it must end in `.broken`.

**Restore onto a new VPS** (the old one is gone; shut it down first if it is still running, two
servers must not archive into one stanza):

1. Do sections 1 to 3: order, base system, additional disk, including the data directory
   `/var/lib/postgresql/voidbinder` (UID 1000, mode 0700, empty). Keep that directory; do not
   `initdb` into it.
2. Do section 4 up to and including the compose file, but do not start the container. The TLS
   certificate and `pg_hba.conf` are files of the host, not of the data, so they are made again
   (the Origin CA certificate can be issued again for the same name).
3. Write `/etc/pgbackrest/pgbackrest.conf` as in this section, from the password manager: the same
   B2 bucket, key and `repo1-cipher-pass`, and the same `[voidbinder]` stanza section. Do not run
   `stanza-create`; the stanza is already in the bucket.
4. Restore into the data directory with the image tag from the compose file:

   ```sh
   IMAGE=timescale/timescaledb-ha:pg18.6-ts2.30.2
   sudo docker run --rm \
     -v /var/lib/postgresql/voidbinder:/home/postgres/pgdata \
     -v /etc/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
     -e PGBACKREST_CONFIG=/etc/pgbackrest/pgbackrest.conf \
     --entrypoint pgbackrest "$IMAGE" --stanza=voidbinder restore
   ```

5. `cd /opt/voidbinder-db && sudo docker compose up -d`.
6. Install cloudflared with the same tunnel token from the password manager (section 6), the cron
   files and the health script (sections 7 and 8). The VPC service and the Hyperdrive configs stay
   as they are: they point at the tunnel and at `172.30.0.10`, which the new compose file keeps. The
   roles and databases of section 5 came back with the restore.

**verify:** `sudo docker logs voidbinder-db 2>&1 | grep -E 'archive recovery complete|ready to accept connections'`
shows both lines, `sudo docker exec voidbinder-db pgbackrest --stanza=voidbinder check` succeeds,
and the row counts match what you expect.

## 8. Operations

This section is the routine after setup: updates, disk space, slow queries, an optional alert, and
growing the disk. Set up the alert now; the rest is for when you need it.

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
     sudo docker exec -i voidbinder-db psql -X -U postgres -d "$db" <<'EOF'
   ALTER EXTENSION timescaledb UPDATE;
   SELECT 'ALTER EXTENSION timescaledb_toolkit UPDATE' FROM pg_extension WHERE extname = 'timescaledb_toolkit' \gexec
   EOF
   done
   ```

   `ALTER EXTENSION timescaledb UPDATE` runs as the first command of a fresh session (`-X`), in
   every database that has the extension; `timescaledb_toolkit` is updated where it is installed.
   Also update the tag in the restore drill above.

**verify:** `SELECT version()` shows the new PostgreSQL minor, `\dx timescaledb` the new version in
every database (`\dx` also shows `timescaledb_toolkit` at the new version wherever it is installed),
`pgbackrest --stanza=voidbinder check` succeeds. A PostgreSQL major upgrade
(18 → 19) is not covered here; it needs `pg_upgrade` or dump and restore and gets its own ticket.

**If it fails:** if the container does not become healthy on the new tag, put the old tag back in
the compose file and run `sudo docker compose up -d` again.

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
**Push** monitor in Kuma with heartbeat interval 20 minutes (the cron runs every 15, so one late
or skipped run does not mark it down; alternatively keep 15 minutes and set **Retries** to 1) and
copy its push URL; it has the form `https://<kuma-host>/api/push/<token>`, where `<kuma-host>` is
your Kuma server and `<token>` the monitor's push token. Store it in the password manager entry
`Kuma push URL`. The script pushes only when everything is fine, so Kuma alerts on a full disk, a
stale backup, a broken WAL archive (a B2 outage or a wrong key shows up here within 15 minutes,
long before the 4 GiB queue limit) and a dead VPS alike. The archive check relies on
`archive_timeout=300`, which only closes a segment when something was written; on a database that
is completely idle for 15 minutes it would fire too, which the waitlist and the Timescale
background jobs normally prevent.

```sh
sudo install -m 600 /dev/null /etc/voidbinder-db-health.env
read -rsp 'Kuma push URL: ' KUMA_URL; echo
echo "KUMA_PUSH_URL=$KUMA_URL" | sudo tee /etc/voidbinder-db-health.env >/dev/null
unset KUMA_URL
sudo tee /usr/local/bin/voidbinder-db-health >/dev/null <<'EOF'
#!/bin/sh
# Pushes "up" to Uptime Kuma only when disks are below 80 %, the newest backup is under 36 h old and
# WAL archiving is healthy (last archive under 15 min ago, no failure since).
set -eu
. /etc/voidbinder-db-health.env
for m in / /var/lib/postgresql; do
  use=$(df --output=pcent "$m" | tail -n 1 | tr -dc 0-9)
  [ "$use" -lt 80 ] || { echo "disk $m at $use %"; exit 1; }
done
last=$(docker exec voidbinder-db pgbackrest --stanza=voidbinder --output=json info | jq '.[0].backup[-1].timestamp.stop')
age=$(( $(date +%s) - last ))
[ "$age" -lt 129600 ] || { echo "newest backup is $age s old"; exit 1; }
arch=$(docker exec voidbinder-db psql -U postgres -Atc "SELECT extract(epoch FROM now()-last_archived_time)::int FROM pg_stat_archiver")
{ [ -n "$arch" ] && [ "$arch" -lt 900 ]; } || { echo "last WAL archived ${arch:-never} s ago"; exit 1; }
failed=$(docker exec voidbinder-db psql -U postgres -Atc "SELECT coalesce(last_failed_time > last_archived_time, false) FROM pg_stat_archiver")
[ "$failed" = f ] || { echo "WAL archiving failed after the last success"; exit 1; }
curl -fsS -m 10 -o /dev/null "$KUMA_PUSH_URL?status=up&msg=OK"
EOF
sudo chmod 755 /usr/local/bin/voidbinder-db-health
echo '*/15 * * * * root /usr/local/bin/voidbinder-db-health >/dev/null' | sudo tee -a /etc/cron.d/voidbinder-db
```

**verify:** `sudo /usr/local/bin/voidbinder-db-health; echo $?` prints `0` and the Kuma monitor
turns green.

**If it fails:** the script prints the reason before the non-zero exit code: a disk at 80 % or
more, a backup older than 36 hours (check `/var/log/voidbinder-db-backup.log`), or a WAL archive
problem (run `pgbackrest check` as in section 7). A `curl` error means the push URL is wrong;
compare `/etc/voidbinder-db-health.env` with Kuma.

**Growing the additional disk.** OVH control panel → the VPS → **Additional disks → Increase the
disk size**, wait until the new size shows, then make the kernel see it. This stops the database
for a minute. Replace `sdb` with your disk's name from section 3.

```sh
echo 1 | sudo tee /sys/class/block/sdb/device/rescan
lsblk /dev/sdb   # must show the new size
cd /opt/voidbinder-db && sudo docker compose down
sudo umount /var/lib/postgresql
sudo e2fsck -f /dev/sdb && sudo resize2fs /dev/sdb
sudo mount /var/lib/postgresql && sudo docker compose up -d
```

**verify:** `df -h /var/lib/postgresql` shows the new size and the container is `healthy` again.

## 9. Security notes

What protects the database, in one place.

- Postgres has no public port: nothing is published by Docker and `ufw` allows only 22/tcp
  inbound. Workers reach it through the tunnel, the operator through SSH.
- SSH accepts keys only and no root login; the KVM console with the `debian` password is the
  fallback.
- Every TCP login needs TLS and SCRAM (`pg_hba.conf`); each Hyperdrive user may only reach its own
  database, from the host side of the Docker network.
- `hyperdrive_dev` and `hyperdrive_prod` have DML rights only, no DDL: they cannot create, alter
  or drop anything. Schema changes go through `voidbinder_migrate` and the SSH tunnel.
- Secrets live on the VPS (`/opt/voidbinder-db/.env`, `/etc/pgbackrest/pgbackrest.conf`, the
  cloudflared token file `/etc/cloudflared/token`, `/etc/voidbinder-db-health.env`, all root or
  UID 1000 only), in Cloudflare (the Hyperdrive configs) and in the password manager folder
  `Voidbinder DB`. None of them belong in this repository; the Hyperdrive and VPC service ids are
  not secrets.
- Backups in B2 are encrypted by pgBackRest before upload (`repo1-cipher-type`); the B2 key can
  touch only the one bucket, and B2 Object Lock keeps every backup file for 45 days even if the
  VPS and its key are compromised.
- B2 holds the database backups, a provider separate from OVH (database) and Cloudflare (edge).
  App blobs (card images, catalog modules, raw dumps) stay in R2.

## 10. Done

**Take a snapshot of the finished system.** OVH control panel → the VPS → **Snapshot → Take a
snapshot**. If the system disk ever breaks, this brings back the OS, Docker, cloudflared and all
config in minutes; the data comes back from B2.

Then check that all of this is true:

- [ ] Key login works, password login is refused
      (`ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password debian@<vps-ip>`
      prints `Permission denied (publickey).`), and the `debian` console password is in the
      password manager.
- [ ] `sudo ufw status verbose` shows `Status: active` with only `22/tcp` allowed in.
- [ ] No public 5432: `sudo ss -ltnp | grep 5432` on the VPS prints nothing, and
      `nc -vz -w 5 <vps-ip> 5432` on the workstation fails.
- [ ] `findmnt /var/lib/postgresql` shows the additional disk, also after a reboot.
- [ ] `sudo docker compose ps` in `/opt/voidbinder-db` shows `voidbinder-db` as `healthy`.
- [ ] cloudflared is connected: `systemctl status cloudflared` is `active (running)` and the tunnel
      is Healthy in the dashboard.
- [ ] The Hyperdrive test passed: the `curl` sign-up against the `dev` Worker answered
      `{"status":"pending"}` and the row is in `voidbinder_dev`.
- [ ] The Hyperdrive ids are committed in `apps/site/wrangler.jsonc`.
- [ ] `pgbackrest --stanza=voidbinder check` succeeds and `pgbackrest info` shows at least one full
      backup.
- [ ] `/etc/cron.d/voidbinder-db` exists, and the next morning's log shows a successful backup.
- [ ] The restore drill is done and its row counts matched.
- [ ] Optional: the Uptime Kuma monitor is green.
- [ ] The OVH snapshot above is taken.
- [ ] Every entry of the table in section 0 is in the password manager folder `Voidbinder DB`,
      and none of them is in the repository.
