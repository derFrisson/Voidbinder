# Voidbinder

Voidbinder (working title, powered by Voidcom) is an open-source app for collectors of Pokémon,
Yu-Gi-Oh!, Magic: The Gathering and One Piece trading cards. It runs on iOS, Android and the web
and keeps your collection, decks and wish lists in one place.

It is planned to include an offline card scanner, Cardmarket and TCGplayer prices, a deck builder
and a Twitch Streamer Kit. The source is public under the AGPL-3.0.

## Status

Pre-alpha. The current sprint builds the promo website [voidbinder.de](https://voidbinder.de);
the app and the API come after it.

## Workspace layout

| Path              | What                                                                                                                              |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `apps/site`       | Promo website (Astro on Cloudflare Workers static assets)                                                                         |
| `apps/app`        | Mobile and web app (Expo), reserved                                                                                               |
| `apps/api`        | API (Cloudflare Worker with Hono, PostgreSQL via Hyperdrive, R2), [README](apps/api/README.md)                                    |
| `packages/core`   | Platform-agnostic domain logic                                                                                                    |
| `packages/shared` | Zod schemas and shared types                                                                                                      |
| `docs`            | [ADRs](docs/adr), [environments](docs/environments.md), [database VPS runbook](docs/guides/database-vps.md), agent briefing rules |

## Getting started

Requires Node 24 (see `.nvmrc`) and pnpm via Corepack (`corepack enable`).

```sh
pnpm install && pnpm dev
```

`pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` run across the workspace through
Turborepo.

## Contributing

Architecture decisions live in [docs/adr](docs/adr). A CONTRIBUTING guide is to come.

## License

[GNU Affero General Public License v3.0](LICENSE).
