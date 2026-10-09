import { defineConfig } from 'drizzle-kit';

// `pnpm --filter api db:generate` writes SQL migrations to drizzle/ from the schema;
// `DATABASE_URL=… pnpm --filter api db:migrate` applies them (README.md, Migrations).
// The site migrates the same database with drizzle.__drizzle_migrations; the API keeps its own
// journal table, otherwise each app would skip the other's migrations. Every programmatic
// `migrate()` call (tests) must pass the same schema and table.
export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/schema/index.ts',
  out: './drizzle',
  migrations: { schema: 'drizzle', table: '__drizzle_migrations_api' },
  dbCredentials: { url: process.env.DATABASE_URL ?? '' },
});
