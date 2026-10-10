import { randomUUID } from 'node:crypto';
import { ErrorResponseSchema, MeResponseSchema } from '@voidbinder/shared/api';
import { eq, like } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { rateLimit, session, user } from '../db/schema';
import { databaseUrl, freshDatabase, testDeps } from '../test-helpers';
import { AUTH_RATE_LIMITS } from './index';
import type { MailMessage } from './mail';

// Integration tests against a real Postgres: `docker compose up -d` at the repo root, then
// DATABASE_URL=postgres://voidbinder:voidbinder@localhost:5434/voidbinder pnpm --filter api test
describe.skipIf(!databaseUrl)('auth and /me (Postgres)', () => {
  let db: NodePgDatabase;
  let drop: () => Promise<void>;
  const mails: MailMessage[] = [];
  const deps = testDeps(mails);
  const app = createApp({
    ...deps,
    openPlatform: () => ({
      cardStore: {} as never,
      collectionStore: {} as never,
      deckStore: {} as never,
      blobStore: {} as never,
      jobQueue: {} as never,
      db,
      close: async () => undefined,
    }),
  });

  beforeAll(async () => {
    ({ db, drop } = await freshDatabase());
  });

  afterAll(() => drop());

  /**
   * One browser: its own client IP (rate limits count per IP), a cookie jar, the app's Origin.
   * `bearer` sends `Authorization: Bearer` instead of cookies, like a native client.
   */
  function browser(lang = 'de-DE') {
    const ip = `10.${[1, 2, 3].map(() => Math.floor(Math.random() * 256)).join('.')}`;
    const jar = new Map<string, string>();
    let lastSetCookie: string[] = [];
    let bearer: string | undefined;
    async function request(path: string, init: { method?: string; body?: unknown } = {}) {
      const headers = new Headers({
        Origin: deps.appUrl,
        'cf-connecting-ip': ip,
        'Accept-Language': lang,
      });
      if (init.body !== undefined) headers.set('Content-Type', 'application/json');
      if (bearer) headers.set('Authorization', `Bearer ${bearer}`);
      else if (jar.size) headers.set('Cookie', [...jar].map(([k, v]) => `${k}=${v}`).join('; '));
      const res = await app.request(path, {
        method: init.method ?? (init.body === undefined ? 'GET' : 'POST'),
        headers,
        ...(init.body !== undefined && { body: JSON.stringify(init.body) }),
      });
      lastSetCookie = res.headers.getSetCookie();
      for (const cookie of lastSetCookie) {
        const [pair = ''] = cookie.split(';');
        const [name = '', value = ''] = pair.split('=');
        if (value && !/max-age=0/i.test(cookie)) jar.set(name, value);
        else jar.delete(name);
      }
      return res;
    }
    return {
      ip,
      request,
      jar,
      setCookies: () => lastSetCookie,
      useBearer: (token: string | undefined) => void (bearer = token),
    };
  }

  const PASSWORD = 'correct horse battery';

  function lastMailTo(email: string): MailMessage {
    const mail = mails.findLast((m) => m.to === email);
    if (!mail) throw new Error(`no mail to ${email}`);
    return mail;
  }

  function tokenIn(mail: MailMessage, path: string): string {
    const match = new RegExp(`${deps.appUrl}${path}\\?token=([^\\s"&]+)`).exec(mail.text);
    if (!match?.[1]) throw new Error(`no ${path} link in mail`);
    return decodeURIComponent(match[1]);
  }

  /** A signed-up and verified user, signed in on a fresh browser. */
  async function signedIn(lang?: string) {
    const b = browser(lang);
    const email = `${randomUUID()}@example.test`;
    await b.request('/auth/sign-up/email', { body: { name: 'Ash', email, password: PASSWORD } });
    await b.request(`/auth/verify-email?token=${tokenIn(lastMailTo(email), '/verify')}`);
    const res = await b.request('/auth/sign-in/email', { body: { email, password: PASSWORD } });
    expect(res.status).toBe(200);
    return { b, email, bearerToken: res.headers.get('set-auth-token') ?? '' };
  }

  it('sends a verification mail on sign-up and refuses sign-in until it is used', async () => {
    const b = browser('en-US,en;q=0.9');
    const email = `${randomUUID()}@example.test`;
    const signUp = await b.request('/auth/sign-up/email', {
      body: { name: 'Ash', email, password: PASSWORD },
    });
    expect(signUp.status).toBe(200);

    const mail = lastMailTo(email);
    expect(mail.subject).toBe('Confirm your email address for Voidbinder');
    expect(mail.html).toContain(`${deps.appUrl}/verify?token=`);
    expect(tokenIn(mail, '/verify')).not.toBe('');

    const signIn = await b.request('/auth/sign-in/email', { body: { email, password: PASSWORD } });
    expect(signIn.status).toBe(403);
    expect(b.jar.size).toBe(0);
  });

  it('signs in after verification and sets a secure, http-only, lax session cookie', async () => {
    const b = browser();
    const email = `${randomUUID()}@example.test`;
    await b.request('/auth/sign-up/email', { body: { name: 'Ash', email, password: PASSWORD } });
    const mail = lastMailTo(email);
    expect(mail.subject).toBe('Bestätige deine E-Mail-Adresse für Voidbinder');

    const verify = await b.request(`/auth/verify-email?token=${tokenIn(mail, '/verify')}`);
    expect(verify.status).toBe(200);

    const signIn = await b.request('/auth/sign-in/email', { body: { email, password: PASSWORD } });
    expect(signIn.status).toBe(200);
    const cookie = b.setCookies().find((c) => c.includes('session_token='));
    expect(cookie).toMatch(/^__Secure-/);
    expect(cookie).toMatch(/; HttpOnly/i);
    expect(cookie).toMatch(/; Secure/i);
    expect(cookie).toMatch(/; SameSite=Lax/i);
    expect(cookie).toMatch(/; Path=\//i);
  });

  it('refuses a wrong password', async () => {
    const { email } = await signedIn();
    const res = await browser().request('/auth/sign-in/email', {
      body: { email, password: 'wrong password!' },
    });
    expect(res.status).toBe(401);
  });

  it('resets the password by mail, refuses the old one and revokes every session', async () => {
    const { b, email, bearerToken } = await signedIn('en');
    const other = browser();

    const ask = await other.request('/auth/request-password-reset', { body: { email } });
    expect(ask.status).toBe(200);
    const mail = lastMailTo(email);
    expect(mail.subject).toBe('Reset your Voidbinder password');

    const reset = await other.request('/auth/reset-password', {
      body: { token: tokenIn(mail, '/reset-password'), newPassword: 'a brand new password' },
    });
    expect(reset.status).toBe(200);

    const old = await other.request('/auth/sign-in/email', { body: { email, password: PASSWORD } });
    expect(old.status).toBe(401);
    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(
      await db
        .select()
        .from(session)
        .where(eq(session.userId, row?.id ?? '')),
    ).toEqual([]);
    b.useBearer(bearerToken);
    expect((await b.request('/me')).status).toBe(401);

    const fresh = await other.request('/auth/sign-in/email', {
      body: { email, password: 'a brand new password' },
    });
    expect(fresh.status).toBe(200);
  });

  it('answers GET /me with 401 when signed out, and with the profile by cookie and by bearer', async () => {
    const out = await browser().request('/me');
    expect(out.status).toBe(401);
    expect(out.headers.get('WWW-Authenticate')).toBe('Bearer');
    expect(ErrorResponseSchema.parse(await out.json()).error.code).toBe('unauthorized');

    const { b, email, bearerToken } = await signedIn('en-GB');
    const byCookie = await b.request('/me');
    expect(byCookie.status).toBe(200);
    expect(MeResponseSchema.parse(await byCookie.json())).toMatchObject({
      email,
      emailVerified: true,
      name: 'Ash',
      displayName: null,
      language: 'en',
      currency: 'EUR',
      trainingDataOptIn: false,
      deletionRequestedAt: null,
    });

    const native = browser();
    native.useBearer(bearerToken);
    const byBearer = await native.request('/me');
    expect(byBearer.status).toBe(200);
    expect(MeResponseSchema.parse(await byBearer.json()).email).toBe(email);
  });

  it('validates PATCH /me and updates the profile', async () => {
    const { b } = await signedIn();
    const bad = await b.request('/me', { method: 'PATCH', body: { language: 'fr' } });
    expect(bad.status).toBe(400);
    expect(ErrorResponseSchema.parse(await bad.json()).error.issues?.[0]?.path).toEqual([
      'language',
    ]);
    expect((await b.request('/me', { method: 'PATCH', body: { role: 'admin' } })).status).toBe(400);

    const patch = {
      displayName: 'Ash K.',
      language: 'en',
      currency: 'USD',
      trainingDataOptIn: true,
    };
    const ok = await b.request('/me', { method: 'PATCH', body: patch });
    expect(ok.status).toBe(200);
    expect(MeResponseSchema.parse(await ok.json())).toMatchObject(patch);
    expect(MeResponseSchema.parse(await (await b.request('/me')).json())).toMatchObject(patch);
  });

  it('DELETE /me records the request, revokes every session and clears the cookie', async () => {
    const { b, email, bearerToken } = await signedIn();
    const res = await b.request('/me', { method: 'DELETE' });
    expect(res.status).toBe(202);
    expect(b.jar.size).toBe(0);

    const [row] = await db.select().from(user).where(eq(user.email, email));
    expect(row?.deletionRequestedAt).toBeInstanceOf(Date);
    expect(
      await db
        .select()
        .from(session)
        .where(eq(session.userId, row?.id ?? '')),
    ).toEqual([]);
    const native = browser();
    native.useBearer(bearerToken);
    expect((await native.request('/me')).status).toBe(401);
  });

  it('refuses the old cookie on /me at once after DELETE /me, cookie cache or not', async () => {
    const { b } = await signedIn();
    expect((await b.request('/me')).status).toBe(200);
    const oldCookies = new Map(b.jar);
    expect([...oldCookies.keys()].some((k) => k.endsWith('session_data'))).toBe(true);
    expect((await b.request('/me', { method: 'DELETE' })).status).toBe(202);

    for (const [k, v] of oldCookies) b.jar.set(k, v);
    const res = await b.request('/me');
    expect(res.status).toBe(401);
    expect(res.headers.get('WWW-Authenticate')).toBe('Bearer');
  });

  it('withdraws the deletion request when the user signs in again', async () => {
    const { b, email } = await signedIn();
    await b.request('/me', { method: 'DELETE' });
    const [requested] = await db.select().from(user).where(eq(user.email, email));
    expect(requested?.deletionRequestedAt).toBeInstanceOf(Date);

    const again = browser();
    const signIn = await again.request('/auth/sign-in/email', {
      body: { email, password: PASSWORD },
    });
    expect(signIn.status).toBe(200);
    const me = MeResponseSchema.parse(await (await again.request('/me')).json());
    expect(me.deletionRequestedAt).toBeNull();
  });

  it('refuses a language, currency or display name outside the profile rules in the database', async () => {
    const row = { id: randomUUID(), name: 'Ash', email: `${randomUUID()}@example.test` };
    // Drizzle wraps the driver error; the constraint name is on its cause.
    const violated = (values: Partial<typeof user.$inferInsert>) =>
      db
        .insert(user)
        .values({ ...row, ...values })
        .then(
          () => 'inserted',
          (err: Error) => String((err.cause as { constraint?: string } | undefined)?.constraint),
        );
    expect(await violated({ language: 'fr' })).toBe('user_language_check');
    expect(await violated({ currency: 'GBP' })).toBe('user_currency_check');
    expect(await violated({ displayName: 'A' })).toBe('user_display_name_check');
    expect(await violated({})).toBe('inserted');
  });

  it('answers 429 once a client IP used up its sign-up and sign-in attempts', async () => {
    const b = browser();
    for (const [path, rule] of Object.entries(AUTH_RATE_LIMITS)) {
      const body = { name: 'Ash', email: `${randomUUID()}@example.test`, password: PASSWORD };
      for (let i = 0; i < rule.max; i++) {
        expect((await b.request(`/auth${path}`, { body })).status).not.toBe(429);
      }
      const limited = await b.request(`/auth${path}`, { body });
      expect(limited.status).toBe(429);
      expect(Number(limited.headers.get('X-Retry-After'))).toBeGreaterThan(0);
    }
    // Counted in Postgres, not in the isolate's memory.
    const rows = await db
      .select()
      .from(rateLimit)
      .where(like(rateLimit.key, `%${b.ip}%`));
    expect(rows).toHaveLength(Object.keys(AUTH_RATE_LIMITS).length);
  });
});
