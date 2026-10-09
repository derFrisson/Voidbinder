import type { Locale } from '@voidbinder/shared';

// Same sender and pattern as the site's waitlist mails (apps/site/src/server/waitlist/mail.ts).
export const MAIL_FROM = { email: 'hello@voidbinder.de', name: 'Voidbinder' } as const;

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
}

/** Mail seam for auth; tests use a fake that records messages. */
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/** Picks `de` or `en` from an Accept-Language header (q weights honoured), German otherwise. */
export function negotiateLocale(header: string | null | undefined): Locale {
  const ranked = (header ?? '')
    .split(',')
    .map((part) => {
      const [tag = '', ...params] = part.trim().toLowerCase().split(';');
      const q = params.find((p) => p.trim().startsWith('q='));
      return { lang: tag.split('-')[0], q: q ? Number(q.trim().slice(2)) : 1 };
    })
    .filter((r) => r.q > 0)
    .sort((a, b) => b.q - a.q);
  for (const { lang } of ranked) if (lang === 'de' || lang === 'en') return lang;
  return 'de';
}

type Line = string | { link: string };

interface Copy {
  subject: string;
  lines: Line[];
}

/** The mail copy, one entry per mail and locale; mail.test.ts checks both locales match. */
export const MAIL_COPY = {
  verify: {
    de: (url: string): Copy => ({
      subject: 'Bestätige deine E-Mail-Adresse für Voidbinder',
      lines: [
        'Hallo,',
        'mit dieser Adresse wurde gerade ein Voidbinder-Konto angelegt. Bestätige sie mit diesem Link, danach kannst du dich anmelden:',
        { link: url },
        'Der Link gilt eine Stunde. Wenn du kein Konto angelegt hast, ignoriere diese Mail einfach.',
        'Voidbinder\nvoidbinder.de',
      ],
    }),
    en: (url: string): Copy => ({
      subject: 'Confirm your email address for Voidbinder',
      lines: [
        'Hi,',
        'a Voidbinder account was just created with this address. Confirm it with this link, then you can sign in:',
        { link: url },
        'The link is valid for one hour. If you did not create an account, just ignore this mail.',
        'Voidbinder\nvoidbinder.de',
      ],
    }),
  },
  resetPassword: {
    de: (url: string): Copy => ({
      subject: 'Setze dein Voidbinder-Passwort zurück',
      lines: [
        'Hallo,',
        'für dein Voidbinder-Konto wurde ein neues Passwort angefordert. Lege es mit diesem Link fest:',
        { link: url },
        'Der Link gilt eine Stunde. Danach bist du auf allen Geräten abgemeldet. Wenn du das nicht angefordert hast, ignoriere diese Mail, dein Passwort bleibt wie es ist.',
        'Voidbinder\nvoidbinder.de',
      ],
    }),
    en: (url: string): Copy => ({
      subject: 'Reset your Voidbinder password',
      lines: [
        'Hi,',
        'a new password was requested for your Voidbinder account. Set it with this link:',
        { link: url },
        'The link is valid for one hour. Afterwards you are signed out on every device. If you did not ask for this, ignore this mail and your password stays as it is.',
        'Voidbinder\nvoidbinder.de',
      ],
    }),
  },
} satisfies Record<string, Record<Locale, (url: string) => Copy>>;

export type MailKind = keyof typeof MAIL_COPY;

const amp = (url: string) => url.replace(/&/g, '&amp;');

/** Builds the plain-text and HTML mail of `kind` in `locale` with the link `url`. */
export function authMail(kind: MailKind, locale: Locale, to: string, url: string): MailMessage {
  const copy = MAIL_COPY[kind][locale](url);
  const text = copy.lines.map((l) => (typeof l === 'string' ? l : l.link)).join('\n\n');
  // Every interpolated value is our own copy or a URL built from APP_URL and a base64url token;
  // only the `&` between query parameters needs escaping.
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">${copy.lines
    .map((l) =>
      typeof l === 'string'
        ? `<p>${l.replace(/\n/g, '<br>')}</p>`
        : `<p><a href="${amp(l.link)}">${amp(l.link)}</a></p>`,
    )
    .join('')}</body></html>`;
  return { to, subject: copy.subject, text, html };
}
