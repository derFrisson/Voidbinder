#!/bin/sh
# Daily dump of Plausible's Postgres (users, sites, settings; the events live in ClickHouse, see
# docs/guides/analytics-plausible.md). Run by plausible-backup.service; keeps 14 days.
set -eu
dir=/opt/plausible/backups
f="$dir/plausible_db-$(date -u +%F).dump"
docker compose -f /opt/plausible/compose.yml exec -T plausible_db \
  pg_dump -U postgres -Fc plausible_db >"$f.tmp"
mv "$f.tmp" "$f"
find "$dir" -name 'plausible_db-*.dump' -mtime +14 -delete
