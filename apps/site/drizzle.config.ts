import { defineConfig } from 'drizzle-kit';

// `pnpm --filter site db:generate` writes SQL migrations to drizzle/ from the schema;
// `DATABASE_URL=… pnpm --filter site db:migrate` applies them (docs/site/waitlist.md).
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/waitlist/schema.ts',
  out: './drizzle',
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
