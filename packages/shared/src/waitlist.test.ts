import { describe, expect, it } from 'vitest';
import { WaitlistSignupSchema } from './waitlist.js';

describe('WaitlistSignupSchema', () => {
  it('accepts a form post and a JSON body', () => {
    expect(
      WaitlistSignupSchema.parse({ email: ' Ash@Example.com ', locale: 'de', consent: 'on' }),
    ).toEqual({
      email: 'ash@example.com',
      locale: 'de',
      consent: true,
    });
    expect(
      WaitlistSignupSchema.parse({ email: 'a@b.de', locale: 'en', consent: true, website: '' }),
    ).toMatchObject({ consent: true, website: '' });
  });

  it('rejects missing consent, bad locale and bad email', () => {
    expect(WaitlistSignupSchema.safeParse({ email: 'a@b.de', locale: 'de' }).success).toBe(false);
    expect(
      WaitlistSignupSchema.safeParse({ email: 'a@b.de', locale: 'de', consent: 'off' }).success,
    ).toBe(false);
    expect(
      WaitlistSignupSchema.safeParse({ email: 'a@b.de', locale: 'fr', consent: true }).success,
    ).toBe(false);
    expect(
      WaitlistSignupSchema.safeParse({ email: 'a@b', locale: 'de', consent: true }).success,
    ).toBe(false);
    expect(
      WaitlistSignupSchema.safeParse({
        email: `${'a'.repeat(250)}@b.de`,
        locale: 'de',
        consent: true,
      }).success,
    ).toBe(false);
  });
});
