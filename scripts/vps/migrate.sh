#!/usr/bin/env bash
# Usage: vps-migrate.sh <site|api> <dev|prod>. Runs drizzle-kit migrate for one app against one
# database from the VPS: the repo clone in ~/voidbinder, Node 24 in a throwaway container on the
# host network (the published port 127.0.0.1:5432 reaches the container from 172.30.0.1, which
# pg_hba allows for voidbinder_migrate over TLS), the password from ~/.config/voidbinder/pg.env.
set -euo pipefail
app="${1:?site|api}"; env="${2:?dev|prod}"
set -a; . "$HOME/.config/voidbinder/pg.env"; set +a
case "$env" in dev) url="$PG_MIGRATE_URL_DEV";; prod) url="$PG_MIGRATE_URL_PROD";; *) echo "env must be dev|prod"; exit 2;; esac
cd "$HOME/voidbinder" && git fetch -q origin && git checkout -q main && git reset -q --hard origin/main && git log --oneline -1
docker volume create voidbinder-pnpm-store >/dev/null
docker run --rm --network host \
  -v "$HOME/voidbinder:/repo" -v voidbinder-pnpm-store:/root/.local/share/pnpm \
  -w /repo -e DATABASE_URL="$url" \
  node:24-alpine sh -c "corepack enable >/dev/null 2>&1; pnpm install --frozen-lockfile --filter $app --ignore-scripts >/dev/null 2>&1 && pnpm --filter $app db:migrate"
