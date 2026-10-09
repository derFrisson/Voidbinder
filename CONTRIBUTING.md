# Contributing

Voidbinder is a pnpm and Turborepo monorepo. Read the [README](README.md) first, then the
[ADRs](docs/adr) for the fixed decisions: [stack](docs/adr/0001-stack.md),
[deploys](docs/adr/0002-deploys-from-workstation.md),
[price history](docs/adr/0003-price-history-storage.md) and
[catalog caching](docs/adr/0004-caching-catalog-reads.md). Environments and deploys are in
[docs/environments.md](docs/environments.md). Documentation layout is in [docs/README.md](docs/README.md).

## Workflow

1. Branch from `main`. Never push to `main`.
2. Make small commits in the conventional style (`feat(api): add card search`,
   `docs: fix link`). Mention the ticket key when there is one.
3. Open a pull request. Say what changed and how you checked it.
4. CI runs one job, `check`: `pnpm format:check`, `pnpm lint`, `pnpm typecheck`, `pnpm test`,
   `pnpm build`. Run the same commands locally first. Prettier is enforced; `pnpm format` fixes
   files.
5. Deploys are not part of a PR. They run from the maintainer's workstation
   ([ADR 0002](docs/adr/0002-deploys-from-workstation.md)).

Dependencies: use the latest stable release, and an older major only for a named hard
incompatibility. pnpm 12 enforces `minimumReleaseAge` (24 hours). If the newest release is younger,
give the range a floor that admits the previous release. Never turn the policy off.

Never commit secrets, `.env` or `.dev.vars` files, or personal data. Commit a `.dev.vars.example`
when an app needs secrets.

## Repo layout

| Path              | What                                                                 |
| ----------------- | -------------------------------------------------------------------- |
| `apps/site`       | Promo website (Astro)                                                |
| `apps/api`        | Hono API on Cloudflare Workers, see [its README](apps/api/README.md) |
| `apps/app`        | Expo app, reserved                                                   |
| `packages/core`   | Domain logic and platform interfaces, no runtime bindings            |
| `packages/shared` | Zod schemas and types shared by API and clients                      |
| `packages/tokens` | Design tokens                                                        |

## Platform seams

`packages/core/src/platform` defines four interfaces. Domain code and routes depend only on these,
never on a concrete service. **Only `apps/api/src/platform/cloudflare` touches Cloudflare
bindings.** `createPlatform(env)` there builds the implementations, and `createApp(deps)` takes an `openPlatform()` factory, so tests pass fakes and need no binding.

- **`CardStore`**: the catalog and collection database. Today it has `ping()` for the health
  check; the catalog work adds the queries. An implementation must be safe to create per request
  and must not hold state between requests.
- **`BlobStore`**: object storage for card images, catalog modules and raw source dumps.
  `put`, `get`, `head`, `delete` and `list(prefix, cursor)`. `get` and `head` return `null` for a
  missing key, deleting a missing key is not an error, and `list` pages through a cursor. Bodies
  are structural byte streams, so core needs no DOM or Workers types.
- **`JobQueue`**: background work such as catalog imports and price runs. `send({ type, payload })`
  only. The contract is at-least-once delivery (decided 2026-10-10, see the interface's doc comment), so every job must be safe to run twice. Interface
  only so far.
- **`VectorIndex`**: nearest-neighbour search over card image embeddings for the scanner.
  `upsert` vectors by id, `query(values, topK)` returns ids with scores. Interface only so far.

Current Cloudflare implementations: `DrizzleCardStore` (PostgreSQL through Hyperdrive) and
`R2BlobStore` (R2). A change to an interface needs an ADR if it affects more than one
implementation.

### Docker adapter (sketch, not built)

A Docker-only setup without Cloudflare would implement the same interfaces. This table is a
starting point for a contributor, not a design.

| Interface     | Cloudflare today               | Docker sketch                                                     |
| ------------- | ------------------------------ | ----------------------------------------------------------------- |
| `BlobStore`   | R2 bucket                      | Local filesystem, or MinIO over the S3 API                        |
| `CardStore`   | Drizzle on Hyperdrive          | Drizzle on a direct connection to plain PostgreSQL                |
| `JobQueue`    | not built (planned: Queues)    | A Postgres table plus a worker loop with `FOR UPDATE SKIP LOCKED` |
| `VectorIndex` | not built (planned: Vectorize) | `pgvector` in the same PostgreSQL                                 |

The HTTP side would also need a Node entry point for the Hono app, because `src/index.ts` is a
Worker. Put a new adapter in its own folder next to `src/platform/cloudflare` and keep that folder
free of the other one's imports.

## Adding a game importer

Importers turn a free public source into catalog rows. The Magic importer from Scryfall is the
pattern; it lands with the catalog work (VB-26), so check `apps/api` for the current module before
you start. Follow these rules:

- Read the source's bulk files, not its search API, and keep to its rate limits.
- Save the raw dump through `BlobStore` before you parse it.
- Test the parser against small committed fixtures, never against the live source.
- Upserts are idempotent: running the same import twice changes nothing.
- Record every run in an `import_runs` table (source, start, end, counts, outcome). The table
  arrives with the catalog work; create it there if it is still missing.
- Re-host images if the source asks for it. Never hotlink.

## Legal rules

- No game or publisher logos, and no logo-like wordmarks.
- No scraping of Cardmarket, TCGplayer or any site whose terms forbid it. Use official or licensed
  APIs.
- Respect each data source's terms: Scryfall attribution and no paywall on card data, YGOPRODeck
  re-hosting and rate limit.
- Keep the fan-project notices for each game in place. The texts and their sources are in
  [docs/marketing/card-imagery-legal.md](docs/marketing/card-imagery-legal.md).
- Do not commit card art or card text unless the source's terms allow it.
