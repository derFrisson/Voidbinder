# 0003: Price history is stored, not fetched, and where it lives

- Status: Accepted
- Raised by: Max, 2026-10-09 ("we will store the price data, querying the API every time is too expensive")
- Decided by: Max, 2026-10-09

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
   through a Cloudflare Tunnel, Workers VPC service and Hyperdrive (the pattern planned for the Voidcom
   website). Full Timescale, EU, cost is storage only. Backups (pgBackRest), upgrades and
   monitoring are ours.
2. **Tiger Cloud (Timescale) in an EU region.** Full Timescale, managed, Hyperdrive supported.
   Highest price of the three.
3. **A managed Postgres with the Apache-2 edition or plain partitioning** (Neon, PlanetScale,
   Aiven, Scaleway): native monthly partitions via pg_partman or a cron, older partitions exported
   as Parquet to R2. Cheapest to start, no compression, more of our own tooling later.

## Decision

Option 1. PostgreSQL 18 with TimescaleDB Community edition (`timescale/timescaledb-ha`) runs
self-hosted on an OVH VPS-2 (4 vCores, 8 GB RAM, 75 GB NVMe system disk, 50 GB additional block
disk for the data, snapshot option) in Gravelines, France. `prices_daily` becomes a hypertable with
compression (columnstore policy), which keeps its growth under 1 GB per year at the launch stage.
Price history is stored, never fetched, so a compressed local table is cheaper than any lookup; the
Timescale License features it needs exist only self-hosted or on Tiger Cloud. Workers reach the
database only through a Cloudflare Tunnel, a Workers VPC service and Hyperdrive; the server has no
public Postgres port.

Storage is split by kind:

- **Database backups** go to Backblaze B2 (EU Central) with pgBackRest, which has its own S3
  client (no AWS SDK). B2 is a provider separate from the database (OVH) and the edge
  (Cloudflare), so an incident on the OVH account cannot take the database and its backups
  together. B2 Object Lock (a bucket default retention longer than the backup window) protects the
  backups against a compromised VPS, whose B2 key could otherwise delete them.
- **App blobs** (card images, catalog modules, raw source dumps) stay in R2: native Worker
  binding, no egress fees. The `BlobStore` seam keeps other stores possible.

Whatever the provider, the schema stays the same: `prices_current` plus `prices_daily` partitioned
by month (hypertable chunks when Timescale is available), raw dumps in R2, and the `CardStore` seam
so a Docker self-host can use plain Postgres.

Max operates the server following the runbook [database-vps.md](../guides/database-vps.md), which
Claude drafts and keeps current.

## Consequences

- Sprint 2 (VB-23 API foundation, VB-30 price pipeline) builds on this server; VB-30 adds the
  hypertable and the compression policy. The waitlist moves onto it as soon as the runbook is done.
- Backups, minor upgrades, monitoring and the quarterly restore drill are ours; the runbook lists
  each step. A PostgreSQL major upgrade needs its own ticket.
- Compression is a Timescale-only feature; had option 3 been chosen, it would have meant ~5 GB per
  year now and an archive strategy before the second growth stage.
