import { builtinModules } from 'node:module';
import { cloudflareTest } from '@cloudflare/vitest-plugin';
import { defineConfig } from 'vitest/config';

// Two projects: `unit` runs in Node (createApp with fakes, the client, the Postgres integration
// test), `worker` runs test/ inside workerd with the bindings from wrangler.jsonc (top level).
const databaseUrl = process.env.DATABASE_URL ?? '';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'unit', include: ['src/**/*.test.ts'] } },
      {
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
                include: ['pg'],
                rolldownOptions: { external: [...builtinModules, /^node:/] },
              },
            },
          },
        },
      },
    ],
  },
});
