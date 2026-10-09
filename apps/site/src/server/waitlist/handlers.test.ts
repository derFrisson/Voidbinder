import { beforeEach, describe, expect, it } from 'vitest';
import {
  handleConfirm,
  handleSignup,
  handleUnsubscribe,
  hashToken,
  type WaitlistDeps,
} from './handlers';
import type { MailMessage } from './mail';
import type { WaitlistPatch, WaitlistRepository } from './repository';
import type { NewWaitlistSignupRow, WaitlistSignupRow } from './schema';

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
  findByUnsubscribeTokenHash(hash: string) {
    return this.find((r) => r.unsubscribeTokenHash === hash);
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

function linkFrom(mail: MailMessage | undefined, kind: 'confirm' | 'unsubscribe'): string {
  const m = mail?.text.match(new RegExp(`${SITE}/api/waitlist/${kind}\\?token=[A-Za-z0-9_-]{43}`));
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
const post = (url: string) =>
  new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: 'List-Unsubscribe=One-Click',
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
    await handleUnsubscribe(get(linkFrom(sent[0], 'unsubscribe')), deps);
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

  it('sends an unknown or malformed token to the expired page', async () => {
    const unknown = `${SITE}/api/waitlist/confirm?token=${'A'.repeat(43)}`;
    expect((await handleConfirm(get(unknown), deps)).headers.get('location')).toBe(
      '/de/waitlist/expired',
    );
    expect((await handleConfirm(get(`${SITE}/api/waitlist/confirm?token=x`), deps)).status).toBe(
      303,
    );
    expect(
      (await handleConfirm(get(`${SITE}/api/waitlist/confirm`), deps)).headers.get('location'),
    ).toBe('/de/waitlist/expired');
  });

  it('does not re-confirm an unsubscribed address from an old link', async () => {
    await signupForm();
    await handleUnsubscribe(get(linkFrom(sent[0], 'unsubscribe')), deps);
    const res = await handleConfirm(get(linkFrom(sent[0], 'confirm')), deps);
    expect(res.headers.get('location')).toBe('/de/waitlist/expired');
    expect(row().status).toBe('unsubscribed');
  });
});

describe('/api/waitlist/unsubscribe', () => {
  it('unsubscribes via GET, idempotently', async () => {
    await signupJson();
    const url = linkFrom(sent[0], 'unsubscribe');
    const res = await handleUnsubscribe(get(url), deps);
    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe('/en/waitlist/unsubscribed');
    expect(repo.rows[0]).toMatchObject({ status: 'unsubscribed', unsubscribedAt: now });

    const first = now;
    now = new Date(now.getTime() + HOUR);
    expect((await handleUnsubscribe(get(url), deps)).headers.get('location')).toBe(
      '/en/waitlist/unsubscribed',
    );
    expect(row().unsubscribedAt).toBe(first);
  });

  it('unsubscribes via one-click POST, idempotently', async () => {
    await signupForm();
    const url = linkFrom(sent[0], 'unsubscribe');
    expect((await handleUnsubscribe(post(url), deps)).status).toBe(200);
    expect((await handleUnsubscribe(post(url), deps)).status).toBe(200);
    expect(row().status).toBe('unsubscribed');
  });

  it('answers an unknown token the same way without changing anything', async () => {
    await signupForm();
    const res = await handleUnsubscribe(
      get(`${SITE}/api/waitlist/unsubscribe?token=${'A'.repeat(43)}`),
      deps,
    );
    expect(res.headers.get('location')).toBe('/de/waitlist/unsubscribed');
    expect(row().status).toBe('pending');
  });
});
