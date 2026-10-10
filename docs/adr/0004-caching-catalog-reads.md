# 0004: Caching for catalog and price reads

- Status: Accepted
- Decided by: Max, 2026-10-09 (the two cached configurations exist: dev `80164a75f1224f34a30fc31f0dac35ca`, prod `095f0ec41117431c8b29eec7134dde62`; `voidbinder-prod` updated to caching disabled, 10 connections)
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

## Addendum, 2026-10-10: Workers cache layer (VB-71)

Asked for by Max (2026-10-10, "Cloudflare cache optimisations"). Zone Cache Rules never apply to
responses a Worker generates, so until now the `s-maxage=600` of decision 2 was cached by no one at
Cloudflare. Workers Caching (Cloudflare docs "Workers / Cache", fetched 2026-10-10) puts a cache in
front of the Worker itself, on workers.dev, the custom domain and service bindings alike.

Decision:

- `"cache": { "enabled": true }` in every environment of `apps/api/wrangler.jsonc`. It stores
  GET/HEAD answers by their headers (RFC 9111), so the user-scoped routes stay uncached through the
  `no-store` they already send; a test asserts that for `/me`, `/collection`, `/decks` and `/auth`.
- The catalog, price and module answers keep `Cache-Control: public, max-age=60, s-maxage=600` for
  browsers and other caches, now with `stale-while-revalidate=60`, and add
  `Cloudflare-CDN-Cache-Control: public, max-age=600, stale-while-revalidate=600` for the edge.
  The second header exists because `s-maxage` disables stale-while-revalidate at Cloudflare
  (RFC 9111 4.2.4); Cloudflare strips it before the response leaves.
- Each answer carries a `Cache-Tag`: `modules` for the module manifests, `catalog` for every other
  catalog answer, plus `prices` where it embeds a price (the set page, the card page, the search
  and the price routes), so a price-only import refreshes every page that shows the old price.
  Every importer purges its tags after `finish run`: YGOPRODeck and TCGdex `catalog`, TCGCSV
  `prices`, and Scryfall `catalog` and `prices` in one purge after its price step. No per-game
  tags: every catalog import purges all of `catalog` anyway. The ETag on `catalog_version` stays
  the browsers' signal.
- The purge waits six minutes after `finish run` (a Workflow `step.sleep`). An entry purged at once
  would be refilled through the cached Hyperdrive configuration of decision 1, which can still
  serve the pre-import rows for `max_age` + `stale_while_revalidate` (360 s), and the edge would
  keep those for another ten minutes. After the wait every refill reads the new rows.
- A purge only reaches the cache of the entrypoint that calls it, and each Workflow is its own
  entrypoint. The default export becomes a `WorkerEntrypoint` class with a `purgeCache(tags)` RPC
  method, and the Workflows call it through `exports.default` (`src/platform/cloudflare/cache.ts`,
  the only place besides the Workflow classes that imports `cloudflare:workers`).

Ceilings, written down: an import's changes reach the edge about six minutes after its finish;
the edge serves an answer up to 20 minutes old when a purge fails (it is logged and never fails
the import); the module manifests are purged by nothing yet, so a new module shows up within 10 to
20 minutes; Workers Caching uses the Free plan's purge rate limits whatever the plan, which the
handful of purges a day stays far below; each deploy starts with a cold cache, since the Worker
version is part of the cache key; `wrangler dev` does not emulate it, so the hit
(`cf-cache-status: HIT`) is checked on dev after a deploy.
