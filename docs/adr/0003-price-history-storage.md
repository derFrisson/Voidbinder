# 0003: Price history is stored, not fetched, and where it lives

- Status: Proposed (Max decides the provider; options below)
- Raised by: Max, 2026-10-09 ("we will store the price data, querying the API every time is too expensive")

## Context

Prices are never looked up live. Every day the pipeline (ADR 0001, Jira VB-30) writes one row per
print and source into `prices_daily` (integer cents, currency, source, observed_at) and keeps the
raw source dumps in R2 so history can be recomputed after a mapping fix. The site's waitlist shares
the same PostgreSQL. Expected growth, uncompressed:

| Stage                                                       | Rows per day | Per year    |
| ----------------------------------------------------------- | ------------ | ----------- |
| Launch: Magic, Yu-Gi-Oh!, Pokémon from TCGplayer, one price | ~500 k       | ~5 GB       |
| Plus Cardmarket, prices per language and finish             | 2 to 4 M     | 20 to 40 GB |
| Plus real per-condition prices, One Piece                   | ~5 M         | ~50 GB      |

Time-series compression (TimescaleDB) shrinks daily price rows by roughly 10 to 20 times. The
TimescaleDB features that matter here (compression, continuous aggregates) are licensed under the
Timescale License, which no third-party managed provider may host; managed providers ship only the
Apache-2 edition (hypertables, chunking, retention). The full edition is available self-hosted
(`timescale/timescaledb-ha`, permitted for our own product) or on Tiger Cloud.

## Options

1. **Self-hosted PostgreSQL + TimescaleDB Community on Max's infrastructure**, reached by Workers
   through a Cloudflare Tunnel, Workers VPC service and Hyperdrive (the pattern the Voidcom website
   already uses). Full Timescale, EU, cost is storage only. Backups (pgBackRest), upgrades and
   monitoring are ours.
2. **Tiger Cloud (Timescale) in an EU region.** Full Timescale, managed, Hyperdrive supported.
   Highest price of the three.
3. **A managed Postgres with the Apache-2 edition or plain partitioning** (Neon, PlanetScale,
   Aiven, Scaleway): native monthly partitions via pg_partman or a cron, older partitions exported
   as Parquet to R2. Cheapest to start, no compression, more of our own tooling later.

## Decision

Pending. Whatever the provider, the schema stays the same: `prices_current` plus `prices_daily`
partitioned by month (hypertable chunks when Timescale is available), raw dumps in R2, and the
`CardStore` seam so a Docker self-host can use plain Postgres.

## Consequences

- The provider choice affects Sprint 2 (VB-23 API foundation, VB-30 price pipeline), not Sprint 1.
- Compression is a Timescale-only feature; choosing option 3 means accepting ~5 GB per year now and
  an archive strategy before the second growth stage.
