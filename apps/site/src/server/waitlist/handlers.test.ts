import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  handleConfirm,
  handleSignup,
  handleUnsubscribe,
  handleUnsubscribeLink,
  hashToken,
  isOneClickUnsubscribe,
  purgeExpired,
  type WaitlistDeps,
} from './handlers';
import type { MailMessage } from './mail';
import type { ExpiryCutoffs, WaitlistPatch, WaitlistRepository } from './repository';
import type { NewWaitlistSignupRow, WaitlistSignupRow } from './schema';
import { skipsTurnstile, TURNSTILE_TEST_SECRET } from './turnstile';

class FakeRepo implements WaitlistRepository {
  rows: WaitlistSignupRow[] = [];
  private find(pred: (r: WaitlistSignupRow) => boolean) {
    return Promise.resolve(this.rows.find(pred) ?? null);
  }
  findByEmail(email: string) {
    return this.find((r) => r.email === email);
  }
  findByConfirmTokenHash(hash: string) {
    return this.find((r) => r.confirmTokenHash === hash);
  }
  findById(id: string) {
    return this.find((r) => r.id === id);
  }
  async insert(row: NewWaitlistSignupRow) {
    if (this.rows.some((r) => r.email === row.email)) return null;
    const full: WaitlistSignupRow = {
      ...row,
      id: crypto.randomUUID(),
      createdAt: row.createdAt ?? new Date(),
      confirmedAt: row.confirmedAt ?? null,
      unsubscribedAt: row.unsubscribedAt ?? null,
      lastConfirmationSentAt: row.lastConfirmationSentAt ?? null,
    };
    this.rows.push(full);
    return full;
  }
  async update(id: string, patch: WaitlistPatch) {
    const row = this.rows.find((r) => r.id === id);
    if (row) Object.assign(row, patch);
  }
  async deleteExpired({ pendingBefore, unsubscribedBefore }: ExpiryCutoffs) {
    const gone = (r: WaitlistSignupRow) =>
      (r.status === 'pending' && r.confirmExpiresAt < pendingBefore) ||
      (r.status === 'unsubscribed' && !!r.unsubscribedAt && r.unsubscribedAt < unsubscribedBefore);
    const counts = { pending: 0, unsubscribed: 0 };
    for (const r of this.rows.filter(gone)) {
      if (r.status === 'pending') counts.pending++;
      if (r.status === 'unsubscribed') counts.unsubscribed++;
    }
    this.rows = this.rows.filter((r) => !gone(r));
    return counts;
  }
}

const SITE = 'https://voidbinder.test';
const HOUR = 60 * 60 * 1000;
let repo: FakeRepo;
let sent: MailMessage[];
let now: Date;
let allowed: boolean;
let failMail: boolean;
let deps: WaitlistDeps;

beforeEach(() => {
  repo = new FakeRepo();
  sent = [];
  now = new Date('2026-10-09T12:00:00Z');
  allowed = true;
  failMail = false;
  deps = {
    repo,
    siteUrl: SITE,
    unsubscribeSecret: 'test-unsubscribe-secret',
    // Like local development: no token needed. The Turnstile tests switch the check on.
    turnstile: { secret: 'test-turnstile-secret', skip: true },
    now: () => now,
    rateLimit: async () => allowed,
    mail: {
      async send(m) {
        if (failMail) throw new Error('mail down');
        sent.push(m);
      },
    },
  };
});

function form(fields: Record<string, string>) {
  return new Request(`${SITE}/api/waitlist`, {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      'cf-connecting-ip': '203.0.113.7',
    },
    body: new URLSearchParams(fields),
  });
}

function jsonReq(body: unknown) {
  return new Request(`${SITE}/api/waitlist`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const signupForm = (email = 'Ash@Example.com', locale = 'de') =>
  handleSignup(form({ email, locale, consent: 'on', website: '' }), deps);
const signupJson = (email = 'ash@example.com', locale = 'en') =>
  handleSignup(jsonReq({ email, locale, consent: true, website: '' }), deps);

const TOKEN = {
  confirm: '[A-Za-z0-9_-]{43}',
  unsubscribe: '[0-9a-f-]{36}\\.[A-Za-z0-9_-]{43}&lang=(?:de|en)',
};
function linkFrom(mail: MailMessage | undefined, kind: 'confirm' | 'unsubscribe'): string {
  const m = mail?.text.match(new RegExp(`${SITE}/api/waitlist/${kind}\\?token=${TOKEN[kind]}`));
  if (!m) throw new Error(`no ${kind} link`);
  return m[0];
}

function only<T>(item: T | undefined): T {
  if (item === undefined) throw new Error('missing');
  return item;
}
const row = () => only(repo.rows[0]);
const mail = (i: number) => only(sent[i]);

const get = (url: string) => new Request(url);
const formPost = (url: string, body: string) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
  });
/** RFC 8058 one-click request: the List-Unsubscribe URL, marker in the body. */
const oneClick = (url: string) => formPost(url, 'List-Unsubscribe=One-Click');
/** The form on the site's unsubscribe page: token in the body. */
const pageForm = (link: string) =>
  formPost(
    `${SITE}/api/waitlist/unsubscribe`,
    new URLSearchParams({ token: new URL(link).searchParams.get('token') ?? '' }).toString(),
  );
const tokenOf = (link: string) => new URL(link).searchParams.get('token') ?? '';
/** A body of `bytes` bytes without Content-Length, so only the read itself can enforce the cap. */
const streamed = (bytes: number) =>
  new ReadableStream<Uint8Array>({
    start(c) {
      c.enqueue(new TextEncoder().encode(`email=a%40b.de&website=${'x'.repeat(bytes)}`));
      c.close();
    },
  });

describe('POST /api/waitlist', () => {
  it('stores a new form sign-up as pending and sends the confirmation mail', async () => {
    const res = await signupForm();
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/de/waitlist/pending');
    expect(repo.rows).toHaveLength(1);
    const stored = row();
    expect(stored).toMatchObject({
      email: 'ash@example.com',
      locale: 'de',
      status: 'pending',
      lastConfirmationSentAt: now,
    });
    expect(stored.consentTextVersion).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(stored.confirmExpiresAt.getTime() - now.getTime()).toBe(7 * 24 * HOUR);

    expect(sent).toHaveLength(1);
    const confirmation = mail(0);
    expect(confirmation.to).toBe('ash@example.com');
    expect(confirmation.subject).toContain('Bestätige');
    expect(confirmation.html).toContain(linkFrom(confirmation, 'confirm'));
    expect(confirmation.headers['List-Unsubscribe']).toBe(
      `<${linkFrom(confirmation, 'unsubscribe')}>`,
    );
    expect(confirmation.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
    // Only hashes at rest.
    const token = new URL(linkFrom(confirmation, 'confirm')).searchParams.get('token') ?? '';
    expect(stored.confirmTokenHash).toBe(await hashToken(token));
    expect(JSON.stringify(stored)).not.toContain(token);
  });

  it('answers JSON with 200 pending and mails in English', async () => {
    const res = await signupJson();
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'pending' });
    expect(mail(0).subject).toBe('Confirm your spot on the Voidbinder waitlist');
  });

  it('accepts multipart form posts', async () => {
    const body = new FormData();
    for (const [k, v] of Object.entries({ email: 'a@b.de', locale: 'en', consent: 'on' }))
      body.set(k, v);
    const res = await handleSignup(
      new Request(`${SITE}/api/waitlist`, { method: 'POST', body }),
      deps,
    );
    expect(res.headers.get('location')).toBe('/en/waitlist/pending');
    expect(repo.rows).toHaveLength(1);
  });

  it('does not resend to a pending address within 24 h, then resends with a new link', async () => {
    await signupForm();
    const firstHash = row().confirmTokenHash;
    now = new Date(now.getTime() + 23 * HOUR);
    const res = await signupForm();
    expect(res.headers.get('location')).toBe('/de/waitlist/pending');
    expect(sent).toHaveLength(1);

    now = new Date(now.getTime() + 2 * HOUR);
    await signupJson();
    expect(sent).toHaveLength(2);
    expect(mail(1).subject).toContain('Confirm');
    expect(repo.rows[0]).toMatchObject({
      status: 'pending',
      locale: 'en',
      lastConfirmationSentAt: now,
    });
    expect(row().confirmTokenHash).not.toBe(firstHash);
    // The old link stops working, the new one confirms.
    expect(
      (await handleConfirm(get(linkFrom(sent[0], 'confirm')), deps)).headers.get('location'),
    ).toBe('/de/waitlist/expired');
    expect(
      (await handleConfirm(get(linkFrom(sent[1], 'confirm')), deps)).headers.get('location'),
    ).toBe('/en/waitlist/confirmed');
  });

  it('tells a confirmed address it is already listed, same answer, at most once per 24 h', async () => {
    await signupForm();
    await handleConfirm(get(linkFrom(sent[0], 'confirm')), deps);
    now = new Date(now.getTime() + 25 * HOUR);

    const res = await signupForm();
    expect(res.headers.get('location')).toBe('/de/waitlist/pending');
    expect(sent).toHaveLength(2);
    expect(mail(1).subject).toBe('Du stehst schon auf der Voidbinder-Warteliste');
    expect(mail(1).text).not.toContain('/confirm?');
    expect(mail(1).headers['List-Unsubscribe']).toBe(`<${linkFrom(sent[1], 'unsubscribe')}>`);
    expect(row().status).toBe('confirmed');

    await signupForm();
    expect(sent).toHaveLength(2);
  });

  it('starts a fresh double opt-in for an unsubscribed address', async () => {
    await signupForm();
    await handleConfirm(get(linkFrom(sent[0], 'confirm')), deps);
    await handleUnsubscribe(oneClick(linkFrom(sent[0], 'unsubscribe')), deps);
    expect(row().status).toBe('unsubscribed');

    const res = await signupForm();
    expect(res.headers.get('location')).toBe('/de/waitlist/pending');
    expect(sent).toHaveLength(2);
    expect(repo.rows[0]).toMatchObject({
      status: 'pending',
      confirmedAt: null,
      unsubscribedAt: null,
    });
    expect(
      (await handleConfirm(get(linkFrom(sent[1], 'confirm')), deps)).headers.get('location'),
    ).toBe('/de/waitlist/confirmed');
  });

  it('answers a filled honeypot like a success without storing or mailing', async () => {
    const res = await handleSignup(
      form({ email: 'bot@spam.de', locale: 'en', consent: 'on', website: 'x' }),
      deps,
    );
    expect(res.headers.get('location')).toBe('/en/waitlist/pending');
    const json = await handleSignup(
      jsonReq({ email: 'bot@spam.de', locale: 'en', consent: true, website: 'x' }),
      deps,
    );
    expect(json.status).toBe(200);
    expect(await json.json()).toEqual({ status: 'pending' });
    expect(repo.rows).toHaveLength(0);
    expect(sent).toHaveLength(0);
  });

  it('rejects an invalid email', async () => {
    const res = await handleSignup(form({ email: 'nope', locale: 'en', consent: 'on' }), deps);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/en/waitlist/error?reason=email');
    const json = await handleSignup(
      jsonReq({ email: `${'a'.repeat(250)}@b.de`, locale: 'de', consent: true }),
      deps,
    );
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({ error: 'email' });
    expect(repo.rows).toHaveLength(0);
  });

  it('rejects missing consent', async () => {
    const res = await handleSignup(form({ email: 'a@b.de', locale: 'de' }), deps);
    expect(res.headers.get('location')).toBe('/de/waitlist/error?reason=consent');
    const json = await handleSignup(
      jsonReq({ email: 'a@b.de', locale: 'de', consent: false }),
      deps,
    );
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({ error: 'consent' });
    expect(repo.rows).toHaveLength(0);
  });

  it('falls back to de for an unknown locale and treats broken JSON as invalid', async () => {
    const res = await handleSignup(form({ email: 'nope', locale: 'fr' }), deps);
    expect(res.headers.get('location')).toBe('/de/waitlist/error?reason=email');
    const broken = new Request(`${SITE}/api/waitlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{',
    });
    expect((await handleSignup(broken, deps)).status).toBe(400);
  });

  it('answers 429 when rate limited, before touching storage', async () => {
    allowed = false;
    const res = await signupForm();
    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('60');
    const json = await signupJson();
    expect(json.status).toBe(429);
    expect(await json.json()).toEqual({ error: 'rate_limited' });
    expect(repo.rows).toHaveLength(0);
  });

  it('rate limits per client IP', async () => {
    const keys: string[] = [];
    deps.rateLimit = async (key) => (keys.push(key), true);
    await signupForm();
    expect(keys).toEqual(['203.0.113.7']);
  });

  it('refuses other content types', async () => {
    const res = await handleSignup(
      new Request(`${SITE}/api/waitlist`, {
        method: 'POST',
        headers: { 'content-type': 'text/plain' },
        body: 'x',
      }),
      deps,
    );
    expect(res.status).toBe(415);
  });

  it('refuses a body over 8 KiB with 413, whatever Content-Length says', async () => {
    for (const type of ['application/x-www-form-urlencoded', 'application/json']) {
      const res = await handleSignup(
        new Request(`${SITE}/api/waitlist`, {
          method: 'POST',
          headers: { 'content-type': type },
          body: streamed(9000),
          duplex: 'half',
        } as RequestInit),
        deps,
      );
      expect(res.status).toBe(413);
    }
    const multipart = new FormData();
    multipart.set('email', 'a@b.de');
    multipart.set('website', 'x'.repeat(9000));
    // Encoded up front: cancelling undici's lazily generated multipart stream rejects in Node.
    const encoded = new Response(multipart);
    const res = await handleSignup(
      new Request(`${SITE}/api/waitlist`, {
        method: 'POST',
        headers: { 'content-type': encoded.headers.get('content-type') ?? '' },
        body: await encoded.arrayBuffer(),
      }),
      deps,
    );
    expect(res.status).toBe(413);
    const json = await handleSignup(jsonReq({ email: 'a@b.de', pad: 'x'.repeat(9000) }), deps);
    expect(await json.json()).toEqual({ error: 'too_large' });
    expect(repo.rows).toHaveLength(0);
  });

  it('reads a body just under 8 KiB', async () => {
    const res = await handleSignup(
      form({ email: 'a@b.de', locale: 'en', consent: 'on', pad: 'x'.repeat(8000) }),
      deps,
    );
    expect(res.headers.get('location')).toBe('/en/waitlist/pending');
  });

  it('reports a failed mail and lets the next attempt send again', async () => {
    failMail = true;
    const res = await signupForm();
    expect(res.headers.get('location')).toBe('/de/waitlist/error?reason=server');
    expect((await signupJson()).status).toBe(500);
    expect(row().lastConfirmationSentAt).toBeNull();

    failMail = false;
    await signupForm();
    expect(sent).toHaveLength(1);
  });
});

describe('GET /api/waitlist/confirm', () => {
  it('confirms a pending sign-up', async () => {
    await signupForm();
    const res = await handleConfirm(get(linkFrom(sent[0], 'confirm')), deps);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/de/waitlist/confirmed');
    expect(repo.rows[0]).toMatchObject({ status: 'confirmed', confirmedAt: now });
    // A second click still lands on confirmed.
    expect(
      (await handleConfirm(get(linkFrom(sent[0], 'confirm')), deps)).headers.get('location'),
    ).toBe('/de/waitlist/confirmed');
  });

  it('sends an expired link to the expired page', async () => {
    await signupJson();
    now = new Date(now.getTime() + 7 * 24 * HOUR + 1);
    const res = await handleConfirm(get(linkFrom(sent[0], 'confirm')), deps);
    expect(res.headers.get('location')).toBe('/en/waitlist/expired');
    expect(row().status).toBe('pending');
  });

  it('sends an unknown token to the expired page', async () => {
    const unknown = `${SITE}/api/waitlist/confirm?token=${'A'.repeat(43)}`;
    expect((await handleConfirm(get(unknown), deps)).headers.get('location')).toBe(
      '/de/waitlist/expired',
    );
  });

  it('sends a malformed or short token to the expired page without touching storage', async () => {
    repo.findByConfirmTokenHash = () => Promise.reject(new Error('storage touched'));
    for (const query of ['?token=x', `?token=${'A'.repeat(42)}`, `?token=${'A'.repeat(43)}!`, '']) {
      const res = await handleConfirm(get(`${SITE}/api/waitlist/confirm${query}`), deps);
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe('/de/waitlist/expired');
    }
  });

  it('does not re-confirm an unsubscribed address from an old link', async () => {
    await signupForm();
    await handleUnsubscribe(oneClick(linkFrom(sent[0], 'unsubscribe')), deps);
    const res = await handleConfirm(get(linkFrom(sent[0], 'confirm')), deps);
    expect(res.headers.get('location')).toBe('/de/waitlist/expired');
    expect(row().status).toBe('unsubscribed');
  });
});

describe('GET /api/waitlist/unsubscribe', () => {
  it('changes nothing and forwards to the page with the button', async () => {
    await signupJson();
    const link = linkFrom(sent[0], 'unsubscribe');
    const res = handleUnsubscribeLink(get(link));
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      `/en/waitlist/unsubscribe?${new URLSearchParams({ token: tokenOf(link) })}`,
    );
    expect(row().status).toBe('pending');
  });

  it('falls back to de without a known lang', () => {
    const res = handleUnsubscribeLink(get(`${SITE}/api/waitlist/unsubscribe?lang=fr`));
    expect(res.headers.get('location')).toBe('/de/waitlist/unsubscribe?token=');
  });
});

describe('POST /api/waitlist/unsubscribe', () => {
  it('unsubscribes from the page form, idempotently', async () => {
    await signupJson();
    const link = linkFrom(sent[0], 'unsubscribe');
    const res = await handleUnsubscribe(pageForm(link), deps);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/en/waitlist/unsubscribed');
    expect(repo.rows[0]).toMatchObject({ status: 'unsubscribed', unsubscribedAt: now });

    const first = now;
    now = new Date(now.getTime() + HOUR);
    expect((await handleUnsubscribe(pageForm(link), deps)).headers.get('location')).toBe(
      '/en/waitlist/unsubscribed',
    );
    expect(row().unsubscribedAt).toBe(first);
  });

  it('unsubscribes via one-click POST, idempotently', async () => {
    await signupForm();
    const url = linkFrom(sent[0], 'unsubscribe');
    expect((await handleUnsubscribe(oneClick(url), deps)).status).toBe(200);
    expect((await handleUnsubscribe(oneClick(url), deps)).status).toBe(200);
    expect(row().status).toBe('unsubscribed');
  });

  it('keeps the link of the first mail working after a resend and an already-listed mail', async () => {
    await signupForm();
    now = new Date(now.getTime() + 25 * HOUR);
    await signupJson('ash@example.com', 'de'); // pending resend
    await handleConfirm(get(linkFrom(sent[1], 'confirm')), deps);
    now = new Date(now.getTime() + 25 * HOUR);
    await signupForm(); // already listed
    expect(sent).toHaveLength(3);
    const links = sent.map((m) => linkFrom(m, 'unsubscribe'));
    expect(new Set(links).size).toBe(1);
    expect(sent.map((m) => m.headers['List-Unsubscribe'])).toEqual(links.map((l) => `<${l}>`));

    expect((await handleUnsubscribe(oneClick(linkFrom(sent[0], 'unsubscribe')), deps)).status).toBe(
      200,
    );
    expect(row().status).toBe('unsubscribed');
  });

  it('does nothing for a tampered token', async () => {
    await signupForm();
    await signupJson('other@example.com');
    const link = linkFrom(sent[0], 'unsubscribe');
    const token = tokenOf(link);
    const [id, mac = ''] = token.split('.');
    const otherId = only(repo.rows[1]).id;
    // Flip a character in the middle of the MAC: the last base64url character carries only four
    // significant bits, so flipping it can decode to the same bytes and yield a genuine token.
    const flipped = `${mac.slice(0, 20)}${mac[20] === 'A' ? 'B' : 'A'}${mac.slice(21)}`;
    for (const forged of [`${id}.${flipped}`, `${otherId}.${mac}`]) {
      const res = await handleUnsubscribe(
        oneClick(`${SITE}/api/waitlist/unsubscribe?token=${forged}`),
        deps,
      );
      expect(res.status).toBe(200);
    }
    expect(repo.rows.map((r) => r.status)).toEqual(['pending', 'pending']);
  });

  it('answers an unknown, malformed or short token the same way without touching storage', async () => {
    await signupForm();
    repo.findById = () => Promise.reject(new Error('storage touched'));
    const [id] = tokenOf(linkFrom(sent[0], 'unsubscribe')).split('.');
    for (const token of [`${crypto.randomUUID()}.${'A'.repeat(43)}`, 'x', `${id}.abc`, '']) {
      const form = formPost(
        `${SITE}/api/waitlist/unsubscribe`,
        new URLSearchParams({ token, lang: 'en' }).toString(),
      );
      const res = await handleUnsubscribe(form, deps);
      expect(res.headers.get('location')).toBe('/en/waitlist/unsubscribed');
      const click = oneClick(`${SITE}/api/waitlist/unsubscribe?token=${encodeURIComponent(token)}`);
      expect((await handleUnsubscribe(click, deps)).status).toBe(200);
    }
    expect(row().status).toBe('pending');
  });

  it('refuses a body over 8 KiB', async () => {
    const res = await handleUnsubscribe(
      formPost(`${SITE}/api/waitlist/unsubscribe`, `token=${'x'.repeat(9000)}`),
      deps,
    );
    expect(res.status).toBe(413);
  });

  it('recognises only the one-click request for the Worker entry', async () => {
    const url = `${SITE}/api/waitlist/unsubscribe?token=t`;
    const click = oneClick(url);
    expect(await isOneClickUnsubscribe(click)).toBe(true);
    expect(await click.text()).toBe('List-Unsubscribe=One-Click'); // body still unread
    expect(await isOneClickUnsubscribe(formPost(url, 'token=t'))).toBe(false);
    expect(await isOneClickUnsubscribe(get(url))).toBe(false);
    expect(
      await isOneClickUnsubscribe(formPost(`${SITE}/api/waitlist`, 'List-Unsubscribe=One-Click')),
    ).toBe(false);
  });
});

describe('purgeExpired', () => {
  const DAY = 24 * HOUR;
  const at = (daysAgo: number, extraMs = 0) => new Date(now.getTime() - daysAgo * DAY + extraMs);
  async function seed(
    email: string,
    status: WaitlistSignupRow['status'],
    dates: Partial<WaitlistSignupRow>,
  ) {
    await repo.insert({
      email,
      locale: 'de',
      status,
      confirmTokenHash: `h-${email}`,
      confirmExpiresAt: new Date(),
      consentTextVersion: 'v',
      ...dates,
    });
  }
  const emails = () => repo.rows.map((r) => r.email).sort();
  const run = (extra: Partial<Parameters<typeof purgeExpired>[0]> = {}) =>
    purgeExpired({ repo, now: () => now, pendingDays: 30, unsubscribedDays: 365, ...extra });

  it('deletes pending rows whose link expired more than the retention ago, keeps the boundary', async () => {
    await seed('old@x.de', 'pending', { confirmExpiresAt: at(30, -1) });
    await seed('edge@x.de', 'pending', { confirmExpiresAt: at(30) });
    await seed('recent@x.de', 'pending', { confirmExpiresAt: at(29) });
    expect(await run()).toEqual({ pending: 1, unsubscribed: 0 });
    expect(emails()).toEqual(['edge@x.de', 'recent@x.de']);
  });

  it('deletes unsubscribed rows older than the retention, keeps the boundary', async () => {
    await seed('old@x.de', 'unsubscribed', { unsubscribedAt: at(365, -1) });
    await seed('edge@x.de', 'unsubscribed', { unsubscribedAt: at(365) });
    await seed('recent@x.de', 'unsubscribed', { unsubscribedAt: at(364) });
    expect(await run()).toEqual({ pending: 0, unsubscribed: 1 });
    expect(emails()).toEqual(['edge@x.de', 'recent@x.de']);
  });

  it('never deletes confirmed rows, however old, and keeps each status to its own rule', async () => {
    await seed('c@x.de', 'confirmed', {
      confirmExpiresAt: at(900),
      confirmedAt: at(800),
      unsubscribedAt: at(700),
    });
    // an old unsubscribed date on a re-signed-up pending row does not count
    await seed('p@x.de', 'pending', { confirmExpiresAt: at(1), unsubscribedAt: at(700) });
    // an unsubscribed row with an old, expired link is judged by unsubscribed_at only
    await seed('u@x.de', 'unsubscribed', { confirmExpiresAt: at(900), unsubscribedAt: at(2) });
    expect(await run()).toEqual({ pending: 0, unsubscribed: 0 });
    expect(emails()).toEqual(['c@x.de', 'p@x.de', 'u@x.de']);
  });

  it('uses the configured retention, as a number or a numeric string', async () => {
    await seed('a@x.de', 'pending', { confirmExpiresAt: at(8) });
    await seed('b@x.de', 'unsubscribed', { unsubscribedAt: at(8) });
    expect(await run({ pendingDays: '7', unsubscribedDays: 7 })).toEqual({
      pending: 1,
      unsubscribed: 1,
    });
  });

  it.each([undefined, '', 'abc', 0, -5, 1.5, '1e2x', null])(
    'falls back to 30 / 365 days for %j and warns',
    async (bad) => {
      await seed('a@x.de', 'pending', { confirmExpiresAt: at(31) });
      await seed('b@x.de', 'pending', { confirmExpiresAt: at(29) });
      await seed('c@x.de', 'unsubscribed', { unsubscribedAt: at(366) });
      await seed('d@x.de', 'unsubscribed', { unsubscribedAt: at(364) });
      const warnings: string[] = [];
      expect(
        await run({ pendingDays: bad, unsubscribedDays: bad, warn: (m) => warnings.push(m) }),
      ).toEqual({ pending: 1, unsubscribed: 1 });
      expect(emails()).toEqual(['b@x.de', 'd@x.de']);
      expect(warnings).toHaveLength(2);
    },
  );

  it('logs the counts', async () => {
    await seed('a@x.de', 'pending', { confirmExpiresAt: at(31) });
    const logged: unknown[][] = [];
    await run({ log: (...a) => logged.push(a) });
    expect(logged).toEqual([['[waitlist] retention purge', { pending: 1, unsubscribed: 0 }]]);
  });
});

describe('Turnstile on POST /api/waitlist', () => {
  let siteverify: ReturnType<typeof vi.fn<typeof fetch>>;
  beforeEach(() => {
    siteverify = vi.fn<typeof fetch>(async () => Response.json({ success: true }));
    deps.turnstile = { secret: 'secret-1', skip: false, fetch: siteverify };
  });
  const body = { email: 'ash@example.com', locale: 'en', consent: true, website: '' };
  const withToken = { ...body, 'cf-turnstile-response': 'tok-1' };

  it('refuses a request without a token and stores nothing, without asking Cloudflare', async () => {
    const json = await handleSignup(jsonReq(body), deps);
    expect(json.status).toBe(400);
    expect(await json.json()).toEqual({ error: 'turnstile' });
    const native = await signupForm();
    expect(native.status).toBe(303);
    expect(native.headers.get('location')).toBe('/de/waitlist/error?reason=turnstile');
    expect(repo.rows).toHaveLength(0);
    expect(sent).toHaveLength(0);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('signs up with a token from the JSON body and sends secret, token and client IP', async () => {
    const req = new Request(`${SITE}/api/waitlist`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'cf-connecting-ip': '203.0.113.7' },
      body: JSON.stringify(withToken),
    });
    expect((await handleSignup(req, deps)).status).toBe(200);
    expect(repo.rows).toHaveLength(1);
    const [url, init] = siteverify.mock.calls[0] ?? [];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      secret: 'secret-1',
      response: 'tok-1',
      remoteip: '203.0.113.7',
    });
  });

  it('takes the token from the form field the widget adds, for the post without JavaScript', async () => {
    const res = await handleSignup(
      form({
        email: 'ash@example.com',
        locale: 'de',
        consent: 'on',
        'cf-turnstile-response': 'tok-2',
      }),
      deps,
    );
    expect(res.headers.get('location')).toBe('/de/waitlist/pending');
    expect(repo.rows).toHaveLength(1);
  });

  it('refuses a token Cloudflare rejects', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    siteverify.mockResolvedValue(
      Response.json({ success: false, 'error-codes': ['timeout-or-duplicate'] }),
    );
    const res = await handleSignup(jsonReq(withToken), deps);
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'turnstile' });
    expect(repo.rows).toHaveLength(0);
    expect(warn).toHaveBeenCalledWith(expect.any(String), ['timeout-or-duplicate']);
    warn.mockRestore();
  });

  it('answers 503 when Siteverify cannot be reached or understood, never a pass', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const down of [
      () => Promise.reject(new TypeError('network down')),
      async () => new Response('bad gateway', { status: 502 }),
      async () => new Response('<html>'),
    ]) {
      siteverify.mockImplementation(down);
      const json = await handleSignup(jsonReq(withToken), deps);
      expect(json.status).toBe(503);
      expect(await json.json()).toEqual({ error: 'turnstile_unavailable' });
    }
    const native = await handleSignup(
      form({ email: 'a@b.de', locale: 'en', consent: 'on', 'cf-turnstile-response': 't' }),
      deps,
    );
    expect(native.headers.get('location')).toBe('/en/waitlist/error?reason=turnstile_unavailable');
    expect(repo.rows).toHaveLength(0);
    error.mockRestore();
  });

  it('does not ask Cloudflare about a honeypot hit or an invalid request', async () => {
    await handleSignup(jsonReq({ ...withToken, website: 'http://spam.example' }), deps);
    await handleSignup(jsonReq({ ...withToken, email: 'nope' }), deps);
    await handleSignup(jsonReq({ ...withToken, consent: false }), deps);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it('skips the check when configured (local development)', async () => {
    deps.turnstile = { secret: TURNSTILE_TEST_SECRET, skip: true, fetch: siteverify };
    expect((await handleSignup(jsonReq(body), deps)).status).toBe(200);
    expect(siteverify).not.toHaveBeenCalled();
  });

  it("skips only Cloudflare's test secret on a localhost SITE_URL", () => {
    expect(skipsTurnstile(TURNSTILE_TEST_SECRET, 'http://localhost:4321')).toBe(true);
    expect(skipsTurnstile(TURNSTILE_TEST_SECRET, 'https://voidbinder.de')).toBe(false);
    expect(
      skipsTurnstile(TURNSTILE_TEST_SECRET, 'https://voidbinder-site-dev.frisson.workers.dev'),
    ).toBe(false);
    expect(skipsTurnstile('0x4AAAAAAreal', 'http://localhost:4321')).toBe(false);
    expect(skipsTurnstile(undefined, 'http://localhost:4321')).toBe(false);
  });
});
