# 0006: D1 as a read-only search index in front of PostgreSQL

- Status: Accepted
- Decided by: Max, 2026-10-10 ("klingt richtig gut, also quasi ein Hot-Cache-Layer"), Jira VB-98

## Context

The typeahead (`GET /catalog/search/suggest`, VB-79) fires on every keystroke. Uncached it took
170 to 420 ms end to end from Frankfurt, cached 110 ms: the network to the database server in
Gravelines (Tunnel, Workers VPC, Hyperdrive) dominates, not the query. The edge cache only helps
for a query someone already typed.

Cloudflare D1 (SQLite) runs next to the Worker and can keep read replicas in every region
(read replication with the Sessions API, `withSession('first-unconstrained')` reads the nearest
copy). Facts from the D1 docs (fetched 2026-10-10): 10 GB per database on Workers Paid, at most
100 bound parameters per query, 100 KB per SQL statement, 30 s per query, a `batch()` is one
transaction; FTS5 is supported (the trigram tokenizer works in D1 and locally in workerd);
replicas cost nothing extra, billing is rows read (25 billion a month included) and rows written
(50 million included, an index row counts as a written row). Read replication is switched on per
database in the dashboard or with the REST API, not with wrangler. D1 takes SQL statements, not a
SQLite file: the offline catalog modules (VB-29) cannot be loaded into it.

## Decision

- **D1 holds a copy of what the typeahead reads, nothing more:** sets with their localized
  names, prints (numbers, keys, image keys, the English card name), the localized names and every
  distinct lower-case name with its pg_trgm trigrams in an FTS5 table (`apps/api/d1/`). No card
  texts, no prices, no user data. One database per environment (`voidbinder-search-dev`,
  `voidbinder-search-prod`, location hint `weur`, no jurisdiction so replicas can follow the
  users), read replication on.
- **PostgreSQL stays the source of truth.** The Workflow `SearchIndexRefresh` copies it: after
  every catalog import (Scryfall, YGOPRODeck, TCGdex), and in full with
  `POST /admin/search-index/rebuild`. It hashes every set in Postgres and rewrites the sets whose
  hash differs, one D1 transaction per chunk of about 1000 prints, then deletes sets gone from
  Postgres. Single-flight through a lock row; a second run waits.
- **The typeahead reads D1 first** through the `SearchIndex` seam (`packages/core`), tier for tier
  as the Postgres typeahead ranks (the same `parseCodeQuery`, JS twins of `catalog_code_key`,
  `catalog_number_key` and pg_trgm's `similarity`, the same image pick). It falls back to
  Postgres when D1 errors, when the index was never synced or its last refresh is older than 36 h,
  or when it has no suggestion. `x-search-source: d1|postgres` and a log line say which answered.
- **The full search (`GET /catalog/search`) stays on Postgres.** It matches card texts, which the
  index does not hold (measured on the local catalog: `light` finds 2585 prints in Postgres, 1265
  by name alone; even code queries like `neo 5` lose text matches), and its page needs prices
  from Postgres anyway, so D1 could not save its round trip.
- **D1 is not the main database.** PostgreSQL keeps the catalog, prices (TimescaleDB, ADR 0003),
  users, collections and decks: they need transactions across tables, writes from many users,
  `pg_trgm`/`tsvector`, compressed time series and backups we control. D1 is a derived, rebuildable
  cache that can be thrown away and refilled from Postgres in minutes.

## Consequences

- The typeahead answers from the user's region without a Postgres round trip; its ETag uses the
  index's `catalog_version`. Postgres load for typing drops to the fallbacks.
- A catalog change reaches the typeahead after the import's refresh (minutes), plus the edge
  cache, which the refresh purges once it changed something.
- A full rebuild of the local catalog (148,000 prints, 249,000 names) writes about 1.8 million
  D1 rows (well inside the included 50 million a month); a daily refresh rewrites only the changed
  sets. The local index file is about 150 MB of the 10 GB limit.
- Two places rank the typeahead. The parity test (`d1-search-index.test.ts`) runs the same
  queries against both and expects identical answers; a change to the Postgres typeahead needs the
  same change in `d1-search-index.ts`. Both end their orderings in an id, so ties answer the same.
  Names equal in length sort by the database's collation in Postgres and by bytes in D1.
- Self-hosting without D1 works: without the `SEARCH` binding the typeahead reads Postgres.
- Searching card texts from D1 would need the texts in the index (larger, and a ranking unlike
  `ts_rank`); that is a decision of its own.
