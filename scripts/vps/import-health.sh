#!/usr/bin/env bash
# Usage: import-health.sh. The daily import check (VB-83), run on the database VPS by
# import-health.timer: asks the prod API whether every scheduled import succeeded within its
# cadence (GET /admin/imports/health) and whether the last catalog-modules run (which writes no
# import_runs row) failed, then pushes up or down with the reason to an Uptime Kuma push monitor.
# Reads ADMIN_TOKEN_prod from ~/.config/voidbinder/api-secrets.env and KUMA_IMPORTS_PUSH_URL
# (https://<kuma-host>/api/push/<token>, no query) from ~/.config/voidbinder/kuma.env.
# Installation: docs/guides/database-vps.md, section 8.
set -euo pipefail
set -a
. "$HOME/.config/voidbinder/api-secrets.env"
. "$HOME/.config/voidbinder/kuma.env"
set +a
api="${VOIDBINDER_API_URL:-https://api.voidbinder.de}"

push() {
  echo "$1: $2"
  curl -fsS -m 10 -o /dev/null -G "$KUMA_IMPORTS_PUSH_URL" \
    --data-urlencode "status=$1" --data-urlencode "msg=$2"
}

# The token goes through a file descriptor, not the command line (ps shows arguments).
if ! health=$(curl -fsS -m 30 -H @<(printf 'Authorization: Bearer %s\n' "$ADMIN_TOKEN_prod") \
  "$api/admin/imports/health"); then
  push down "import health: GET $api/admin/imports/health failed"
  exit 1
fi
ok=$(jq -r .ok <<<"$health")
msg=$(jq -r .message <<<"$health")
if systemctl --user is-failed --quiet catalog-modules.service; then
  [ "$ok" = true ] && msg="catalog-modules failed" || msg="$msg; catalog-modules failed"
  ok=false
fi
if [ "$ok" = true ]; then push up "$msg"; else push down "$msg"; exit 1; fi
