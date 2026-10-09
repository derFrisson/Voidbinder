# 0001: Stack and monorepo layout

- Status: Accepted
- Decided by: Max, 2026-10-09

## Context

Voidbinder is an open-source trading card collection app (Pokémon, Yu-Gi-Oh!, Magic: The
Gathering, One Piece) for iOS, Android and web, with a promo website first. Mobile, web and the API
should share domain logic and schemas, and the backend should run on Cloudflare without locking
the domain code to it.

## Decision

- **Monorepo** with pnpm workspaces and Turborepo:
  - `apps/site`: promo website (Astro).
  - `apps/app`: mobile and web app (Expo).
  - `apps/api`: API (Cloudflare Worker with Hono).
  - `packages/core`: platform-agnostic domain logic.
  - `packages/shared`: Zod schemas and types.
- **TypeScript strict** everywhere, from one `tsconfig.base.json`.
- **Promo website:** Astro with static output on Cloudflare (Workers static assets via
  `@astrojs/cloudflare`), plus a small Worker endpoint for the waitlist.
- **Backend:** Workers + Hono with Smart Placement, PostgreSQL via Hyperdrive with Drizzle (pg),
  R2, Cloudflare Images, Cron Triggers / Workflows / Queues, KV, Vectorize, Durable Objects and
  Better Auth.
- **Platform seams:** Cloudflare bindings are used only in `apps/api/src/platform/cloudflare`.
  `packages/core` depends on the interfaces `CardStore`, `BlobStore`, `VectorIndex` and `JobQueue`,
  never on Cloudflare APIs.

## Consequences

- One install, one lockfile and one CI pipeline for every app; packages are consumed via the
  `workspace:` protocol.
- Domain logic stays testable in plain Node and portable to another host by implementing the four
  interfaces.
- Local development uses PostgreSQL in Docker; production uses Hyperdrive in front of it.
- Changing any of the above needs a new ADR approved by Max.
