import { sql } from 'drizzle-orm';
import { check, pgTable, text, timestamp, uuid } from 'drizzle-orm/pg-core';

// GDPR-minimal: the address, the language for mails, the consent version and timestamps.
// No IP addresses or user agents. Tokens are stored only as SHA-256 hashes.
export const waitlistSignups = pgTable(
  'waitlist_signups',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    email: text('email').notNull().unique(),
    locale: text('locale', { enum: ['de', 'en'] }).notNull(),
    status: text('status', { enum: ['pending', 'confirmed', 'unsubscribed'] }).notNull(),
    confirmTokenHash: text('confirm_token_hash').notNull().unique(),
    confirmExpiresAt: timestamp('confirm_expires_at', { withTimezone: true }).notNull(),
    unsubscribeTokenHash: text('unsubscribe_token_hash').notNull().unique(),
    consentTextVersion: text('consent_text_version').notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    unsubscribedAt: timestamp('unsubscribed_at', { withTimezone: true }),
    lastConfirmationSentAt: timestamp('last_confirmation_sent_at', { withTimezone: true }),
  },
  (t) => [
    check(
      'waitlist_signups_status_check',
      sql`${t.status} in ('pending', 'confirmed', 'unsubscribed')`,
    ),
    check('waitlist_signups_locale_check', sql`${t.locale} in ('de', 'en')`),
  ],
);

export type WaitlistSignupRow = typeof waitlistSignups.$inferSelect;
export type NewWaitlistSignupRow = typeof waitlistSignups.$inferInsert;
