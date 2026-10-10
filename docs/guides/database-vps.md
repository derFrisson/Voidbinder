# Database VPS runbook

How to set up and run the PostgreSQL + TimescaleDB server behind voidbinder.de
([ADR 0003](../adr/0003-price-history-storage.md)). One OVH VPS in Gravelines runs PostgreSQL 18
with TimescaleDB in rootless Docker on Ubuntu 24.04 LTS. Cloudflare Workers reach it only through a
Cloudflare Tunnel, a Workers VPC service and Hyperdrive. pgBackRest backs it up to Backblaze B2. The
server has no public Postgres port: Docker publishes the database on the loopback address of the
VPS only.

```text
Worker ── Hyperdrive ── Workers VPC service ── Tunnel ── cloudflared (host) ── 127.0.0.1:5432 (published port) ── container
your workstation ── SSH tunnel ── 127.0.0.1:5432 on the VPS (migrations only)
container ── pgBackRest ── Backblaze B2 (EU Central)
```

**Who this is for.** You have installed Docker before and logged in to a server over SSH, but you
have not run PostgreSQL in production and do not know Cloudflare Tunnel, Hyperdrive or pgBackRest.
Every step says what it does, how to check that it worked, and what to do when it did not. Plan
about four hours, plus the wait for OVH to deliver the server.

The runbook uses the project's own names: the domain `voidbinder.de`, the Cloudflare account
`152a1fcd0eebb96d1bc30d14b5a6af58` and the dev Worker URL
`voidbinder-site-dev.frisson.workers.dev`. If you run your own instance, use your domain, your
account ID (also in `apps/site/wrangler.jsonc`) and your Worker URL instead.

## Contents

| Section                                                                                             | Time                         |
| --------------------------------------------------------------------------------------------------- | ---------------------------- |
| [0. Before you start](#0-before-you-start)                                                          | 20 min                       |
| [1. Order and prepare](#1-order-and-prepare)                                                        | 10 min, plus OVH delivery    |
| [2. Base system](#2-base-system)                                                                    | 20 min                       |
| [3. Additional disk](#3-additional-disk)                                                            | 10 min                       |
| [4. Docker and PostgreSQL](#4-docker-and-postgresql)                                                | 60 min                       |
| [5. Roles and databases](#5-roles-and-databases)                                                    | 15 min                       |
| [6. Cloudflare Tunnel, Workers VPC and Hyperdrive](#6-cloudflare-tunnel-workers-vpc-and-hyperdrive) | 30 min                       |
| [7. Backups with pgBackRest to Backblaze B2](#7-backups-with-pgbackrest-to-backblaze-b2)            | 40 min                       |
| [8. Operations](#8-operations)                                                                      | 10 min now, then monthly     |
| [9. Security notes](#9-security-notes)                                                              | 5 min                        |
| [10. Done](#10-done)                                                                                | 10 min                       |
| [11. Image mirror](#11-image-mirror)                                                                | 15 min, then 2 to 4 h        |
| [12. Offline catalog modules](#12-offline-catalog-modules)                                          | 10 min                       |
| [13. Price history backfill](#13-price-history-backfill)                                            | 10 min, then hours (archive) |

Versions checked on 2026-10-09:

| Component         | Version / tag                              | Source                                                                                                                                                                                              |
| ----------------- | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TimescaleDB image | `timescale/timescaledb-ha:pg18.6-ts2.30.2` | [Docker Hub](https://hub.docker.com/r/timescale/timescaledb-ha/tags), [repo](https://github.com/timescale/timescaledb-docker-ha)                                                                    |
| PostgreSQL        | 18.6                                       | in the image                                                                                                                                                                                        |
| TimescaleDB       | 2.30.2 (Community, Timescale License)      | in the image                                                                                                                                                                                        |
| pgBackRest        | 2.59.3, shipped in the image               | [pgbackrest.org](https://pgbackrest.org/configuration.html)                                                                                                                                         |
| cloudflared       | 2026.10.0 from `pkg.cloudflare.com`        | [pkg.cloudflare.com](https://pkg.cloudflare.com/index.html)                                                                                                                                         |
| wrangler          | `apps/site` devDependency (4.148+)         | [Workers VPC](https://developers.cloudflare.com/workers-vpc/configuration/vpc-services/), [Hyperdrive](https://developers.cloudflare.com/hyperdrive/configuration/connect-to-private-database-vpc/) |
| Docker Engine     | 29.9, current stable from `get.docker.com` | [docs.docker.com](https://docs.docker.com/engine/install/ubuntu/#install-using-the-convenience-script), [rootless mode](https://docs.docker.com/engine/security/rootless/)                          |
| Ubuntu            | 24.04 LTS (Debian 13 works the same way)   | [ubuntu.com](https://ubuntu.com/about/release-cycle)                                                                                                                                                |

## 0. Before you start

This section gets your workstation ready and explains the pieces. The most important part is the
SSH key: section 2 switches off password login, so a working key login is your only way in
afterwards. Do not skip the key test at the end of section 1.

### How to read this runbook

- Run every step in order. Each one ends with **verify:** and the output to expect. Do not go on
  until the verify step matches.
- Each block says where it runs: **on the VPS** (logged in over SSH as `ubuntu`, or `debian`
  on Debian) or **on the workstation** (your own computer). Workstation commands are written for a POSIX shell: the
  Terminal on macOS, a Linux shell, or WSL on Windows. The SSH key steps also cover plain Windows
  PowerShell.
- The runbook is written for **Ubuntu 24.04 LTS** and its login user `ubuntu`. On Debian 13, use
  the user `debian` wherever `ubuntu` appears (in commands, paths and `crontab` lines); every other
  step is the same.
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
write them into files with mode 600 that only root, `ubuntu` or the database user can read.

| Value                                      | Placeholder                                           | Where it comes from                                       | Password manager entry                                    |
| ------------------------------------------ | ----------------------------------------------------- | --------------------------------------------------------- | --------------------------------------------------------- |
| VPS IPv4 address                           | `<vps-ip>`                                            | OVH control panel, the VPS's page (also in the OVH email) | not secret; note it in `VPS`                              |
| SSH key passphrase                         |                                                       | you choose it in this section                             | `SSH key passphrase`                                      |
| `ubuntu` console password                  |                                                       | you set it in section 2                                   | `ubuntu console`                                          |
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
  change and roll back. It runs in **rootless mode**: the Docker daemon and the containers belong
  to the normal user `ubuntu`, not to root.
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
- [ ] Image **Ubuntu 24.04 LTS** (this runbook, login user `ubuntu`). Debian 13 works too: the
      login user is then `debian`, and every `ubuntu` in the commands below becomes `debian`.
- [ ] Option **additional disk, 50 GB**.
- [ ] Option **snapshot**. A snapshot covers the system disk only, not the additional disk: it
      saves the OS, Docker and the config under `/opt` and `/etc`, while the data is covered by
      pgBackRest (section 7).
- [ ] Your **SSH public key** in the order form (the `ssh-ed25519 …` line from section 0), so the
      server boots with key login.

When OVH reports the VPS as delivered, note its IPv4 address from the control panel. That is
`<vps-ip>` everywhere below.

**If you did not add the key in the order:** OVH gives you a password for the `ubuntu` user
instead (by email or in the control panel). Copy your key on with it once, from the workstation:

```sh
ssh-copy-id -i ~/.ssh/id_ed25519.pub ubuntu@<vps-ip>   # macOS, Linux
```

Windows PowerShell has no `ssh-copy-id`; this does the same:

```powershell
Get-Content $env:USERPROFILE\.ssh\id_ed25519.pub | ssh ubuntu@<vps-ip> "mkdir -p ~/.ssh && chmod 700 ~/.ssh && cat >> ~/.ssh/authorized_keys && chmod 600 ~/.ssh/authorized_keys"
```

**Test the key login.** This command forbids password login on the client side, so it can only
succeed with the key:

```sh
ssh -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no ubuntu@<vps-ip>
```

**verify:** the OVH control panel shows the VPS as active with one additional disk, and the
command above logs you in to a `ubuntu@…` prompt without asking for a password (it may ask for the
key's passphrase; that is the key, not the server password). Type `exit` to leave.

**If it fails:**

- `Permission denied (publickey)`: the server does not have your public key, or SSH offers a
  different key. Run `ssh-copy-id` as above, or name the key with
  `ssh -i ~/.ssh/id_ed25519 ubuntu@<vps-ip>`. Check the user name: `ubuntu` on Ubuntu, `debian` on
  Debian, never `root`.
- `Connection timed out` or `Connection refused`: the VPS is still installing or rebooting, or the
  IP is wrong. Wait a few minutes and compare the IP with the control panel.
- `REMOTE HOST IDENTIFICATION HAS CHANGED`: the VPS was reinstalled and has a new host key. Remove
  the old one with `ssh-keygen -R <vps-ip>` and connect again.

## 2. Base system

This step updates the system, closes everything except SSH, and installs automatic security
updates. Two of the steps (SSH hardening and the firewall) can lock you out if done in the wrong
order, so each has a warning and a test.

All commands in this section run **on the VPS** as `ubuntu` with `sudo`.

```sh
sudo apt update && sudo apt full-upgrade -y
sudo timedatectl set-timezone UTC
```

**Set a console password for `ubuntu`.** The OVH KVM console (control panel → your VPS →
**KVM**) is a screen and keyboard on the server that works even when SSH does not. It asks for a
password, and turning off password login for SSH below does not affect it. Give `ubuntu` a password
and store it in the password manager entry `ubuntu console`:

```sh
sudo passwd ubuntu
```

**verify:** `sudo passwd -S ubuntu` prints a line with `P` in the second field (password set).

**If you lock yourself out of SSH**, this is the way back in: open the KVM console, log in as
`ubuntu` with that password, and undo the last change (for example
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
`ssh ubuntu@<vps-ip>`: it must work. Only then close the second session. Finally check that
passwords are really refused:

```sh
ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password ubuntu@<vps-ip>
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

**Unattended security upgrades.** Ubuntu then installs security fixes every day without you.

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
`sudo apt install -y fail2ban` (the package enables the `sshd` jail).
**verify:** `sudo fail2ban-client status sshd` shows `Currently banned:` with a number.

**Tools used later:**

```sh
sudo apt install -y jq curl ca-certificates openssl cron
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

Create the empty data directory. Its owner is set in section 4, once rootless Docker exists: the
`postgres` user of the container is a high host UID that is only known then.

```sh
sudo install -d -m 700 /var/lib/postgresql/voidbinder
```

**verify:** `findmnt /var/lib/postgresql` shows `/dev/sdb ext4 rw,noatime`, `df -h /var/lib/postgresql`
shows about 49G, and `stat -c '%u:%g %a' /var/lib/postgresql/voidbinder` prints `0:0 700`.
Then `sudo reboot`, log in again, and `findmnt /var/lib/postgresql` still shows the disk.

**If it fails:** if `findmnt` shows nothing after the reboot, run `sudo mount -a` and read its
error. The usual cause is a typo in the fstab line; compare it with
`sudo blkid /dev/sdb` and fix it with `sudoedit /etc/fstab`.

## 4. Docker and PostgreSQL

This step installs Docker, switches it to rootless mode, prepares the TLS certificate and the
access rules, and starts the database container. When it is done, PostgreSQL runs on the additional
disk, accepts only encrypted logins, and its port exists on the loopback address of the VPS only.

All commands run **on the VPS** as `ubuntu`.

### Install Docker with the convenience script

Docker's convenience script adds Docker's apt repository and installs the current Docker Engine, the
Compose plugin and the rootless extras in one go. Docker documents its limits in
[Install using the convenience script](https://docs.docker.com/engine/install/ubuntu/#install-using-the-convenience-script):
it is "not recommended for production environments", it installs dependencies and recommendations
without asking for confirmation, and it always installs the latest stable release, which can be a
new major version. This runbook accepts that for three reasons: the VPS does one job, so there is no
other software for the packages to break; the packages come from Docker's own signed repository; and
Docker is updated only by hand at a time you choose (section 8), after a backup. Read what the
script will do before you let it run:

```sh
curl -fsSL https://get.docker.com -o get-docker.sh
sh get-docker.sh --dry-run
```

`--dry-run` changes nothing. It prints the commands: Docker's repository
(`download.docker.com/linux/ubuntu`) and the packages `docker-ce`, `docker-ce-cli`, `containerd.io`,
`docker-compose-plugin`, `docker-ce-rootless-extras`, `docker-buildx-plugin` and
`docker-model-plugin`. When that matches, run it:

```sh
sudo sh ./get-docker.sh
```

The script also starts the system-wide Docker daemon, which runs as root. The next part turns it
off again.

**verify:** `docker --version` prints `Docker version 29.…`, `docker compose version` prints
`Docker Compose version v…`, and `command -v dockerd-rootless-setuptool.sh` prints
`/usr/bin/dockerd-rootless-setuptool.sh`. (`docker run` does not work yet for `ubuntu`; that is
intended.)

**If it fails:**

- `Could not get lock /var/lib/dpkg/lock-frontend`: the automatic updates are running, which is
  common right after the first boot. Wait a few minutes and run `sudo sh ./get-docker.sh` again.
- `Unable to locate package` or a repository error: the VPS has no internet or a wrong clock. Check
  `curl -I https://download.docker.com` and `timedatectl`.

### Switch Docker to rootless mode

By default the Docker daemon runs as root, so anyone who breaks out of the daemon or of a container
owns the whole VPS. In [rootless mode](https://docs.docker.com/engine/security/rootless/) the
daemon and every container run as the normal user `ubuntu`, inside a user namespace: the same
break-out ends in an unprivileged account. Rootless mode has limits (section 9); none of them hurts
this setup.

> [!WARNING]
> **Before you run this:** use a normal SSH login as `ubuntu`. `systemctl --user` and the setup
> tool need the user session that SSH creates; they fail with `Failed to connect to bus` after
> `sudo -iu ubuntu` or `su`.

**1. Packages.** `uidmap` provides `newuidmap` and `newgidmap`, which the setup tool needs to give
the daemon more than one user ID. `dbus-user-session` gives `ubuntu` its own message bus, which
`systemctl --user` and the container runtime need (the Docker package already depends on it).

```sh
sudo apt-get install -y uidmap dbus-user-session
```

No `slirp4netns` or `passt` is needed: without them RootlessKit uses its built-in user-space
network stack (gvisor-tap-vsock) and port forwarding, which is all the published port below
needs ([network drivers](https://docs.docker.com/engine/security/rootless/troubleshoot/#networking-errors)).

**verify:** `command -v newuidmap newgidmap` prints two paths under `/usr/bin`.

**2. Subordinate user and group IDs.** `ubuntu` needs a range of at least 65,536 extra IDs to hand
out to container users. Ubuntu creates it with the user:

```sh
grep '^ubuntu:' /etc/subuid /etc/subgid
```

**verify:** two lines such as `/etc/subuid:ubuntu:165536:65536` and `/etc/subgid:ubuntu:165536:65536`.
The first number is the start of the range (the _base_, it differs per server), the second is its
length and must be 65536 or more. Note the two bases; the data directory below depends on them.

**If it fails:** if `grep` prints nothing, give `ubuntu` a range that no other line of
`/etc/subuid` and `/etc/subgid` uses (`cat /etc/subuid` shows the taken ones):

```sh
sudo usermod --add-subuids 100000-165535 --add-subgids 100000-165535 ubuntu
```

**3. Switch off the root daemon.** Docker's [rootless guide](https://docs.docker.com/engine/security/rootless/)
asks for this when the system-wide daemon is installed. Otherwise you would be running the root
daemon without noticing.

```sh
sudo systemctl disable --now docker.service docker.socket
sudo rm -f /var/run/docker.sock
```

**verify:** `systemctl is-enabled docker.service docker.socket` prints `disabled` twice, and
`systemctl is-active docker.service` prints `inactive`.

**4. Log in again** so that your session picks up the new user bus: type `exit`, then
`ssh ubuntu@<vps-ip>` from the workstation.

**verify:** `echo $XDG_RUNTIME_DIR` prints `/run/user/1000` and `systemctl --user is-active dbus`
prints `active`.

**5. Install the rootless daemon** as `ubuntu`, not with `sudo`:

```sh
dockerd-rootless-setuptool.sh install
```

**verify:** the output ends with `[INFO] Installed docker.service successfully.`,
`Successfully created context "rootless"` and `Current context is now "rootless"`.

**6. Start at boot, and keep it running without a login.** A user service normally stops when the
user logs out; `enable-linger` lets `ubuntu`'s services run from boot on.

```sh
systemctl --user enable --now docker
sudo loginctl enable-linger ubuntu
```

**7. Tell the Docker client where the daemon is.** The setup tool already created the `rootless`
context; `DOCKER_HOST` makes it explicit for every shell. The packages install the binaries in
`/usr/bin`, so `PATH` needs no change (if the setup tool printed an `export PATH=…` line for
another directory, add that line as well).

```sh
echo 'export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock' >> ~/.bashrc
export DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock
```

**verify:**

- `systemctl --user is-active docker` prints `active`, and `loginctl show-user ubuntu -p Linger`
  prints `Linger=yes`.
- `docker info | grep -E 'rootless|Cgroup Driver|Cgroup Version|Context'` prints `rootless` (under
  Security Options), `Cgroup Driver: systemd`, `Cgroup Version: 2` and `Context: rootless`.
- `docker run --rm hello-world` prints `Hello from Docker!`.

**If it fails:**

- The setup tool stops with `Missing system requirements … apt-get install -y uidmap`: do step 1,
  then run the setup tool again.
- `No subuid ranges found for user 1000 ("ubuntu")`: `/etc/subuid` or `/etc/subgid` has no line for
  `ubuntu`. Do the `usermod` command of step 2 and run the setup tool again. `docker pull` failing
  with `lchown … invalid argument` means the range is shorter than 65536.
- `[INFO] systemd not detected`, or `systemctl --user` prints
  `Failed to connect to bus: No such file or directory`: the shell is not a real login session
  (`sudo -iu`, `su`), or you did not log in again after installing `dbus-user-session`. Log in with
  SSH again. If it persists: `systemctl --user enable --now dbus`.
- `docker run` fails with `read unix @->/run/systemd/private: connection reset by peer`: the user
  bus is not running; same fix, then log in again.
- `failed to start the child: fork/exec /proc/self/exe: operation not permitted`: Ubuntu 24.04
  restricts unprivileged user namespaces unless an AppArmor profile allows them. The profile for
  `rootlesskit` comes with the Docker packages from the script above; load it with
  `sudo systemctl restart apparmor` and run the setup tool again. Do not switch the restriction off.
- `Cannot connect to the Docker daemon at unix:///run/user/1000/docker.sock`: the daemon is not
  running. `systemctl --user status docker` and `journalctl --user -u docker -n 50` name the
  reason; also check that `DOCKER_HOST` is set (`echo $DOCKER_HOST`).
- After a reboot `docker ps` says the daemon is not running until you log in: linger is off. Run
  `sudo loginctl enable-linger ubuntu`.

Rootless mode needs no `sysctl` setting here: Postgres listens on port 5432 (only ports below 1024
need one), the compose file sets no CPU or memory limits (limits need cgroup v2 and systemd, and
Ubuntu 24.04 has both), and `shared_buffers=2GB` is shared memory inside the container.

### Directory layout and file ownership

In rootless mode the user numbers inside the container are shifted on the host
([UID/GID mapping](https://docs.docker.com/engine/security/rootless/uid-gid-mapping)): container
root (UID 0) is `ubuntu` itself, and container UID _n_ (1 and up) is the _base + n − 1_ of the
`/etc/subuid` range from above. The `postgres` user in the image has UID and GID 1000, so on the
host its files must belong to _subuid base + 999_ and _subgid base + 999_. Compute them from the
files (the first number of the `ubuntu:` line is the base):

```sh
PGUID=$(( $(awk -F: '$1=="ubuntu" {print $2; exit}' /etc/subuid) + 999 ))
PGGID=$(( $(awk -F: '$1=="ubuntu" {print $2; exit}' /etc/subgid) + 999 ))
echo "$PGUID:$PGGID"
```

**verify:** it prints two numbers, for example `166535:166535` for a base of `165536`. Both are
shell variables: if you reconnect before the end of this runbook, run these lines again. Do not
type the numbers by hand.

Config goes under `/opt/voidbinder-db` (owned by `ubuntu`, so `docker compose` and your editor
need no `sudo`), the TLS files into a folder only the database user can read, the backup config
under `/opt/voidbinder-db/pgbackrest`. Give the data directory from section 3 to the database user:

```sh
sudo chown "$PGUID:$PGGID" /var/lib/postgresql/voidbinder
sudo install -d -o ubuntu -g ubuntu -m 755 /opt/voidbinder-db
sudo install -d -o "$PGUID" -g "$PGGID" -m 700 /opt/voidbinder-db/tls
sudo install -d -o ubuntu -g ubuntu -m 755 /opt/voidbinder-db/pgbackrest
```

The backup config lives under `/opt`, not under `/etc`, on purpose: rootless Docker copies `/etc`
into its own view when the daemon starts (RootlessKit `--copy-up`), so a directory created under
`/etc` later is invisible to the daemon until it restarts, and `docker compose up` fails with
`bind source path does not exist`. `/opt/voidbinder-db/pgbackrest` is readable (755) so the daemon can mount it; the
config file inside will be mode 600 for the database user. Inside the container the path is still
`/etc/pgbackrest/pgbackrest.conf`.

**verify:** `ls -lnd /var/lib/postgresql/voidbinder /opt/voidbinder-db/tls` shows `drwx------` and
your two numbers as owner and group, and Docker agrees that the owner is the container's UID 1000:

```sh
docker run --rm -v /var/lib/postgresql/voidbinder:/d alpine stat -c '%u:%g' /d
```

prints `1000:1000`.

**If it fails:** if that prints `0:0`, the directory still belongs to `ubuntu` (the container
sees `ubuntu` as root): run the `chown` line again with `PGUID` and `PGGID` set. If it prints
`65534:65534`, the owner is a number outside the range of `ubuntu` (`nobody` in the container):
recompute `PGUID` and `PGGID`, since a typo in the base is the usual cause.

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
sudo chown "$PGUID:$PGGID" $TLS/server.key $TLS/server.crt
sudo chmod 600 $TLS/server.key && sudo chmod 644 $TLS/server.crt
```

**verify:** `sudo openssl x509 -in /opt/voidbinder-db/tls/server.crt -noout -subject -issuer -enddate`
prints `subject=O=CloudFlare, Inc., OU=CloudFlare Origin CA, CN=CloudFlare Origin Certificate` (Origin
CA certificates always carry that generic subject; the hostname sits in the SAN extension), an
issuer naming `CloudFlare Origin SSL Certificate Authority` and a `notAfter` fifteen years ahead;
`sudo openssl x509 -in /opt/voidbinder-db/tls/server.crt -noout -ext subjectAltName` prints
`DNS:db.voidbinder.de`; and
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
sudo chown "$PGUID:$PGGID" $TLS/server.key $TLS/server.crt
sudo chmod 600 $TLS/server.key && sudo chmod 644 $TLS/server.crt
```

**verify:** `sudo openssl x509 -in /opt/voidbinder-db/tls/server.crt -noout -subject -enddate` prints
`subject=CN=db.voidbinder.de` and a `notAfter` ten years ahead.

**Alternative: Let's Encrypt through DNS-01** (publicly trusted, no inbound port needed, renews
every 60 days by itself). First the deploy hook, `/usr/local/bin/voidbinder-db-cert` (mode 755),
which copies the renewed files (with the database user's mapped IDs) and reloads Postgres (it
re-reads certificates on reload):

```sh
sudo tee /usr/local/bin/voidbinder-db-cert >/dev/null <<'EOF'
#!/bin/sh
# Runs as root (certbot). The files belong to the database user's mapped IDs; Docker is ubuntu's.
set -eu
U=ubuntu
uid=$(( $(awk -F: -v u=$U '$1==u {print $2; exit}' /etc/subuid) + 999 ))
gid=$(( $(awk -F: -v u=$U '$1==u {print $2; exit}' /etc/subgid) + 999 ))
install -o "$uid" -g "$gid" -m 644 "$RENEWED_LINEAGE/fullchain.pem" /opt/voidbinder-db/tls/server.crt
install -o "$uid" -g "$gid" -m 600 "$RENEWED_LINEAGE/privkey.pem" /opt/voidbinder-db/tls/server.key
runuser -u "$U" -- env DOCKER_HOST="unix:///run/user/$(id -u "$U")/docker.sock" \
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
which database from where. cloudflared and the SSH tunnel both reach Postgres through the port
Docker publishes on `127.0.0.1`. In rootless Docker that connection reaches the container from the
gateway address of its Compose network, not from `127.0.0.1` and not from the host's public
address. The compose file below pins that network to `172.30.0.0/24`, so the gateway is always
`172.30.0.1`. This was tested with Docker 29.9 and RootlessKit 3.2 in Docker's
`docker:29-dind-rootless` image (published port on the loopback address, request from the host, the
address read in the container's log): `172.30.0.1` is what the
container sees with the user-space network stacks `gvisor-tap-vsock` (the default on this setup) and
`slirp4netns`, with and without Docker's userland proxy. Docker documents that rootless port
forwarding does not pass on the client's address by default
([known limitations](https://docs.docker.com/engine/security/rootless/troubleshoot/#known-limitations));
a connection that starts on the host's own loopback has no other address to pass on anyway. The
`pasta` network driver (experimental) was not tested; if you switch to it, read the `pg_hba`
rejection in the section 4 **If the loopback port does not work** list first.

Every TCP login needs TLS and SCRAM (password check without sending the password); anything that
matches no line is rejected. Because the tunnel and an SSH session look the same to Postgres, the
address does not tell them apart: the role, its password, TLS and the per-database grants of
section 5 do. Inside the container the `postgres` superuser logs in over the Unix socket only
(pgBackRest, maintenance).

```sh
tee /opt/voidbinder-db/pg_hba.conf >/dev/null <<'EOF'
# TYPE   DATABASE                  USER                ADDRESS         METHOD
local    all                       postgres                            peer
local    all                       all                                 scram-sha-256
hostssl  voidbinder_dev            hyperdrive_dev      172.30.0.1/32   scram-sha-256
hostssl  voidbinder                hyperdrive_prod     172.30.0.1/32   scram-sha-256
hostssl  voidbinder_dev,voidbinder voidbinder_migrate  172.30.0.1/32   scram-sha-256
EOF
chmod 644 /opt/voidbinder-db/pg_hba.conf
```

**Superuser password.** The image needs one for its first start; `postgres` then logs in by
`peer` only, so the password is never used. This command generates it straight into the file, so
it never appears on screen or in the history:

```sh
install -m 600 /dev/null /opt/voidbinder-db/.env
echo "POSTGRES_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=')" > /opt/voidbinder-db/.env
```

Copy it into the password manager entry `postgres superuser` with `cat /opt/voidbinder-db/.env`.

**pgBackRest config comes later.** The container mounts the host directory `/opt/voidbinder-db/pgbackrest` (created
above, in the directory block of this section) at `/etc/pgbackrest`, so the config file can be
written in section 7 without touching the compose file.
Until the stanza exists, WAL archiving fails and Postgres keeps the WAL and retries; that is
expected for the minutes in between (the log shows `archive command failed`).

**`/opt/voidbinder-db/docker-compose.yml`.** Create the file with
`nano /opt/voidbinder-db/docker-compose.yml` and paste the content below. Memory settings for 8 GB
RAM. The image starts as `postgres` (UID 1000, a mapped host UID in rootless mode); `NO_TS_TUNE` stops `timescaledb-tune` from rewriting
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
        source: /opt/voidbinder-db/pgbackrest
        target: /etc/pgbackrest
        read_only: true
        bind: { create_host_path: false }
    ports:
      - '127.0.0.1:5432:5432'
    networks:
      - db
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
          gateway: 172.30.0.1
```

Notes on the values: `timescaledb.max_background_workers` is the number of databases (4 with
`postgres` and `template1`) plus concurrent jobs; `max_worker_processes` is at least that plus
`max_parallel_workers`. `archive_timeout=300` closes a WAL segment at least every five minutes, so
at most five minutes of writes are not yet in B2. `log_parameter_max_length=0` keeps bind
parameters (such as email addresses) out of the slow-query log. `logging: local` rotates the
container log (5 × 20 MB).

`ports` publishes the database on the loopback address of the VPS and nowhere else. Loopback is
not reachable from the internet, so this is not a public Postgres port, and `ufw` stays as it is.
(Rootless Docker does not write firewall rules on the host either: it forwards ports in user space
inside `ubuntu`'s own network namespace, so it cannot bypass `ufw` the way the root daemon does.) The `gateway` line pins
the address in `pg_hba.conf` above. The subnet exists inside rootless Docker's own network
namespace, so it cannot clash with the VPS's network.

Before the first start, check that every bind-mount source exists; Docker refuses to start the
container otherwise (`bind source path does not exist`):

```sh
ls -ld /var/lib/postgresql/voidbinder /opt/voidbinder-db/tls /opt/voidbinder-db/pgbackrest
```

All three must print a line. A missing one means the directory block earlier in this section was
skipped; run it again. Then start it:

```sh
cd /opt/voidbinder-db
docker compose up -d
```

**verify:**

- `docker compose ps` shows `voidbinder-db` with `Up … (healthy)` after about 30 s, and its ports
  as `127.0.0.1:5432->5432/tcp`.
- `docker logs voidbinder-db 2>&1 | grep 'ready to accept connections'` prints a line
  (twice on the first start: once for the init server, once for the real one).
- `docker exec voidbinder-db psql -U postgres -Atc "SELECT version()"` starts with
  `PostgreSQL 18.6`.
- `docker exec voidbinder-db psql -U postgres -Atc "SHOW shared_preload_libraries; SHOW ssl; SHOW hba_file; SHOW shared_buffers"`
  prints `timescaledb,pg_stat_statements`, `on`, `/etc/postgresql/pg_hba.conf`, `2GB`.
- `ss -ltn 'sport = :5432'` prints exactly one listener, on `127.0.0.1:5432`, and none on
  `0.0.0.0` or `[::]`: the port exists on the loopback address only.
- `openssl s_client -starttls postgres -connect 127.0.0.1:5432 -brief </dev/null 2>&1 | grep 'Peer certificate'`
  prints `Peer certificate: CN = db.voidbinder.de`: the port reaches Postgres with the certificate
  from this section (this is the path cloudflared uses).
- `sudo ls /var/lib/postgresql/voidbinder/data/PG_VERSION` exists (the data is on the additional
  disk).

**If it fails:** read the last lines of the log first, `docker logs voidbinder-db --tail 50`.

- `docker compose up` stops with `bind source path does not exist`: a file or folder from this
  section is missing, or the disk is not mounted (`findmnt /var/lib/postgresql`). Create what is
  named and start again.
- The container restarts or stays `unhealthy` with `permission denied`, `invalid permissions` or
  `data directory … has wrong ownership` in the log: the data directory does not belong to the
  database user's mapped IDs, or is not mode 700. `PGUID` and `PGGID` must be set (see the
  directory layout above); then
  `sudo chown "$PGUID:$PGGID" /var/lib/postgresql/voidbinder && sudo chmod 700 /var/lib/postgresql/voidbinder`.
  The `docker run … alpine stat` check above must print `1000:1000`.
- `private key file … has group or world access` or `could not load server certificate file`: run
  the `chown` (with `"$PGUID:$PGGID"`) and `chmod` lines of the TLS step again.
- `could not load pg_hba.conf` or `invalid connection type`: a typo in `pg_hba.conf`; compare it
  with the block above.
- Log lines about `archive-push` failing are expected until section 7 and do not make the
  container unhealthy.

**If the loopback port does not work:**

- `docker compose up` fails with `address already in use` or `failed to bind host port
127.0.0.1:5432`: something else already listens on 5432 (a Postgres installed from the OS
  packages, or a container of an earlier try). `ss -ltnp 'sport = :5432'` names the process and
  `docker ps -a` lists leftover containers; stop it, then run `docker compose up -d` again.
- `Connection refused` for `127.0.0.1:5432` on the VPS, or from cloudflared (section 6): the
  container is down or the daemon is. `docker compose ps` must show
  `127.0.0.1:5432->5432/tcp`; if `docker ps` itself fails, `systemctl --user status docker`
  tells why (after a reboot usually missing `loginctl enable-linger`). A port line with another
  host address means the `ports` entry of the compose file was changed.
- `FATAL:  no pg_hba.conf entry for host "…"` in `docker logs voidbinder-db`, with an address that is
  **not** `172.30.0.1`: the published port reaches the container from another address, for example
  after switching the RootlessKit network driver (to `pasta`, say) or the subnet in the compose
  file. Read the address from the log line, and either undo the change or put the same three
  `hostssl` lines in `/opt/voidbinder-db/pg_hba.conf` for that address with `/32`, then
  `docker exec voidbinder-db psql -U postgres -Atc 'SELECT pg_reload_conf()'`. With `172.30.0.1`
  in the message, the user, the database or `hostssl` (the client did not use TLS) is the problem.

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
docker exec -i voidbinder-db psql -U postgres -v ON_ERROR_STOP=1 <<'EOF'
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
docker exec -i voidbinder-db psql -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'EOF'
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
docker exec -it voidbinder-db psql -U postgres -c '\password voidbinder_migrate'
docker exec -it voidbinder-db psql -U postgres -c '\password hyperdrive_dev'
docker exec -it voidbinder-db psql -U postgres -c '\password hyperdrive_prod'
```

**verify:**

- `docker exec voidbinder-db psql -U postgres -c '\l voidbinder*'` lists `voidbinder` and
  `voidbinder_dev` with owner `voidbinder_migrate`.
- `docker exec voidbinder-db psql -U postgres -d voidbinder_dev -c '\dx'` lists
  `timescaledb` 2.30.2 and `pg_stat_statements`.
- `docker exec voidbinder-db psql -U postgres -d voidbinder_dev -c 'SET ROLE hyperdrive_dev; CREATE TABLE ddl_probe (i int)'`
  fails with `ERROR:  permission denied for schema public`. This error is the expected result.

**Apply the app migrations from the workstation.** The migrations create the app's tables. They
run from a clone of the repository on the workstation and reach the database through an SSH
tunnel: a port on your workstation that SSH forwards to the database port on the VPS's loopback address
(`127.0.0.1:5432`, which Docker forwards into the container). Open the tunnel in one
terminal **on the workstation** (local port 15432, since 5434 is the local Docker Postgres):

```sh
ssh -N -L 15432:127.0.0.1:5432 ubuntu@<vps-ip>
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
`docker exec voidbinder-db psql -U postgres -d voidbinder_dev -c 'SET ROLE hyperdrive_dev; SELECT count(*) FROM waitlist_signups'`
prints `0` (the app role can read the migrated table). Same for `-d voidbinder` with
`hyperdrive_prod`.

**If it fails:**

- `ECONNREFUSED` or `connect … 15432`: the tunnel terminal is closed or shows an error. Start it
  again and leave it open.
- `password authentication failed`: the password does not match. Set it again with `\password` on
  the VPS and copy it from the password manager.
- `no pg_hba.conf entry for host "172.30.0.1"`: the user or database name is misspelled, or
  `sslmode` is missing; compare with the `pg_hba.conf` lines in section 4. If the address in the
  message is a different one, the published port reaches the container from another address;
  see the loopback part of the section 4 **If it fails** list.

**Alternative: apply migrations from the VPS itself.** When the workstation that holds the repo
has SSH access to the VPS but no tunnel at hand (Claude's case in Sprint 2), the same migrations run
on the VPS through a throwaway Node container. One-time setup **on the VPS**: clone the repository
to `~/voidbinder` and store the `voidbinder_migrate` connection URLs in
`~/.config/voidbinder/pg.env` (mode 600; `read -rs` asks for the password without showing it):

```sh
git clone https://github.com/derFrisson/Voidbinder.git ~/voidbinder
umask 077; mkdir -p ~/.config/voidbinder; read -rs PW
printf 'PG_MIGRATE_URL_DEV=postgres://voidbinder_migrate:%s@127.0.0.1:5432/voidbinder_dev?sslmode=no-verify\nPG_MIGRATE_URL_PROD=postgres://voidbinder_migrate:%s@127.0.0.1:5432/voidbinder?sslmode=no-verify\n' "$PW" "$PW" > ~/.config/voidbinder/pg.env
unset PW
```

Then, per app and database:

```sh
~/voidbinder/scripts/vps/migrate.sh site dev    # or: api dev, site prod, api prod
```

The script pulls `main`, installs the app's dependencies into a cached pnpm store volume and runs
`pnpm --filter <app> db:migrate` with the matching URL. It uses the host network, so the
connection reaches the container from `172.30.0.1` like any other host connection and matches the
`hostssl … voidbinder_migrate` line in `pg_hba.conf`; nothing is trusted without the password. The
`prod` database gets migrations only after Max's go.

**verify:** the run ends with `migrations applied successfully!`; a second run is a no-op.

**Price history (VB-30).** The API migration `apps/api/drizzle/0004_prices.sql` creates the price
tables and, because `timescaledb` is installed here, turns `prices_daily` into a hypertable: chunks
of one month, columnstore (compression) segmented by `print_id, source` and ordered by
`observed_at DESC`, and a policy that compresses chunks older than 30 days. Nothing to run by hand;
`migrate.sh api dev|prod` applies it like every other migration. Plain PostgreSQL skips this part
(the migration logs a notice). Check after the migration:

```sql
SELECT hypertable_name, compression_enabled FROM timescaledb_information.hypertables;
SELECT proc_name, config FROM timescaledb_information.jobs WHERE hypertable_name = 'prices_daily';
```

`add_columnstore_policy` replaced `add_compression_policy` in TimescaleDB 2.18
([docs](https://www.tigerdata.com/docs/api/latest/hypercore/add_columnstore_policy)); the
migration was checked against `timescale/timescaledb:latest-pg18` (2.30.2).

## 6. Cloudflare Tunnel, Workers VPC and Hyperdrive

This step connects Cloudflare to the database without opening a port. cloudflared on the VPS
dials out to Cloudflare; the Workers VPC service names the container behind that tunnel; Hyperdrive
pools connections to it for the Worker. At the end, a real request to the deployed `dev` Worker
writes a row into the database.

**Create the tunnel** (the Voidbinder one; do not reuse a tunnel of another project). In the
Cloudflare dashboard: Workers & Pages → **Workers VPC** → **Tunnels** → **Create**, name
`voidbinder-db`, **Save tunnel**, choose Debian / 64-bit (the package is the same on Ubuntu) and copy the token (the `eyJ…` string in
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
upgrades install Ubuntu security updates only; cloudflared is updated with the monthly
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

No public hostname and no private network route are needed: the VPC service is the route. cloudflared
runs on the host and reaches Postgres through the port Docker published on `127.0.0.1:5432`
(section 4). A rootless container has no address the host can reach, so the tunnel must target the
loopback address, not a container IP. This is a loopback connection on the VPS itself: it is not
exposed to the internet.

**Create the Workers VPC service** **on the workstation**, in `apps/site` (so wrangler picks up
`account_id` `152a1fcd0eebb96d1bc30d14b5a6af58` from `wrangler.jsonc`):

```sh
cd apps/site
pnpm exec wrangler vpc service create voidbinder-psql \
  --type tcp --tcp-port 5432 --app-protocol postgresql \
  --tunnel-id <tunnel-id> --ipv4 127.0.0.1 \
  --cert-verification-mode verify_ca
```

`verify_ca` checks the certificate chain (Origin CA or Let's Encrypt, section 4) and skips the host
name check, because the service addresses the database by IP (`127.0.0.1`), not by name. (A
`--hostname localhost` service would also work but needs a DNS resolver setting; the IP does not.) With the self-signed
fallback use `--cert-verification-mode disabled` instead, or switch later with
`pnpm exec wrangler vpc service update <vpc-service-id> --name voidbinder-psql --type tcp --tcp-port 5432 --app-protocol postgresql --tunnel-id <tunnel-id> --ipv4 127.0.0.1 --cert-verification-mode <mode>`,
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
  `docker exec voidbinder-db psql -U postgres -d voidbinder_dev -Atc 'SELECT status FROM waitlist_signups'`
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
  service is wrong (it must be `127.0.0.1`, not a container address). Check
  `pnpm exec wrangler vpc service list` against the dashboard.
- Connection refused in the `cloudflared` log (`journalctl -u cloudflared --since -10min`, a line
  such as `dial tcp 127.0.0.1:5432: connect: connection refused`): nothing listens on the loopback
  port. On the VPS, `ss -ltn 'sport = :5432'` must show `127.0.0.1:5432` and `docker compose ps`
  the container as healthy; if the rootless daemon is down, `systemctl --user status docker` says
  why (section 4, **If the loopback port does not work**).
- A Hyperdrive or `psql` error `no pg_hba.conf entry for host "…"`: read the address in the message.
  `172.30.0.1` points to the user, database or TLS; any other address means the published port now
  reaches the container from a different address (section 4, **If the loopback port does not
  work**).
- The `curl` call returns an error page instead of `{"status":"pending"}`: the deployed Worker has
  no Hyperdrive id yet. Check `wrangler.jsonc`, deploy again, and watch the Worker's errors with
  `pnpm exec wrangler tail --env dev` while you repeat the request.

## 7. Backups with pgBackRest to Backblaze B2

This step makes sure the data survives the loss of the VPS. pgBackRest runs inside the database
container (the image ships it); it reaches Postgres through the Unix socket and B2 through its own
S3 client. Plan: a full backup every Sunday, an incremental one on the other days, WAL archived
continuously, four full backups kept (about four weeks of point-in-time recovery). The restore
drill at the end proves the backups can actually be restored.

> [!WARNING]
> **Status on 2026-10-10: this section had never been carried out on the production VPS.** The
> compose file from section 4 already sets `archive_mode=on` and
> `archive_command=pgbackrest … archive-push`, so with no config every archive attempt fails and
> PostgreSQL keeps every WAL segment: 11 GB in `pg_wal` (645 segments), 4,662 failed attempts,
> nothing ever archived, at 09:04 UTC that day. Skipping this section is not neutral, it slowly
> fills the data disk. Check where you stand before anything else:
>
> ```sh
> ls -l /opt/voidbinder-db/pgbackrest/                    # must contain pgbackrest.conf
> crontab -l | grep -c pgbackrest                         # 2
> docker exec voidbinder-db psql -U postgres -XAt -c \
>   "select archived_count, failed_count, last_archived_wal from pg_stat_archiver"
> docker exec voidbinder-db pgbackrest --stanza=voidbinder info
> ```
>
> A missing config shows as `unable to open missing file /etc/pgbackrest/pgbackrest.conf` (the
> directory is bind-mounted into the container at `/etc/pgbackrest`, so the file must be on the
> host in `/opt/voidbinder-db/pgbackrest/`); `failed_count` rising and no `last_archived_wal`
> means archiving never worked. The backups run from the crontab of `ubuntu` on the host (the
> schedule below), not from a container or a timer: no crontab, no backups.
> Once the config, the stanza and the first full backup are in place, `failed_count` stops rising
> and `pg_wal` shrinks as the first archive-push drains the backlog (old WAL from before the first
> backup is not needed for a restore; the backup is the starting point). Check it with
> `du -sh` on `pg_wal` inside the container and `df -h /var/lib/postgresql`.

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
sudo tee /opt/voidbinder-db/pgbackrest/pgbackrest.conf >/dev/null <<EOF
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
sudo chown "$PGUID:$PGGID" /opt/voidbinder-db/pgbackrest/pgbackrest.conf && sudo chmod 600 /opt/voidbinder-db/pgbackrest/pgbackrest.conf
```

**verify:** `sudo grep -E '=$' /opt/voidbinder-db/pgbackrest/pgbackrest.conf` prints nothing (no value is
empty), and `sudo stat -c '%u:%g %a' /opt/voidbinder-db/pgbackrest/pgbackrest.conf` prints your `PGUID:PGGID`
(for example `166535:166535`) and `600`. (`PGUID` and `PGGID` are set in section 4; run those lines
again after a reconnect.)

`repo1-bundle=y` and `repo1-block=y` (block incremental backups need bundling) pack the many small
files into few objects and store only changed blocks, which suits S3; set them before the first
full backup, because they only apply to backups made after. `archive-async=y` with
`archive-push-queue-max=4GiB` is a deliberate trade-off
([docs](https://pgbackrest.org/configuration.html#section-archive/option-archive-push-queue-max)):
when B2 is unreachable for long, pgBackRest drops the queued WAL once 4 GiB are waiting, which
ends point-in-time recovery until the next full backup, instead of letting `pg_wal` fill the data
disk and stop Postgres; the WAL archive check in section 8 alerts long before that.

Expect an `archive-push-queue-max` warning about dropped WAL on the first archive-push after the
fix: the backlog (11 GB on 2026-10-10) is far above 4 GiB. It is harmless here, because the first
full backup follows and is the starting point of any restore.

`tee` keeps the existing file, so owner and mode stay as created in section 4; the `chown` line
makes sure. The file stays in `/opt/voidbinder-db/pgbackrest` and belongs to the database user's mapped ID: the
host never runs pgBackRest itself, only the container does, and `ubuntu` edits the file with
`sudo`. The `ubuntu` login user does not need to read it.

The `archive_command` in the compose file (`pgbackrest --stanza=voidbinder archive-push %p`) is
already active. A stanza is pgBackRest's name for the backup set of one database cluster. Create
it and check archiving:

```sh
docker exec voidbinder-db pgbackrest --stanza=voidbinder stanza-create
docker exec voidbinder-db pgbackrest --stanza=voidbinder check
```

**verify:** `stanza-create` ends with `stanza-create command end: completed successfully`, `check`
with `check command end: completed successfully` (it forces a WAL switch and waits until that
segment is in B2). The bucket now has `pgbackrest/archive/voidbinder/` and
`pgbackrest/backup/voidbinder/`.

**If it fails:** the error line just before `command end: aborted` names the cause.

- `unable to open file '/etc/pgbackrest/pgbackrest.conf'` or `Permission denied`: the file is not
  the database user's `PGUID:PGGID` with mode 600. Run the `chown` line above again (with
  `PGUID` and `PGGID` set).
- `HostConnectError`, `unable to get address` or `403` / `InvalidAccessKeyId` /
  `SignatureDoesNotMatch`: the region, bucket or key is wrong. Compare the file
  (`sudo cat /opt/voidbinder-db/pgbackrest/pgbackrest.conf`) with the password manager entry; the key must have
  access to this bucket.
- `WAL segment … was not archived before the … timeout`: archiving itself fails. Look for
  `archive-push` errors in `docker logs voidbinder-db --tail 50`; they usually point to the
  same key or region problem.

**First full backup:**

```sh
docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=full backup
```

**verify:** `docker exec voidbinder-db pgbackrest --stanza=voidbinder info` shows
`status: ok`, `cipher: aes-256-cbc` and one `full backup` with its timestamp, and
`docker exec voidbinder-db pgbackrest version` prints the pgBackRest version of the image
(`pgBackRest 2.59.3` for the tag above).

**Schedule** (the crontab of `ubuntu`, times in UTC). cron runs the backups by itself every
night. The jobs run as `ubuntu`, because only `ubuntu` can reach the rootless Docker daemon, so
the crontab sets `DOCKER_HOST` itself (cron does not read `~/.bashrc`). The log file is created
first so that `ubuntu` may write to it:

```sh
sudo install -m 640 -o ubuntu -g ubuntu /dev/null /var/log/voidbinder-db-backup.log
crontab - <<EOF
PATH=/usr/local/bin:/usr/bin:/bin
DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock
30 2 * * 0   docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=full backup >>/var/log/voidbinder-db-backup.log 2>&1
30 2 * * 1-6 docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=incr backup >>/var/log/voidbinder-db-backup.log 2>&1
EOF
```

**verify:** `crontab -l` prints the two `DOCKER_HOST`/`PATH` lines and the two jobs, and
`env -i PATH=/usr/bin:/bin DOCKER_HOST=unix:///run/user/$(id -u)/docker.sock docker ps --format '{{.Names}}'`
(Docker with nothing but cron's environment) prints `voidbinder-db`. The next morning
`grep 'command end' /var/log/voidbinder-db-backup.log | tail -n 2` shows
`backup command end: completed successfully` followed by `expire command end: completed
successfully`, and `pgbackrest info` lists one more backup.

**If it fails:** if the log stays empty the next morning, check that cron runs
(`systemctl is-active cron` prints `active`) and read `grep CRON /var/log/syslog | tail`. A log line
`Cannot connect to the Docker daemon` means the rootless daemon was not running (no linger, section 4) or the `DOCKER_HOST` line of the crontab is missing.

**Restore drill.** A backup you have never restored is a hope, not a backup. Run the drill once
now and then every quarter: restore the latest state into a scratch container next to the live
one, compare, throw it away. The live database is not touched; the scratch instance reads from B2
and never archives (`--archive-mode=off`).

> [!WARNING]
> **Before you run this:** the drill writes only to `/var/lib/postgresql/restore-drill` and a
> container named `voidbinder-restore-drill`. Never point `DRILL` at
> `/var/lib/postgresql/voidbinder`, and never leave out `--archive-mode=off`: a drill instance that
> archives would write into the live backup set.

`PGUID` and `PGGID` (section 4, directory layout) must be set in this terminal; the scratch
directory belongs to the database user's mapped IDs like the live one.

```sh
IMAGE=timescale/timescaledb-ha:pg18.6-ts2.30.2
DRILL=/var/lib/postgresql/restore-drill
sudo install -d -o "$PGUID" -g "$PGGID" -m 700 "$DRILL"
docker run --rm \
  -v "$DRILL":/home/postgres/pgdata \
  -v /opt/voidbinder-db/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
  -e PGBACKREST_CONFIG=/etc/pgbackrest/pgbackrest.conf \
  --entrypoint pgbackrest "$IMAGE" --stanza=voidbinder --archive-mode=off restore
docker run -d --name voidbinder-restore-drill \
  -v "$DRILL":/home/postgres/pgdata \
  -v /opt/voidbinder-db/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
  -e PGBACKREST_CONFIG=/etc/pgbackrest/pgbackrest.conf \
  "$IMAGE" postgres -c max_worker_processes=16
```

The restore needs free space for one copy of the data (`df -h /var/lib/postgresql` first). The
scratch instance replays the archived WAL and then opens for writes. Recovery refuses to start
when `max_worker_processes` is lower than on the live server, hence the `-c`; keep it equal to the
compose file.

**verify:**

- `docker logs voidbinder-restore-drill 2>&1 | grep -E 'archive recovery complete|ready to accept connections'`
  shows both lines.
- For each table that matters, the counts match the live database up to the last archived
  segment (at most five minutes old):

  ```sh
  for c in voidbinder-db voidbinder-restore-drill; do
    docker exec "$c" psql -U postgres -d voidbinder -Atc 'SELECT count(*) FROM waitlist_signups'
  done
  ```

**If it fails:** `docker logs voidbinder-restore-drill --tail 50` names the cause. A
`max_worker_processes` error means the `-c` value is lower than in the compose file; a pgBackRest
error during the restore has the same causes as a failing `check` above.

Clean up, in the same terminal (so `DRILL` is still set). The `echo` must print
`/var/lib/postgresql/restore-drill`; if it prints anything else or an empty line, set `DRILL`
again before the `rm`:

```sh
echo "$DRILL"
docker rm -f voidbinder-restore-drill
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
command without `--archive-mode=off`: the restored server must archive again. `PGUID` and `PGGID`
(section 4, directory layout) must be set in this terminal.

```sh
cd /opt/voidbinder-db && docker compose down
sudo mv /var/lib/postgresql/voidbinder /var/lib/postgresql/voidbinder.broken
sudo install -d -o "$PGUID" -g "$PGGID" -m 700 /var/lib/postgresql/voidbinder
IMAGE=timescale/timescaledb-ha:pg18.6-ts2.30.2
docker run --rm \
  -v /var/lib/postgresql/voidbinder:/home/postgres/pgdata \
  -v /opt/voidbinder-db/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
  -e PGBACKREST_CONFIG=/etc/pgbackrest/pgbackrest.conf \
  --entrypoint pgbackrest "$IMAGE" --stanza=voidbinder restore
docker compose up -d
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

1. Do sections 1 to 3: order, base system, additional disk, including the empty data directory
   `/var/lib/postgresql/voidbinder` (mode 0700). Keep that directory; do not `initdb` into it.
2. Do section 4 up to and including the compose file, but do not start the container: install
   Docker, switch it to rootless mode, compute `PGUID` and `PGGID` **again** (the subuid base of the
   new server can differ from the old one, so never copy the numbers) and give the data directory
   to them. The TLS certificate and `pg_hba.conf` are files of the host, not of the data, so they
   are made again (the Origin CA certificate can be issued again for the same name).
3. Write `/opt/voidbinder-db/pgbackrest/pgbackrest.conf` as in this section, from the password manager: the same
   B2 bucket, key and `repo1-cipher-pass`, and the same `[voidbinder]` stanza section. Do not run
   `stanza-create`; the stanza is already in the bucket.
4. Restore into the data directory with the image tag from the compose file:

   ```sh
   IMAGE=timescale/timescaledb-ha:pg18.6-ts2.30.2
   docker run --rm \
     -v /var/lib/postgresql/voidbinder:/home/postgres/pgdata \
     -v /opt/voidbinder-db/pgbackrest/pgbackrest.conf:/etc/pgbackrest/pgbackrest.conf:ro \
     -e PGBACKREST_CONFIG=/etc/pgbackrest/pgbackrest.conf \
     --entrypoint pgbackrest "$IMAGE" --stanza=voidbinder restore
   ```

5. `cd /opt/voidbinder-db && docker compose up -d`.
6. Install cloudflared with the same tunnel token from the password manager (section 6), the
   crontab of `ubuntu` and the health script (sections 7 and 8). The VPC service and the Hyperdrive
   configs stay as they are: they point at the tunnel and at `127.0.0.1:5432`, which the new
   compose file publishes again. The roles and databases of section 5 came back with the restore.

**verify:** `docker logs voidbinder-db 2>&1 | grep -E 'archive recovery complete|ready to accept connections'`
shows both lines, `docker exec voidbinder-db pgbackrest --stanza=voidbinder check` succeeds,
and the row counts match what you expect.

## 8. Operations

This section is the routine after setup: updates, disk space, slow queries, two Kuma alerts
(database and imports), and growing the disk. Set up the alert now; the rest is for when you need it.

**Minor updates** (a new `pg18.x-ts2.y.z` tag, PostgreSQL minor or TimescaleDB release). The OVH
snapshot covers the system disk only, so take both a snapshot and a fresh backup first:

1. OVH control panel → the VPS → **Snapshot → Take a snapshot**.
2. `docker exec voidbinder-db pgbackrest --stanza=voidbinder --type=incr backup`
3. Set the new tag in `/opt/voidbinder-db/docker-compose.yml` (check
   [the tags](https://hub.docker.com/r/timescale/timescaledb-ha/tags); keep `pg18`, no `-oss`,
   no `-all`), then:

   ```sh
   cd /opt/voidbinder-db
   docker compose pull && docker compose up -d
   for db in postgres template1 voidbinder_dev voidbinder; do
     docker exec -i voidbinder-db psql -X -U postgres -d "$db" <<'EOF'
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
the compose file and run `docker compose up -d` again.

**Docker, cloudflared and the OS:** `sudo apt update && sudo apt upgrade` once a month. Docker and
cloudflared come from their own repositories, which unattended upgrades leave alone. Docker's
repository always offers the latest stable release, so an upgrade can bring a new major version:
read the [release notes](https://docs.docker.com/engine/release-notes/) first, and take the
snapshot and the fresh backup of the update procedure above before a Docker upgrade. The upgrade
replaces the programs but not the running rootless daemon, which keeps running the old version
until you restart it. That restart stops the database for a few seconds (the container comes back
by itself, `restart: unless-stopped`):

```sh
systemctl --user restart docker
```

**verify:** `docker version --format '{{.Server.Version}}'` prints the new version, `docker compose ps`
shows `voidbinder-db` as `healthy`, `systemctl is-enabled docker.service docker.socket` still prints
`disabled` twice (the package upgrade did not bring the root daemon back), and
`systemctl status cloudflared` is `active (running)` with the tunnel Healthy.

**Disk usage:**

```sh
df -h / /var/lib/postgresql
docker exec voidbinder-db psql -U postgres -c \
  "SELECT datname, pg_size_pretty(pg_database_size(datname)) FROM pg_database ORDER BY pg_database_size(datname) DESC"
```

Once `prices_daily` is a hypertable, `SELECT * FROM hypertable_columnstore_stats('prices_daily')`
shows how much the compression saves.

**Slow queries** (`pg_stat_statements`, per database):

```sh
docker exec voidbinder-db psql -U postgres -d voidbinder -c \
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
sudo install -m 600 -o ubuntu -g ubuntu /dev/null /etc/voidbinder-db-health.env
read -rsp 'Kuma push URL: ' KUMA_URL; echo
echo "KUMA_PUSH_URL=$KUMA_URL" > /etc/voidbinder-db-health.env
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
(crontab -l; echo '*/15 * * * * /usr/local/bin/voidbinder-db-health >/dev/null') | crontab -
```

The script runs as `ubuntu` from the crontab of section 7 (which already sets `DOCKER_HOST`), so
it needs no `sudo` and no root-owned Docker.

**verify:** `/usr/local/bin/voidbinder-db-health; echo $?` prints `0` and the Kuma monitor
turns green; `crontab -l` ends with the `*/15` line.

**If it fails:** the script prints the reason before the non-zero exit code: a disk at 80 % or
more, a backup older than 36 hours (check `/var/log/voidbinder-db-backup.log`), or a WAL archive
problem (run `pgbackrest check` as in section 7). A `curl` error means the push URL is wrong;
compare `/etc/voidbinder-db-health.env` with Kuma. If it only fails from cron and works in your
shell, the `DOCKER_HOST` line of the crontab is missing.

**Import health (VB-83): a failed or missing import run, as a second Kuma push monitor.** Every
morning at 07:30 UTC `scripts/vps/import-health.sh` (started by `import-health.timer`) asks the prod
API's `GET /admin/imports/health` whether every scheduled import (the Worker crons and the image
mirror here) succeeded within its cadence plus 2 hours, and checks that the last
`catalog-modules` run did not fail (the modules write no `import_runs` row). It pushes `up` with
`OK`, or `down` with the reason (`missing: tcgcsv; failed: scryfall`), so Kuma shows which source
to look at. Create a **Push** monitor in Kuma (heartbeat interval 25 hours, so one push a day
keeps it up and a missing push turns it down; Retries 0) and copy its push URL without the
query. The script reads the prod admin token as `ADMIN_TOKEN_prod` from
`~/.config/voidbinder/api-secrets.env` (step 2 of `docs/guides/go-live.md`; the file is sourced,
so one `NAME=value` per line) and the push URL from `~/.config/voidbinder/kuma.env`. It needs
`curl` and `jq` (section 2). The check expects a daily `image-mirror` run on prod, so the
`Environment="DBS=prod dev"` drop-in of `image-mirror.service` (section 11) must be active: with the
unit's own `DBS=dev`, prod reports `missing: image-mirror` every day.

```sh
umask 077; mkdir -p ~/.config/voidbinder
grep -q '^ADMIN_TOKEN_prod=' ~/.config/voidbinder/api-secrets.env && echo token found
read -rsp 'Kuma import push URL: ' KUMA_URL; echo
echo "KUMA_IMPORTS_PUSH_URL=$KUMA_URL" >> ~/.config/voidbinder/kuma.env
unset KUMA_URL
cd ~/voidbinder && git pull --ff-only
mkdir -p ~/.config/systemd/user
ln -sf ~/voidbinder/scripts/vps/import-health.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now import-health.timer
systemctl --user start import-health && journalctl --user -u import-health -n 5
```

**verify:** the journal ends with `up: OK` (or `down: …` naming a real problem) and the Kuma
monitor shows that heartbeat with its message; `systemctl --user list-timers import-health.timer`
shows the next start at 07:30 UTC.

**If it fails:** `down: import health: GET … failed` means the API did not answer 200: a `401`
is a wrong `ADMIN_TOKEN_prod`, a `404` an `ADMIN_TOKEN` missing on the Worker. A `curl` error on
the push means a wrong push URL. A `down` naming sources is the check working: see
`GET /admin/imports` for the runs and their errors, and step 14 of `docs/guides/go-live.md` for
re-running an import by hand.

**Growing the additional disk.** OVH control panel → the VPS → **Additional disks → Increase the
disk size**, wait until the new size shows, then make the kernel see it. This stops the database
for a minute. Replace `sdb` with your disk's name from section 3.

```sh
echo 1 | sudo tee /sys/class/block/sdb/device/rescan
lsblk /dev/sdb   # must show the new size
cd /opt/voidbinder-db && docker compose down
sudo umount /var/lib/postgresql
sudo e2fsck -f /dev/sdb && sudo resize2fs /dev/sdb
sudo mount /var/lib/postgresql && docker compose up -d
```

**verify:** `df -h /var/lib/postgresql` shows the new size and the container is `healthy` again.

## 9. Security notes

What protects the database, in one place.

- Postgres has no public port: Docker publishes it on `127.0.0.1` only, which the internet cannot
  reach, and `ufw` allows only 22/tcp inbound. Workers reach it through the tunnel, the operator
  through SSH.
- Docker runs rootless. The daemon and the containers belong to `ubuntu` and run in a user
  namespace; the root-owned Docker daemon is disabled. A flaw in the daemon, the container runtime
  or Postgres inside the container leads to an unprivileged account, not to root, and a root
  daemon's door to the whole host (the Docker socket) does not exist. `ubuntu` still has `sudo`
  for administration, so the protection covers an attacker who breaks out of a container or the
  daemon, not one who already holds the `ubuntu` login (that is what SSH keys and the firewall are
  for).
- Rootless mode has limits; one matters here. It forwards published ports in user space and does
  not pass on the client's address, so Postgres sees every login from the same gateway address
  (`172.30.0.1`, section 4): `pg_hba.conf` cannot tell the Cloudflare tunnel from an SSH session.
  The login role, its password, TLS and the per-database grants do that work, and the port is on
  loopback only. The others (no AppArmor profile for the container, no resource limits without
  cgroup v2 and systemd, no overlay networks) do not apply: the container is not privileged, keeps
  Docker's default seccomp profile, and sets no limits.
- SSH accepts keys only and no root login; the KVM console with the `ubuntu` password is the
  fallback.
- Every TCP login needs TLS and SCRAM (`pg_hba.conf`); each Hyperdrive user may only reach its own
  database, from the gateway of the Compose network (where the published port arrives).
- `hyperdrive_dev` and `hyperdrive_prod` have DML rights only, no DDL: they cannot create, alter
  or drop anything. Schema changes go through `voidbinder_migrate` and the SSH tunnel.
- Secrets live on the VPS (`/opt/voidbinder-db/.env`, `/opt/voidbinder-db/pgbackrest/pgbackrest.conf`, the
  cloudflared token file `/etc/cloudflared/token`, `/etc/voidbinder-db-health.env`, each readable
  only by root, `ubuntu` or the database user's mapped ID), in Cloudflare (the Hyperdrive configs) and in the password manager folder
  `Voidbinder DB`. None of them belong in this repository; the Hyperdrive and VPC service ids are
  not secrets.
- Backups in B2 are encrypted by pgBackRest before upload (`repo1-cipher-type`); the B2 key can
  touch only the one bucket, and B2 Object Lock keeps every backup file for 45 days even if the
  VPS and its key are compromised.
- B2 holds the database backups, a provider separate from OVH (database) and Cloudflare (edge).
  App blobs (card images, catalog modules, raw dumps) stay in R2.

## 10. Done

**Take a snapshot of the finished system.** OVH control panel → the VPS → **Snapshot → Take a
snapshot**. If the system disk ever breaks, this brings back the OS, Docker (the rootless daemon,
its images and `ubuntu`'s crontab), cloudflared and all config in minutes; the data comes back
from B2.

Then check that all of this is true:

- [ ] Key login works, password login is refused
      (`ssh -o PubkeyAuthentication=no -o PreferredAuthentications=password ubuntu@<vps-ip>`
      prints `Permission denied (publickey).`), and the `ubuntu` console password is in the
      password manager.
- [ ] `sudo ufw status verbose` shows `Status: active` with only `22/tcp` allowed in.
- [ ] No public 5432: `ss -ltn 'sport = :5432'` on the VPS shows only `127.0.0.1:5432`, and
      `nc -vz -w 5 <vps-ip> 5432` on the workstation fails.
- [ ] Docker is rootless: `docker info | grep rootless` prints `rootless`,
      `systemctl is-enabled docker.service docker.socket` prints `disabled` twice,
      `systemctl --user is-enabled docker` prints `enabled` and
      `loginctl show-user ubuntu -p Linger` prints `Linger=yes`.
- [ ] `findmnt /var/lib/postgresql` shows the additional disk, also after a reboot.
- [ ] `docker compose ps` in `/opt/voidbinder-db` shows `voidbinder-db` as `healthy`.
- [ ] cloudflared is connected: `systemctl status cloudflared` is `active (running)` and the tunnel
      is Healthy in the dashboard.
- [ ] The Hyperdrive test passed: the `curl` sign-up against the `dev` Worker answered
      `{"status":"pending"}` and the row is in `voidbinder_dev`.
- [ ] The Hyperdrive ids are committed in `apps/site/wrangler.jsonc`.
- [ ] `pgbackrest --stanza=voidbinder check` succeeds and `pgbackrest info` shows at least one full
      backup, and `pg_stat_archiver` has `failed_count` 0 (or not rising) and a `last_archived_wal`
      (section 7 shows the query; on 2026-10-10 this item had been ticked without being done).
- [ ] `crontab -l` (as `ubuntu`) lists the backup jobs and the health check, and the next
      morning's log shows a successful backup.
- [ ] The database survives a reboot with nobody logged in: run `sudo reboot`, wait three minutes
      without logging in, then log in; `docker compose ps` in `/opt/voidbinder-db` shows
      `voidbinder-db` as `healthy` with an uptime of a few minutes.
- [ ] The restore drill is done and its row counts matched.
- [ ] Optional: the Uptime Kuma monitor is green.
- [ ] The OVH snapshot above is taken.
- [ ] Every entry of the table in section 0 is in the password manager folder `Voidbinder DB`,
      and none of them is in the repository.

## 11. Image mirror

The card images (Magic from Scryfall, Pokémon from TCGdex, Yu-Gi-Oh! from YGOPRODeck) are copied
once into the R2 bucket `voidbinder-catalog` (EU jurisdiction) and served from `img.voidbinder.de`.
`apps/api/scripts/mirror-images.ts` runs here, not on the workstation: it downloads each image,
stores it as `images/<game>/<source id>/<lang>/orig.<ext>` plus a 320 px WebP copy `sm.webp`
and writes the key into `prints.image_key` / `print_localizations.image_key`. The keys use the
source's ids, so `dev` and `prod` share the objects. Each import Workflow then mirrors the oldest
pending images of its game itself (up to 2000 a day, `orig` only), and a nightly timer here adds
the `sm` copies and retries failures. Details: `apps/api/README.md`, "Card images".

**Node 24.** Skip if `node -v` already prints `v24.…`. Otherwise install it with
[fnm](https://github.com/Schniz/fnm) as `ubuntu` (no root needed), then pnpm through Corepack:

```sh
curl -fsSL https://fnm.vercel.app/install | bash -s -- --skip-shell
export PATH="$HOME/.local/share/fnm:$PATH"; eval "$(fnm env --shell bash)"
fnm install 24 && fnm default 24
corepack enable
```

**Repository and dependencies.** The clone from section 5 ("Alternative: apply migrations from
the VPS itself"); if it is missing,
`git clone https://github.com/derFrisson/Voidbinder.git ~/voidbinder`.

```sh
cd ~/voidbinder && git pull --ff-only && pnpm install --filter api
```

**R2 credentials.** In the Cloudflare dashboard: R2 → Manage API tokens → Create API token,
permission **Object Read & Write**, only the bucket `voidbinder-catalog`, jurisdiction EU. Store
the values in the password manager (`Voidbinder R2 image mirror`) and on the VPS, mode 600:

```sh
umask 077; mkdir -p ~/.config/voidbinder; read -rs KEY_ID; read -rs SECRET
printf 'R2_ACCESS_KEY_ID=%s\nR2_SECRET_ACCESS_KEY=%s\n' "$KEY_ID" "$SECRET" \
  > ~/.config/voidbinder/r2.env
echo 'R2_ENDPOINT=https://<account-id>.eu.r2.cloudflarestorage.com' >> ~/.config/voidbinder/r2.env
echo 'R2_BUCKET=voidbinder-catalog' >> ~/.config/voidbinder/r2.env
unset KEY_ID SECRET; ls -l ~/.config/voidbinder/r2.env   # -rw-------
```

**Database role.** The mirror logs in as `voidbinder_mirror`, which can read the catalog, set the
image keys and record its run, nothing else. `postgres` creates the login; the table grants come
from the tables' owner `voidbinder_migrate` (`SET ROLE`):

```sh
docker exec -i voidbinder-db psql -U postgres -v ON_ERROR_STOP=1 <<'EOF'
CREATE ROLE voidbinder_mirror LOGIN;
GRANT CONNECT ON DATABASE voidbinder_dev, voidbinder TO voidbinder_mirror;
EOF

for db in voidbinder_dev voidbinder; do
docker exec -i voidbinder-db psql -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'EOF'
SET ROLE voidbinder_migrate;
GRANT USAGE ON SCHEMA public TO voidbinder_mirror;
GRANT SELECT ON sets, prints, print_localizations TO voidbinder_mirror;
GRANT UPDATE (image_key) ON prints, print_localizations TO voidbinder_mirror;
GRANT SELECT, INSERT, UPDATE ON import_runs TO voidbinder_mirror;
GRANT SELECT, INSERT, DELETE ON image_sources_gone TO voidbinder_mirror;
EOF
done
docker exec -it voidbinder-db psql -U postgres -c '\password voidbinder_mirror'
```

The password like the others (`openssl rand -base64 32 | tr -d '/+='`, password manager entry
`voidbinder_mirror`). `import_runs` has a generated UUID key, so no sequence grant is needed.
`image_sources_gone` (VB-89) comes with migration `0015`, which grants it to `voidbinder_mirror`
itself when the role already exists; on a database migrated before the role was created, the
line above does it. Add
this line to `/opt/voidbinder-db/pg_hba.conf` (section 4) and reload:

```text
hostssl  voidbinder_dev,voidbinder voidbinder_mirror   172.30.0.1/32   scram-sha-256
```

```sh
docker exec voidbinder-db psql -U postgres -c 'select pg_reload_conf()'
```

Then add its URLs to `~/.config/voidbinder/pg.env` (mode 600, next to `PG_MIGRATE_URL_*`):

```sh
read -rs PW; U="postgres://voidbinder_mirror:$PW@127.0.0.1:5432"; Q='sslmode=no-verify'
echo "PG_MIRROR_URL_DEV=$U/voidbinder_dev?$Q" >> ~/.config/voidbinder/pg.env
echo "PG_MIRROR_URL_PROD=$U/voidbinder?$Q" >> ~/.config/voidbinder/pg.env
unset PW U Q
```

**Run.** `--db dev|prod` takes `PG_MIRROR_URL_DEV` / `PG_MIRROR_URL_PROD` (without `--db` the
script uses `DATABASE_URL`). Start with a dry run, then a short real one, then the full run in
`tmux` so it survives a dropped SSH session:

```sh
cd ~/voidbinder
ENV="--env-file $HOME/.config/voidbinder/r2.env --env-file $HOME/.config/voidbinder/pg.env"
pnpm --filter api mirror-images $ENV --db dev --game mtg --limit 200 --dry-run
pnpm --filter api mirror-images $ENV --db dev --game mtg --limit 200
tmux new -s mirror
pnpm --filter api mirror-images $ENV --db dev 2>&1 | tee ~/mirror-$(date +%F).log
```

Options: `--game mtg|pokemon|yugioh` (default all), `--limit N` (rows: a print or a localization,
oldest first), `--concurrency N` (parallel downloads, default 8), `--sm` (also add the 320 px copy
to rows that have only `orig`, read from the bucket), `--verify` (`HEAD` the objects first and
skip the download when they exist: after a crash, and for the second database, whose objects the
first one stored), `--dry-run` (read and plan only, logs a sample of keys). `--db prod` only after
Max's go.

**One mirror at a time.** A run holds a lock in its database; a second run on the same database
(or the Workflow's daily step) stops with `another image mirror is running on this database`.
The lock does not reach across databases: never run `dev` and `prod` side by side, least of all
for `yugioh` and `pokemon`, whose rate limits count per IP. Mirror one database, then the other
with `--verify`.

**Throughput.** Each source has its own rate limit: Scryfall 20 images/s, YGOPRODeck 15/s (its
limit is 20, and a breach blocks the IP for an hour), TCGdex 8/s. A 429 stops the run. Magic is
about 160,000 images (every print in English plus the German prints) at 20/s, a little over two
hours and roughly 30 GB; Yu-Gi-Oh! about 15 minutes; Pokémon about 80 minutes. The second database
with `--verify` downloads nothing it shares with the first. The log prints a progress line every
500 images and a summary at the end; the run is also a row in `import_runs` (`kind = 'images'`)
with the same counts.

**Rerun.** Safe at any time: the script picks only rows without `image_key` (with `--sm` also
those with only `orig`), so a run that stopped (Ctrl-C, 429, reboot) continues where it was.
Failed downloads are logged (`image failed`) and stay as they were for the next run. A source
that answers `404` or `410` counts as `gone`, not `failed` (`image source gone` in the log): its
URL goes to `image_sources_gone` and later runs skip it until the row's URL changes; the Sunday
(UTC) runs retry every gone URL and drop the ones that answer again. To list them:
`select url, seen_at, lang from image_sources_gone order by seen_at`.

**Low-res Magic scans.** A Magic print whose Scryfall image is only `lowres` (`highres_image`
false; about 3,000 prints, mostly sets from 2022 on) is mirrored too, under names of its own:
`images/mtg/<scryfall id>/<lang>/orig-lowres.jpg` and `sm-lowres.webp`, and `image_key` gets
that key. The objects are cached as `immutable` for a year, so the high-res scan cannot reuse
`orig.jpg`. Once a later Scryfall import sets `highres_image` to true, the print is pending again:
the next run stores the scan as `orig.jpg` / `sm.webp` and replaces the key (a key is only ever
replaced by a better one: `sm.webp`, `orig.<ext>`, `sm-lowres.webp`, `orig-lowres.jpg`). The
low-res objects stay in the bucket as orphans. `placeholder` and `missing` images stay keyless,
and localizations still wait for a high-res scan (the API shows the print's key for them).

**Nightly timer.** `scripts/vps/image-mirror.service` and `.timer` (systemd user units) run the
mirror at 05:30 UTC for all games with `--sm --verify`, one database after the other: the `sm`
copies of the Workflows' daily `orig` images, and every failure of the day. Install once as
`ubuntu` (linger keeps user timers running without a login):

```sh
sudo loginctl enable-linger ubuntu
mkdir -p ~/.config/systemd/user
ln -sf ~/voidbinder/scripts/vps/image-mirror.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now image-mirror.timer
```

It mirrors `dev` only (`Environment=DBS=dev`). After Max's go for prod, add a drop-in with the
value **in quotes** (systemd splits an unquoted `Environment=DBS=prod dev` at the space and
drops `dev`):

```sh
mkdir -p ~/.config/systemd/user/image-mirror.service.d
cat > ~/.config/systemd/user/image-mirror.service.d/override.conf <<'EOF'
[Service]
Environment="DBS=prod dev"
EOF
systemctl --user daemon-reload
systemctl --user show image-mirror.service -p Environment   # DBS=prod dev
```

(`systemctl --user edit image-mirror.service` writes the same `override.conf`.) This is the
state on the VPS since 2026-10-10. Each run pulls `main` first. Logs: `journalctl --user -u image-mirror -n 50`; start one by
hand with `systemctl --user start image-mirror`.

**verify:** the dry run lists `rows` and `images`; after the short run,

```sh
docker exec voidbinder-db psql -U postgres -d voidbinder_dev -tAc \
  "select count(*) from prints where image_key like '%/sm.webp'"
```

is above zero, and `curl -sI https://img.voidbinder.de/<one image_key>` answers `200` with
`cache-control: public, max-age=31536000, immutable` (once the custom domain is connected).
`systemctl --user list-timers image-mirror.timer` shows the next start at 05:30 UTC.

## 12. Offline catalog modules

The app works offline from one SQLite file per game (sets, cards, prints, English and German
names and texts, image keys, display prices and a name index), built here every night from the
catalog and published to the public bucket `voidbinder-catalog` under `modules/<db>/<game>/`
with a `manifest.json` and a delta from the previous version. Schema and the app's side:
[docs/architecture/catalog-module.md](../architecture/catalog-module.md); the script is
`apps/api/scripts/build-catalog-module.ts`. Needs Node 24, the clone and `r2.env` from section 11.

**Database role.** The builder logs in as `voidbinder_mirror` (section 11) and only reads. On top
of the image mirror's grants it needs the rest of the catalog and the current prices:

```sh
for db in voidbinder_dev voidbinder; do
docker exec -i voidbinder-db psql -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'EOF2'
SET ROLE voidbinder_migrate;
GRANT SELECT ON cards, set_localizations, prices_current, app_meta TO voidbinder_mirror;
EOF2
done
```

**Run by hand.** `--db dev|prod` as for the mirror; `--out` keeps the last module per game, the
source of the next delta (`<out>/<game>/`). Without `--upload` the files and the manifest stay in
`--out` only:

```sh
cd ~/voidbinder && pnpm install --filter api... && pnpm --filter "api^..." build
ENV="--env-file $HOME/.config/voidbinder/r2.env --env-file $HOME/.config/voidbinder/pg.env"
pnpm --filter api build-catalog-module $ENV --db dev --game yugioh --out ~/catalog-modules/dev
pnpm --filter api build-catalog-module $ENV --db dev --game yugioh --out ~/catalog-modules/dev --upload
```

With `--upload` a game whose published manifest already has the current `catalog_version` is
skipped (logged `catalog module up to date`). Otherwise the script builds from one consistent
snapshot, uploads `catalog-<game>-v<version>.sqlite.gz`, the delta
`catalog-<game>-v<from>-v<version>.sql.gz` when the published version's module is still in
`--out`, and the manifest last; then it deletes everything in `<out>/<game>/` but the new module.
A game without prints (One Piece today) is skipped. The log line `catalog module built` has the
row counts and the sizes. `--db prod` only after Max's go.

**Nightly timer.** `scripts/vps/catalog-modules.service` and `.timer` run at 06:30 UTC, after the
imports and the image mirror, for Yu-Gi-Oh!, Pokémon and Magic. Install once as `ubuntu` (linger
from section 11):

```sh
ln -sf ~/voidbinder/scripts/vps/catalog-modules.{service,timer} ~/.config/systemd/user/
systemctl --user daemon-reload && systemctl --user enable --now catalog-modules.timer
```

It builds `dev` only (`Environment=DBS=dev`). After Max's go for prod, add a drop-in, again with
the values in quotes:

```sh
mkdir -p ~/.config/systemd/user/catalog-modules.service.d
cat > ~/.config/systemd/user/catalog-modules.service.d/override.conf <<'EOF'
[Service]
Environment="DBS=prod dev"
Environment="GAMES=yugioh pokemon mtg"
EOF
systemctl --user daemon-reload
systemctl --user show catalog-modules.service -p Environment   # DBS=prod dev and GAMES=yugioh pokemon mtg
```

The unit in the repo already sets `GAMES=yugioh pokemon mtg`; the `GAMES` line is there because
the unit systemd had loaded on the VPS still said `GAMES=yugioh` (a unit file changed on disk is
not used until `daemon-reload`). The drop-ins on the VPS are in
`~/.config/systemd/user/{image-mirror,catalog-modules}.service.d/override.conf`; `systemctl
--user cat <unit>` shows the unit and its drop-ins as systemd sees them. Logs: `journalctl --user -u catalog-modules -n 50`; start one by hand with
`systemctl --user start catalog-modules`.

**Disk.** `~/catalog-modules/<db>/` holds one unpacked module per game (Magic about 150 MB) and,
during a run, the new one next to it.

**verify:** `curl -s https://img.voidbinder.de/modules/dev/yugioh/manifest.json` shows the
version, size and SHA-256; `GET /catalog/modules` on the dev API answers the same manifests;
`systemctl --user list-timers catalog-modules.timer` shows the next start at 06:30 UTC.

## 13. Price history backfill

`apps/api/scripts/backfill-prices.ts` fills `prices_daily` with TCGplayer's past prices from
TCGCSV's daily archive (`https://tcgcsv.com/archive/tcgplayer/prices-<YYYY-MM-DD>.ppmd.7z`, from
2024-02-08), one day at a time: download, unpack the three games, insert the mapped prices,
delete the files. Details: `apps/api/README.md`, "History backfill". Needs Node 24 and the clone
from section 11.

**Archive status.** On 2026-10-10 every archive URL answered `403` "The price archive has been
temporarily removed due to rising server costs" (from the workstation and from this VPS). The
script stops on that answer. Check before a run:
`curl -s -o /dev/null -w '%{http_code}\n' https://tcgcsv.com/archive/tcgplayer/prices-2024-02-08.ppmd.7z`
must print `200`.

**7-Zip.** The archive is 7z with PPMd, which needs the `7z` command (package `7zip`, installed
on 2026-10-10):

```sh
sudo apt install -y 7zip && 7z | head -2
```

**Database role.** The script logs in as `voidbinder_mirror` (section 11; it already reads
`prices_daily` and `price_mappings` from section 12's grants on `voidbinder_dev`). It also needs
to insert into `prices_daily`, and nothing else: no `UPDATE`, no `prices_current`. In each
database once it is migrated (granted on `voidbinder_dev` on 2026-10-10; on `voidbinder` after the
prod catalog is imported). A grant on the hypertable reaches its chunks, so no per-chunk grant:

```sh
for db in voidbinder_dev voidbinder; do
docker exec -i voidbinder-db psql -U postgres -d "$db" -v ON_ERROR_STOP=1 <<'EOF2'
SET ROLE voidbinder_migrate;
GRANT SELECT ON price_mappings, prices_daily TO voidbinder_mirror;
GRANT INSERT ON prices_daily TO voidbinder_mirror;
EOF2
done
```

**Run.** `--db dev|prod` (or `DBS=dev|prod`) takes `PG_MIRROR_URL_DEV` / `PG_MIRROR_URL_PROD`
from `pg.env`, never the migrate or superuser URL. `--from` / `--to` (default 2024-02-08 to
yesterday, both included), `--delay-ms` (pause between days, default 2000), `--dry-run` (downloads and maps, writes nothing),
`--refill` (ignores the progress file and the rows already there, see Rerun).
**First run: check the archive by hand.** The URL scheme and the folder layout come from TCGCSV's
FAQ and have not been checked against a real file, and neither has the assumption that
`prices-<D>` holds day D's ~20:00 UTC build (the daily import's `observedAt` day). With the archive
reachable, download one day, run `7z l prices-<D>.ppmd.7z | head` and confirm `<D>/<category>/<group>/prices`.
Then compare with a day the daily import wrote, `--refill` so that day is not skipped:
`pnpm --filter api backfill-prices $ENV --db dev --from <D> --to <D> --refill --dry-run` logs a
`sample` of rows; the same print and finish must have the same prices in `prices_daily` for `<D>`.
If they match the previous day instead, the archive is named for the day after its build. The
script stops on its own when a day unpacks no group for a game or three days in a row have no
archive.

A short range first, then the full range in `tmux` or a transient user unit so it survives a
dropped SSH session:

```sh
cd ~/voidbinder && git pull --ff-only && pnpm install --filter api
ENV="--env-file $HOME/.config/voidbinder/pg.env"
pnpm --filter api backfill-prices $ENV --db dev --from 2026-09-01 --to 2026-09-07 --dry-run
pnpm --filter api backfill-prices $ENV --db dev --from 2026-09-01 --to 2026-09-07
systemd-run --user --unit price-backfill-dev --working-directory="$HOME/voidbinder" \
  -p Environment=PATH="$PATH" pnpm --filter api backfill-prices $ENV --db dev
journalctl --user -u price-backfill-dev -f
```

Each day logs `price backfill day` with the rows per game (`groups`, `rows`, `unmapped`,
`noMarket`) and `inserted`; the end logs `price backfill finished`. `--db prod` only after the
prod catalog and its first daily TCGCSV import (the mappings come from that import).

**Rerun.** Safe at any time. A day is written in one transaction, so a stopped run leaves it
whole or absent. A day that has `tcgplayer` rows (the daily import's or an earlier run's) is
skipped without a download, `ON CONFLICT DO NOTHING` never changes an existing row, and
`~/.local/state/voidbinder/price-backfill-<db>.json` records every finished day (rows inserted, or
`missing` for a day without an archive). A day with rows is never fetched again by a plain rerun,
so to add what is missing (after a mapping fix, or once more sets are imported) run
`--refill --from X --to Y`: it downloads every day of the range regardless, and
`ON CONFLICT DO NOTHING` inserts only the missing rows.

**Disk.** One day's archive and its three unpacked games under `~/.cache/voidbinder/price-backfill`,
deleted after the day; the folder is cleared at every start, so a killed run leaves nothing for long.

**verify:**

```sh
docker exec voidbinder-db psql -U postgres -d voidbinder_dev -tAc "
  select observed_at::date, s.game_id, count(*) from prices_daily d
  join prints p on p.id = d.print_id join sets s on s.id = p.set_id
  where d.source = 'tcgplayer' and observed_at >= '2026-09-01' group by 1, 2 order by 1, 2"
```

lists rows per day and game, and `GET /catalog/prints/<id>/prices/history?days=60` on the dev
API (cache-busted, or after the edge cache is purged) has points for the backfilled days.
