import { z } from 'zod';
import { EmailSchema, LocaleSchema, type Locale } from './index.js';

export { LocaleSchema, type Locale };

/** Version of the consent text next to the waitlist checkbox; stored with every sign-up. */
export const WAITLIST_CONSENT_VERSION = '2026-10-09';

/**
 * A waitlist sign-up as the form (`consent=on`) or a JSON client (`consent: true`) sends it.
 * `website` is the honeypot; the endpoint checks it before this schema runs.
 */
export const WaitlistSignupSchema = z.object({
  email: EmailSchema,
  locale: LocaleSchema,
  consent: z
    .union([z.literal(true), z.literal('on')], { error: 'consent' })
    .transform(() => true as const),
  website: z.string().optional(),
});
export type WaitlistSignup = z.infer<typeof WaitlistSignupSchema>;

export const WaitlistStatusSchema = z.enum(['pending', 'confirmed', 'unsubscribed']);
export type WaitlistStatus = z.infer<typeof WaitlistStatusSchema>;
