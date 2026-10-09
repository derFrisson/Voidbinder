# 0004: Caching for catalog and price reads

- Status: Proposed (Max decides)
- Raised by: Max, 2026-10-09 ("we should definitely use caching for card data queries")

## Context

The web app (Sprint 2) reads the catalog (games, sets, cards, prints) and the prices far more
often than anything is written: the importers write once a day, users read all day. The same
database also holds data that must be fresh on every read: Better Auth sessions, the user's
collection and decks right after an edit, the waitlist row the site reads right after it writes it.

Hyperdrive caches read queries per configuration, blindly: it does not invalidate a cached
`SELECT` when the application writes, it serves the cached row until `max_age` (default 60 s,
at most 1 h) plus `stale_while_revalidate` (default 15 s) has passed, and any query that mentions
a `STABLE` or `VOLATILE` function (`now()`, `random()`, even in a comment) is never cached.
Cloudflare's own guidance for read-after-write consistency is two configurations on the same
database: one cached for reads that tolerate staleness, one cache-disabled for auth, sessions,
permissions and reads after writes
([Query caching](https://developers.cloudflare.com/hyperdrive/concepts/query-caching/),
fetched 2026-10-09).

Today `voidbinder-dev` has caching disabled (10 origin connections, as the runbook creates it);
`voidbinder-prod` has caching on with the defaults and 60 origin connections, which drifts from the
runbook and lets the waitlist read a stale row (VB-59).

## Decision

Two layers, both explicit about what may be stale:

1. **Hyperdrive, two configurations per environment on the same database.**
   `voidbinder-<env>` stays cache-disabled with 10 origin connections and is used by the site and
   by every API path that needs fresh data (auth, profile, collection, decks, wishlist, the
   importers, admin). A new `voidbinder-<env>-cached` with `max_age` 300 s,
   `stale_while_revalidate` 60 s and 10 origin connections is used only by the API's catalog and
   price read repositories. The API binds both (`HYPERDRIVE` and `HYPERDRIVE_CACHED`) and the
   `createPlatform(env)` seam hands the cached pool only to the catalog and price stores, so no
   other code can read through it by accident.
2. **HTTP cache on the catalog and price responses.** The API answers those routes with
   `Cache-Control: public, max-age=60, s-maxage=600` and an `ETag` derived from the response plus
   the `catalog_version` row in `app_meta`. Every importer run bumps `catalog_version` at the
   end, which changes every ETag at once, so a client or Cloudflare's cache never serves a
   pre-import answer past its `max-age`. Prices are imported once a day (TCGCSV around 20:00
   UTC); a staleness of minutes is acceptable there and is labelled in the UI with source and
   date anyway.

Not now: KV for hot lookups (the HTTP cache covers it until measured), Cloudflare Images (paid),
Hyperdrive caching for anything user-specific.

Ceilings, written down: Hyperdrive `max_age` tops out at 1 h, and a cached read can be up to
`max_age + stale_while_revalidate` old after an import; the two configurations per environment
mean up to 20 pooled connections per environment, 40 for dev and prod together, plus the site's
10 per environment, against a PostgreSQL `max_connections` of 100 on the VPS. Raising any pool
needs a look at that number first.

## Consequences

- `voidbinder-prod` is updated to `--caching-disabled --origin-connection-limit 10` (closes
  VB-59), and `voidbinder-dev-cached` / `voidbinder-prod-cached` are created with
  `--max-age 300 --swr 60 --origin-connection-limit 10` (Max runs it, the `hyperdrive_<env>`
  password is asked interactively; runbook section 6 gets the two commands).
- `apps/api` gets the second binding, the catalog and price stores use it, the HTTP cache
  headers and the `catalog_version` bump ship with the catalog (VB-26) and price (VB-30) tickets
  and are tested (cache key, TTL, invalidation after a bump).
- Self-hosters without Hyperdrive get the same behaviour from the HTTP layer alone; the seam
  takes one pool when only one is configured.
