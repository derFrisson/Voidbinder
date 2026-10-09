import type { Locale } from '@voidbinder/shared/waitlist';

export const MAIL_FROM = { email: 'hello@voidbinder.de', name: 'Voidbinder' } as const;

export interface MailMessage {
  to: string;
  subject: string;
  text: string;
  html: string;
  headers: Record<string, string>;
}

/** Mail seam for the waitlist handlers; tests use a fake that records messages. */
export interface MailSender {
  send(message: MailMessage): Promise<void>;
}

/** Cloudflare Email Service through the `send_email` binding (structured `send()` API). */
export function bindingMailSender(binding: SendEmail): MailSender {
  return {
    async send(message) {
      await binding.send({ from: MAIL_FROM, ...message });
    },
  };
}

/** Used when the EMAIL binding is missing (local dev without Email Service). */
export const logMailSender: MailSender = {
  async send(message) {
    console.info(
      `[waitlist] mail not sent (no EMAIL binding)\nTo: ${message.to}\nSubject: ${message.subject}\n\n${message.text}`,
    );
  },
};

type Line = string | { link: string };

interface Copy {
  subject: string;
  lines: Line[];
}

function compose(to: string, copy: Copy, unsubscribeUrl: string): MailMessage {
  const text = copy.lines.map((l) => (typeof l === 'string' ? l : l.link)).join('\n\n');
  // Every interpolated value is our own copy or a URL built from SITE_URL and a base64url token.
  const html = `<!doctype html><html><body style="font-family:system-ui,sans-serif;font-size:15px;line-height:1.5;color:#111">${copy.lines
    .map((l) =>
      typeof l === 'string'
        ? `<p>${l.replace(/\n/g, '<br>')}</p>`
        : `<p><a href="${l.link}">${l.link}</a></p>`,
    )
    .join('')}</body></html>`;
  return {
    to,
    subject: copy.subject,
    text,
    html,
    headers: {
      'List-Unsubscribe': `<${unsubscribeUrl}>`,
      'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
    },
  };
}

export function confirmationMail(
  locale: Locale,
  to: string,
  confirmUrl: string,
  unsubscribeUrl: string,
): MailMessage {
  const copy: Record<Locale, Copy> = {
    de: {
      subject: 'Bestätige deine Anmeldung zur Voidbinder-Warteliste',
      lines: [
        'Hallo,',
        'jemand, hoffentlich du, hat diese Adresse für die Warteliste von Voidbinder eingetragen. Bestätige das mit diesem Link:',
        { link: confirmUrl },
        'Der Link gilt 7 Tage. Wenn du das nicht warst, ignoriere diese Mail einfach.',
        'Abmelden:',
        { link: unsubscribeUrl },
        'Voidbinder\nvoidbinder.de',
      ],
    },
    en: {
      subject: 'Confirm your spot on the Voidbinder waitlist',
      lines: [
        'Hi,',
        'someone, hopefully you, added this address to the Voidbinder waitlist. Confirm it with this link:',
        { link: confirmUrl },
        'The link is valid for 7 days. If this was not you, just ignore this mail.',
        'Unsubscribe:',
        { link: unsubscribeUrl },
        'Voidbinder\nvoidbinder.de',
      ],
    },
  };
  return compose(to, copy[locale], unsubscribeUrl);
}

export function alreadyListedMail(locale: Locale, to: string, unsubscribeUrl: string): MailMessage {
  const copy: Record<Locale, Copy> = {
    de: {
      subject: 'Du stehst schon auf der Voidbinder-Warteliste',
      lines: [
        'Hallo,',
        'diese Adresse wurde gerade noch einmal für die Warteliste von Voidbinder eingetragen. Du bist schon bestätigt, es gibt nichts zu tun. Wir melden uns, wenn die Beta startet.',
        'Wenn du keine Mails mehr von uns willst, melde dich hier ab:',
        { link: unsubscribeUrl },
        'Voidbinder\nvoidbinder.de',
      ],
    },
    en: {
      subject: 'You are already on the Voidbinder waitlist',
      lines: [
        'Hi,',
        'this address was just added to the Voidbinder waitlist again. You are already confirmed, there is nothing to do. We will write when the beta opens.',
        'If you do not want mails from us anymore, unsubscribe here:',
        { link: unsubscribeUrl },
        'Voidbinder\nvoidbinder.de',
      ],
    },
  };
  return compose(to, copy[locale], unsubscribeUrl);
}
