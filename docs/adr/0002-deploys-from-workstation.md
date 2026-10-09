# 0002: Deploys run from the workstation, CI only checks

- Status: Accepted
- Decided by: Max, 2026-10-09

## Context

The repository is public. A Cloudflare API token in GitHub secrets is a standing credential that
every workflow change could expose, and the project is too early to need automated deploys.

## Decision

- Deploys run with `wrangler` from Max's workstation, authenticated with his OAuth login
  (`wrangler login`), through the `deploy:dev` / `deploy:prod` scripts of each app.
- GitHub Actions only checks: install, lint, typecheck, test, build. No workflow deploys and the
  repository holds no Cloudflare credentials.

## Consequences

- No Cloudflare secret lives in GitHub, so a compromised workflow cannot deploy.
- Deploys depend on one person and one machine; there is no deploy audit trail beyond Cloudflare's
  own.
- CI deploys can come later with a scoped Cloudflare API token (Workers scripts and routes for this
  account only) stored in a protected GitHub environment, recorded in a new ADR.
