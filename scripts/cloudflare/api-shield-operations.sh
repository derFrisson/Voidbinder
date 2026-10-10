#!/usr/bin/env bash
# Registers the API's operations in API Shield → Endpoint Management (free on every plan) for the
# zone voidbinder.de, so the dashboard shows per-endpoint insights and recommendations.
# Needs a zone-scoped API token with "API Gateway: Edit" in CLOUDFLARE_ZONE_TOKEN (never commit it).
# Usage: CLOUDFLARE_ZONE_TOKEN=… scripts/cloudflare/api-shield-operations.sh [zone-id]
set -euo pipefail
zone="${1:-04a035c26cc37192571ef71b4ef1fd10}"
: "${CLOUDFLARE_ZONE_TOKEN:?set CLOUDFLARE_ZONE_TOKEN}"
dir="$(cd "$(dirname "$0")" && pwd)"
curl -fsS -X POST "https://api.cloudflare.com/client/v4/zones/$zone/api_gateway/operations" \
  -H "Authorization: Bearer $CLOUDFLARE_ZONE_TOKEN" -H 'Content-Type: application/json' \
  --data @"$dir/api-shield-operations.json" | python3 -c 'import sys,json; d=json.load(sys.stdin); print("success:", d.get("success"), "operations:", len(d.get("result",[])), "errors:", d.get("errors"))'
