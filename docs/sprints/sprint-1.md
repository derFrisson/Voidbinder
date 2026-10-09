# Sprint 1 report: promo website (2026-10-09)

Sprint goal: the monorepo foundation and the promo website voidbinder.de in German and English
with a double-opt-in waitlist, legal pages, SEO, WCAG 2.2 AA and Lighthouse mobile 95+, launched
with Max's go. Result: **launched on 2026-10-09**, all 14 sprint items done, 24 pull requests merged.

## What shipped

| Area                          | Result                                                                                                                                                                                                                                                                                                         | Tickets                    |
| ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------- |
| Foundation                    | pnpm 12 + Turborepo 2.11, TypeScript 6 strict, ESLint 10, Vitest 5, CI (lint, typecheck, test, build, actions pinned), branch protection on `main`, ADRs 0001 to 0003, agent briefing rules                                                                                                                    | VB-14, VB-46               |
| Site                          | Astro 7 + @astrojs/cloudflare 14 on one Worker with assets; design direction B "Der Scan" (own brand, light page, colour fields per game, phone mockups, hero scan motion); DE and EN (en-US) routing with language negotiation on the language subtag; original example cards only, no logos or real card art | VB-15, VB-16, VB-51, VB-52 |
| Waitlist                      | Double opt-in with Cloudflare Email Service, PostgreSQL via Hyperdrive, HMAC unsubscribe tokens, one-click unsubscribe, rate limit, honeypot, daily retention purge (30 days unconfirmed, 365 days unsubscribed), 30+ handler tests                                                                            | VB-17, VB-47               |
| Legal                         | Impressum and privacy policy (DE binding, EN courtesy) with the operator details, no placeholder may remain (test)                                                                                                                                                                                             | VB-18, VB-22               |
| SEO and security              | Seo component, OG images at build time, sitemap, robots, 404s, hash-less CSP with no inline code, HSTS, Referrer-Policy, Permissions-Policy, COOP                                                                                                                                                              | VB-19                      |
| Accessibility and performance | axe-core WCAG 2.2 AA over every page, both viewports, light and dark, in CI; manual checklist; Lighthouse mobile /de/ and /en/: 99 / 100 / 100 / 100                                                                                                                                                           | VB-20                      |
| Database                      | OVH VPS-2 (Ubuntu 24.04, rootless Docker, TimescaleDB 2.30 on PG 18), Cloudflare Tunnel + Workers VPC + Hyperdrive, pgBackRest to Backblaze B2; runbook written for self-hosters and corrected on Max's first live run                                                                                         | VB-50                      |
| Launch                        | Dev deployment for review, production deploy to voidbinder.de and www, waitlist round trip verified                                                                                                                                                                                                            | VB-21, VB-22               |

## Decisions recorded

- ADR 0001 stack (fixed by the brief), ADR 0002 deploys from the workstation (no Cloudflare token in CI), ADR 0003 price history is stored, self-hosted TimescaleDB on OVH with B2 backups, app blobs on R2.
- Marketing concept (VB-51, Claude Doc) approved by Max: own brand with "Powered by Voidcom" in the footer, tone informative, cheerful, professional, reseller-friendly; direction B chosen from three complete mockups (archived in the Voidcom monorepo under `docs/design/voidbinder-directions/`).
- Imagery per the legal research (`docs/marketing/card-imagery-legal.md`): names in text, footer rights notice, no logos, no official scans on the site.

## What Max found on the live run (and what changed)

- The first site (dark Voidcom look, hedged copy) was rejected; the concept-first process replaced it.
- The runbook was rewritten for self-hosters (prerequisites, warning boxes, troubleshooting) after Max's review, then corrected on his first run: Origin CA subject, rootless Docker's copy-up of `/etc` (backup config now under `/opt`), bind-mount preflight.
- pnpm 10 → 12 after Max asked for latest stable tooling; the 24 h release-age policy is kept.

## Open after the sprint

- VB-53: www → apex redirect, Web Analytics token, Lighthouse on the live URL (needs Max for the token).
- VB-48: phone navigation decision; VB-49: prettier-plugin-astro and a screenshot script.
- Hosted-tier wording "Weniger als ein Booster im Monat" to be confirmed by Max.
- The self-host card shows `git clone … docker compose up -d` as an illustration; today's compose only starts Postgres.
- Six legal questions for a lawyer before the app ships card images (in `docs/marketing/card-imagery-legal.md`).
- Falconer project page once Max sets the connector up.

## Numbers

| Metric                                | Value                                                     |
| ------------------------------------- | --------------------------------------------------------- |
| Pull requests merged                  | 24                                                        |
| Site tests                            | 217 passing (4 need Docker Postgres), incl. 115 axe cases |
| Lighthouse mobile (prod build, local) | 99 / 100 / 100 / 100 on /de/ and /en/                     |
| Subagent runs                         | 17 build/fix agents, 10 reviews                           |
