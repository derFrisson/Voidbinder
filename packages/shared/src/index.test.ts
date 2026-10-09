import { describe, expect, it } from 'vitest';
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
