# Voidbinder

Voidbinder (working title, powered by Voidcom) is an open-source collection manager for Pokémon,
Yu-Gi-Oh!, Magic: The Gathering and One Piece trading cards. It keeps your collection, decks and
wish lists in one place. The first release is a web app; iOS and Android apps with an offline card
scanner follow. The source is public under the AGPL-3.0.

## Status

Pre-alpha. Sprint 2 builds the web app. Today only the promo site
([voidbinder.de](https://voidbinder.de)) and the API foundation exist, and nothing else is public
yet. Planned: the card scanner, Cardmarket and TCGplayer prices, a deck builder and a Twitch
Streamer Kit. Nothing in this list is available today.

## Workspace

| Path              | What                                                                         |
| ----------------- | ---------------------------------------------------------------------------- |
| `apps/site`       | Promo website (Astro on Cloudflare Workers static assets)                    |
| `apps/api`        | API (Cloudflare Worker with Hono, PostgreSQL via Hyperdrive, R2)             |
| `apps/app`        | The app (Expo, web first; iOS and Android follow), Worker for the web build  |
| `packages/core`   | Platform-agnostic domain logic and the platform interfaces                   |
| `packages/shared` | Zod schemas and shared types                                                 |
| `packages/tokens` | Design tokens (colours, type, space) for the site and the app                |
| `docs`            | Index in [docs/README.md](docs/README.md); decisions in [docs/adr](docs/adr) |

## Getting started

Requires Node 24 (see `.nvmrc`), pnpm through Corepack (`corepack enable`) and Docker for the local
database.

```sh
docker compose up -d        # PostgreSQL 18 on localhost:5434
pnpm install
pnpm dev                    # the site (Astro dev server)
pnpm --filter api dev       # the API on http://localhost:8787, in a second terminal
```

The API needs its migrations once: `DATABASE_URL=postgres://voidbinder:voidbinder@localhost:5434/voidbinder pnpm --filter api db:migrate`.
Tests, lint and types run across the workspace through Turborepo:

```sh
pnpm lint && pnpm typecheck && pnpm test && pnpm build
DATABASE_URL=postgres://voidbinder:voidbinder@localhost:5434/voidbinder pnpm test   # with the database tests
```

Details per app: [apps/api/README.md](apps/api/README.md), [docs/site/waitlist.md](docs/site/waitlist.md).

## Self-hosting

Be clear about what works today.

- **Today:** the stack targets Cloudflare (Workers, Hyperdrive, R2) plus your own PostgreSQL. You
  run it from your own Cloudflare account with `wrangler`. TimescaleDB is recommended for price
  history because compression shrinks it roughly 10 to 20 times; plain PostgreSQL works without
  compression ([ADR 0003](docs/adr/0003-price-history-storage.md)). The runbook for the database
  server is [docs/guides/database-vps.md](docs/guides/database-vps.md); environments, config and
  deploys are in [docs/environments.md](docs/environments.md). The runbook and the `wrangler.jsonc`
  files use the project's own account and domain names. Replace them with yours.
- **Not there yet:** a Docker-only setup without Cloudflare. It needs adapters for the platform
  interfaces, sketched in [CONTRIBUTING.md](CONTRIBUTING.md#platform-seams). Nobody has built them.

### Data sources and rights

Voidbinder reads free public card data and stores it locally. If you run an instance, these rules
apply to you too:

- **Magic:** card data and images come from [Scryfall](https://scryfall.com/docs/api). Show the
  data-source notice (see the legal fact sheet), do not paywall the data, do not imply Scryfall's
  endorsement, and do not crop or alter card images or hide the copyright and artist line. Respect the
  rate limits (use the bulk files). The Wizards of the Coast Fan Content Policy needs its notice
  verbatim and no Wizards logos.
- **Yu-Gi-Oh!:** [YGOPRODeck](https://ygoprodeck.com/api-guide/) asks you to download and re-host
  images. Do not hotlink them, and stay under 20 requests per second. The names and texts
  YGOPRODeck lacks in German, French, Italian, Spanish and Portuguese come from
  [Yugipedia](https://yugipedia.com) under CC BY-SA 4.0: keep the attribution (source and licence
  linked) and wait one second between requests.
- **Pokémon:** card data comes from [TCGdex](https://tcgdex.dev) (MIT licence). Voidbinder is not
  endorsed by TCGdex. The image mirror re-hosts the card images instead of hotlinking them. Pokémon
  offers no fan-content licence; show its notice: "Pokémon and Pokémon character names are
  trademarks of Nintendo. Card images and text are © The Pokémon Company, Nintendo, Game Freak
  and/or Creatures. Voidbinder is not produced by, endorsed by, supported by, or affiliated with
  Pokémon, Nintendo, Game Freak or Creatures."
- **One Piece:** no importer exists yet. Check the research below before you add card art. Card
  art and text belong to their owners.
- **Prices:** no scraping of Cardmarket or TCGplayer. Prices come from
  [TCGCSV](https://tcgcsv.com), a daily republication of TCGplayer's public price data (not an
  official API), and from Scryfall's bulk data (Cardmarket EUR and TCGplayer USD for Magic).
- **Notices:** an instance must show the Wizards Fan Content notice verbatim and should show the unofficial-fan-project notice for each other game it serves. The
  texts, with sources and open legal questions, are in
  [docs/marketing/card-imagery-legal.md](docs/marketing/card-imagery-legal.md). That file is
  research, not legal advice.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the workflow, the platform seams and how to add a game.
Architecture decisions live in [docs/adr](docs/adr).

## License

[GNU Affero General Public License v3.0](LICENSE).
