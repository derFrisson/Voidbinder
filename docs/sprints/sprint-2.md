# Sprint 2 report: web app with card data (2026-10-09 to 2026-10-10)

Sprint goal: the web app first, at the basic cardcluster.de level: API foundation, authentication,
catalog with importers for Magic, Yu-Gi-Oh! and Pokémon, self-hosted public images, prices with
history, search, card and set pages, a collection filled by hand, a deck builder, README and
CONTRIBUTING. Result: **every deliverable shipped to the dev deployment within one night and the following
morning**; Max reviewed the dev app on 2026-10-10 ("mega stark") and asked for two-factor
authentication and more price coverage before going live.

## What shipped

| Area          | Result                                                                                                                                                                                                                                                                                                                                                                    | PRs                     | Tickets                             |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------- | ----------------------------------- |
| Platform      | `apps/api` on Hono with Smart Placement, two Hyperdrive pools (fresh and cached, ADR 0004), R2 (public images, private raw dumps), typed RPC client, structured logs, CI with a Postgres service; VPS migration script; Cloudflare Workflows and crons for every importer                                                                                                 | #28 #29 #31 #32 #34     | VB-23 VB-58 VB-59                   |
| Design        | tokens package consumed by the site and the app; four approved mockup screens; `docs/app/design.md`                                                                                                                                                                                                                                                                       | #30 #35                 | VB-54 VB-55                         |
| Auth          | Better Auth 1.7 with verification mails, password reset, database rate limits, cookie sessions plus bearer, profile with language, currency and training-data opt-in, deletion request                                                                                                                                                                                    | #38                     | VB-24                               |
| Catalog       | schema (games, sets, cards, prints with variants, localizations, tsvector search), Scryfall importer (103,435 prints, en + de), YGOPRODeck importer (44,266 prints per code and rarity), TCGdex importer (21,290 prints, en + de, incremental refresh)                                                                                                                    | #39 #43 #44             | VB-26 VB-27 VB-28                   |
| Images        | public mirror in R2 behind img.voidbinder.de, stable keys per source id, VPS script with sharp for the small variant, daily delta in every Workflow, nightly timer; dev holds about 150,000 images (28 GB)                                                                                                                                                                | #42 #49                 | VB-57                               |
| Prices        | TCGCSV daily import with matcher, confidence and manual overrides, Scryfall EUR/USD, `prices_current` and the `prices_daily` hypertable with columnstore policy, condition estimates, read routes with ETag; dev holds 498,747 current prices                                                                                                                             | #46                     | VB-30                               |
| Web app       | Expo SDK 57 web export on a Worker that proxies /api; shell per the mockups; home, sets, set page with facets and filters, search, card page with prices and history, collection with binders, wishlist, value and CSV export, deck builder with per-game rules, legality, missing cards and their cost; auth and profile screens; German and English; axe on every route | #45 #47 #48 #50 #51 #52 | VB-25 VB-56 VB-35 VB-64 VB-31 VB-34 |
| Docs and site | README with self-hosting, CONTRIBUTING with the platform seams, research "how other sites show card images", no "hosted in Germany" claims                                                                                                                                                                                                                                | #33 #36 #37 #40         | VB-36 VB-61                         |

## Decisions recorded

- ADR 0004 caching (two Hyperdrive configurations per environment, HTTP cache with an ETag tied to `catalog_version`), accepted by Max.
- All card images self-hosted and public (Max), raw source dumps in a private bucket, no Cloudflare Images (paid; the small variant is made on the VPS).
- Yu-Gi-Oh! prints are per set code and rarity (`prints.variant`).
- JobQueue is at-least-once; signing in withdraws a deletion request; no TCGCSV cron on dev; raw dumps expire (dev 3 days, prod Scryfall 14 days).
- No price-history backfill: TCGCSV's archive is offline (VB-63).

## Open

- In progress right after the sprint: VB-68 two-factor authentication, VB-65 prices round 2 (the finish mismatch Max found on a Yu-Gi-Oh! card page), VB-70 Card Nexus feeds as a Cardmarket EUR source (needs Max's key and CardNexus's written terms), VB-69 the production go-live checklist (Max's go).
- Prod: migrations, imports, mirror and the app on app.voidbinder.de only with Max's go.
- Follow-ups: VB-62 privacy policy for app accounts, VB-63 backfill, VB-65 prices round 2, VB-66 web app polish, the lawyer questions (two documents), the Wizards notice in German.

## Numbers

| Metric               | Value                                                                               |
| -------------------- | ----------------------------------------------------------------------------------- |
| Pull requests merged | 25 (#28 to #52)                                                                     |
| API tests            | 257                                                                                 |
| App tests            | 140 unit plus Playwright and axe on every route                                     |
| Dev catalog          | 1,645 sets, 69,905 cards, 168,991 prints                                            |
| Dev prices           | 498,747 current rows, 355,363 daily rows                                            |
| Dev images           | about 150,000, 28 GB                                                                |
| Subagent runs        | 30 build or fix agents, 22 reviews; two session-limit pauses of about one hour each |
