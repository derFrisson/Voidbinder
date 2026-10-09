# Environments and secrets

## Environments

| Environment | Where                                    | How it is selected                           |
| ----------- | ---------------------------------------- | -------------------------------------------- |
| local       | `pnpm dev` (Astro dev server on workerd) | default                                      |
| `dev`       | `voidbinder-site-dev` on workers.dev     | `CLOUDFLARE_ENV=dev`, `wrangler --env dev`   |
| `prod`      | `voidbinder.de`, `www.voidbinder.de`     | `CLOUDFLARE_ENV=prod`, `wrangler --env prod` |

The site's Cloudflare config is `apps/site/wrangler.jsonc`. `@astrojs/cloudflare` 14 builds through
`@cloudflare/vite-plugin`, so the environment is chosen at **build** time: `astro build` reads
`CLOUDFLARE_ENV`, flattens that environment into the generated deploy config and points
`wrangler deploy` at it through `.wrangler/deploy/config.json`. Always build and deploy with the
same environment:

```sh
pnpm --filter site deploy:dev    # CLOUDFLARE_ENV=dev astro build && wrangler deploy --env dev
pnpm --filter site deploy:prod   # CLOUDFLARE_ENV=prod astro build && wrangler deploy --env prod
```

Wrangler refuses `--env dev` when the build was made for `prod` (and vice versa). A build without
`CLOUDFLARE_ENV` targets the top-level config (`voidbinder-site`, no routes), so never deploy a
plain `pnpm build` output. Deploys run from Max's workstation with his `wrangler login`
([ADR 0002](adr/0002-deploys-from-workstation.md)); CI only checks.

## Secrets

- **Locally:** each app keeps its secrets in its own `.dev.vars` (for example
  `apps/api/.dev.vars`), read by `astro dev` / `wrangler dev`. `.dev.vars.<env>` overrides it for one
  environment. These files are gitignored, never commit them; commit a `.dev.vars.example` with
  dummy values when an app needs secrets.
- **Deployed:** set per environment with `wrangler secret put <NAME> --env dev|prod` from the app's
  directory. Non-secret settings go into `vars` in `wrangler.jsonc`.
- **Site secrets:** `apps/site` needs `UNSUBSCRIBE_SECRET` (HMAC key for the waitlist unsubscribe
  links, [waitlist.md](site/waitlist.md)). Locally `cp apps/site/.dev.vars.example
apps/site/.dev.vars`; deployed, once per environment from `apps/site`:
  `openssl rand -base64 32 | pnpm exec wrangler secret put UNSUBSCRIBE_SECRET --env dev|prod`.
  `wrangler.jsonc` lists it under `secrets.required`, so `wrangler deploy` fails while it is unset.
- **GitHub:** no secrets are needed yet. CI does not deploy; a scoped Cloudflare API token is added
  only when CI deploys are introduced.

The repository is public: `.gitignore` excludes `.dev.vars*`, `.env*` (except `.env.example`),
`.wrangler/`, `node_modules`, `dist`, `.turbo` and `.worktrees/`.

## Dependency policy

pnpm 12 (pinned in `packageManager`) refuses to resolve a version published less than 24 hours ago (`minimumReleaseAge`, pnpm's default). The policy stays on. If `pnpm install` reports a lockfile entry inside the cutoff, lower the range's floor to the previous release instead of relaxing the policy. Build scripts run only for the packages listed under `allowBuilds` in `pnpm-workspace.yaml` (`pnpm approve-builds <pkg>` adds one).
