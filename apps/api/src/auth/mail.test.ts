import { describe, expect, it } from 'vitest';
import { MAIL_COPY, authMail, negotiateLocale, type MailKind } from './mail';

const kinds = Object.keys(MAIL_COPY) as MailKind[];
const URL = 'https://app.example.test/verify?token=a&b';

describe('auth mail copy', () => {
  it('has every mail in German and English with the same shape', () => {
    for (const kind of kinds) {
      const de = MAIL_COPY[kind].de(URL);
      const en = MAIL_COPY[kind].en(URL);
      expect(
        en.lines.map((l) => typeof l),
        kind,
      ).toEqual(de.lines.map((l) => typeof l));
    }
  });

  it('translates every line except the link and the signature, and leaves none empty', () => {
    for (const kind of kinds) {
      const de = MAIL_COPY[kind].de(URL);
      const en = MAIL_COPY[kind].en(URL);
      expect(en.subject).not.toBe(de.subject);
      de.lines.forEach((line, i) => {
        if (typeof line !== 'string') return;
        expect(line.trim(), `${kind}.de[${i}]`).not.toBe('');
        expect(String(en.lines[i]).trim(), `${kind}.en[${i}]`).not.toBe('');
        if (!line.startsWith('Voidbinder')) expect(en.lines[i], `${kind}[${i}]`).not.toBe(line);
      });
    }
  });

  it('builds plain text and HTML with the link, escaping & in HTML', () => {
    const mail = authMail('verify', 'en', 'a@example.test', URL);
    expect(mail.to).toBe('a@example.test');
    expect(mail.text).toContain(URL);
    expect(mail.html).toContain('href="https://app.example.test/verify?token=a&amp;b"');
  });
});

describe('negotiateLocale', () => {
  it('honours order and q weights, matches the language subtag and falls back to German', () => {
    expect(negotiateLocale('en-US,en;q=0.9')).toBe('en');
    expect(negotiateLocale('fr-FR,fr;q=0.9,en;q=0.8,de;q=0.5')).toBe('en');
    expect(negotiateLocale('en;q=0.5,de;q=0.9')).toBe('de');
    expect(negotiateLocale('fr')).toBe('de');
    expect(negotiateLocale(null)).toBe('de');
  });
});
