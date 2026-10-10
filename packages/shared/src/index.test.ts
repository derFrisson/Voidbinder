import { describe, expect, it } from 'vitest';
import { banLimit, banStatus } from './api/banlist.js';
import { EmailSchema, LocaleSchema } from './index.js';

describe('EmailSchema', () => {
  it('normalizes a valid address', () => {
    expect(EmailSchema.parse('  Ash@Example.COM ')).toBe('ash@example.com');
  });

  it('rejects invalid addresses', () => {
    expect(EmailSchema.safeParse('not-an-email').success).toBe(false);
    expect(EmailSchema.safeParse(`${'a'.repeat(250)}@x.de`).success).toBe(false);
  });
});

describe('LocaleSchema', () => {
  it('accepts supported locales only', () => {
    expect(LocaleSchema.parse('de')).toBe('de');
    expect(LocaleSchema.safeParse('fr').success).toBe(false);
  });
});

describe('ban list statuses (VB-81)', () => {
  it('maps a status to the copies it allows and the restricted ones to themselves', () => {
    expect(['Forbidden', 'banned', 'Limited', 'Semi-Limited', 'Unlimited'].map(banLimit)).toEqual([
      0, 0, 1, 2, 3,
    ]);
    expect(banLimit(undefined)).toBeNull();
    expect(['forbidden', 'Semi-Limited', 'Unlimited', null].map(banStatus)).toEqual([
      'Forbidden',
      'Semi-Limited',
      null,
      null,
    ]);
  });
});
