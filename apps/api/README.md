# apps/api

Reserved for the Voidbinder API: a Cloudflare Worker with Hono and Smart Placement, PostgreSQL
via Hyperdrive with Drizzle, R2, KV, Queues, Durable Objects and Better Auth. Cloudflare
bindings live only in `src/platform/cloudflare`; `packages/core` talks to them through the
`CardStore`, `BlobStore`, `VectorIndex` and `JobQueue` interfaces. See
[ADR 0001](../../docs/adr/0001-stack.md).

No code yet.
