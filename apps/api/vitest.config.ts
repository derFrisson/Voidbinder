import { builtinModules } from 'node:module';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Two projects: `unit` runs in Node (createApp with fakes, the client, the Postgres integration
// test), `worker` runs test/ inside workerd with the bindings from wrangler.jsonc (top level).
const databaseUrl = process.env.DATABASE_URL ?? '';

export default defineConfig({
  test: {
    // CI runs the API tests next to the app's build and tests (turbo) on one shared runner; the
    // 5 s default timed out on the first workerd request and on the 1-byte chunk split.
    testTimeout: 30_000,
    projects: [
      { extends: true, test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      {
        extends: true,
        plugins: [
          cloudflareTest({
            wrangler: { configPath: './wrangler.jsonc' },
            // CI's Postgres instead of the localConnectionString when DATABASE_URL is set.
            ...(databaseUrl && {
              miniflare: {
                hyperdrives: { HYPERDRIVE: databaseUrl, HYPERDRIVE_CACHED: databaseUrl },
              },
            }),
          }),
        ],
        test: {
          name: 'worker',
          include: ['test/**/*.test.ts'],
          provide: { databaseUrl },
          deps: {
            optimizer: {
              ssr: {
                enabled: true,
                // Pre-bundled: loading Better Auth module by module in workerd made the first
                // request slower than the 5 s test timeout on CI.
                include: [
                  'pg',
                  'better-auth',
                  'better-auth/plugins',
                  '@better-auth/drizzle-adapter',
                ],
                rolldownOptions: { external: [...builtinModules, /^node:/] },
              },
            },
          },
        },
      },
    ],
  },
});
