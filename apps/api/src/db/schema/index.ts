import { pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** Key/value settings of the API, e.g. `catalog_version` (bumped when the catalog changes). */
export const appMeta = pgTable('app_meta', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});
