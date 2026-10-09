# apps/api-go

The Voidbinder API in Go: `net/http`, PostgreSQL through `pgx`, and R2 through its S3 API. It
serves the same routes, headers, error shape and access log as [`apps/api`](../api/README.md) and
runs as a single static binary, in a container next to PostgreSQL on the VPS
([ADR 0003](../../docs/adr/0003-price-history-storage.md)) or anywhere else.

## Layout

| Path                  | What                                                                            |
| --------------------- | ------------------------------------------------------------------------------- |
| `cmd/api`             | Entry point: configuration from the environment, pools, graceful shutdown       |
| `internal/api`        | `api.New(cfg)`: routes, middleware, error handling, the `slog` JSON logger      |
| `internal/voidbinder` | Domain types and rules (`Game`, `Locale`, `CardKey`, email, waitlist sign-up)   |
|                       | and the platform interfaces `CardStore`, `BlobStore`, `JobQueue`, `VectorIndex` |
| `internal/postgres`   | The pool and `CardStore` on PostgreSQL                                          |
| `internal/r2`         | `BlobStore` on R2 or any S3-compatible store                                    |

## Configuration

| Variable               | Default                 | What                                                                        |
| ---------------------- | ----------------------- | --------------------------------------------------------------------------- |
| `DATABASE_URL`         | required                | PostgreSQL connection string                                                |
| `PORT`                 | `8787`                  | Listen port                                                                 |
| `APP_URL`              | `http://localhost:8081` | Web app origin admitted by CORS                                             |
| `VERSION`              | `local`                 | Reported by `GET /health`                                                   |
| `R2_ENDPOINT`          | unset                   | `https://<account>.r2.cloudflarestorage.com`; unset disables the blob store |
| `R2_ACCESS_KEY_ID`     |                         | R2 API token                                                                |
| `R2_SECRET_ACCESS_KEY` |                         | R2 API token secret                                                         |
| `R2_BUCKET`            | `voidbinder-catalog`    | Bucket name                                                                 |

## Local development

Needs Go (version in `go.mod`) and the Docker Postgres from the repository root
(`docker compose up -d`, port 5434).

```sh
export DATABASE_URL=postgres://voidbinder:voidbinder@localhost:5434/voidbinder
pnpm --filter @voidbinder/api-go dev    # go run ./cmd/api on http://localhost:8787
curl localhost:8787/health              # {"status":"ok","db":"ok","version":"local"}
```

## Tests

```sh
pnpm --filter @voidbinder/api-go test
DATABASE_URL=postgres://voidbinder:voidbinder@localhost:5434/voidbinder pnpm --filter @voidbinder/api-go test
```

`internal/api` runs the server through `httptest` with a fake `CardStore`. With `DATABASE_URL`
set, `internal/postgres` pings the real database.

## Migrations

The schema stays in `apps/api/drizzle/`. Apply it exactly as described in the
[`apps/api` README](../api/README.md#migrations).

## Container

```sh
docker build --build-arg VERSION=$(git rev-parse --short HEAD) -t voidbinder-api apps/api-go
docker run --rm -p 8787:8787 -e DATABASE_URL=... voidbinder-api
```
