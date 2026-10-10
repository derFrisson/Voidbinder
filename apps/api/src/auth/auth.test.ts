import { createHmac, randomUUID } from 'node:crypto';
import { ErrorResponseSchema, MeResponseSchema } from '@voidbinder/shared/api';
import { eq, like } from 'drizzle-orm';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../app';
import { rateLimit, session, twoFactor, user } from '../db/schema';
import { databaseUrl, freshDatabase, testDeps } from '../test-helpers';
import { AUTH_RATE_LIMITS } from './index';
import type { MailMessage } from './mail';
import { secretCipher } from './two-factor';

/** RFC 6238 TOTP (SHA-1, 6 digits, 30 s) of an otpauth URI's base32 secret, like an authenticator. */
function totp(base32: string, at = Date.now()): string {
  const bits = [...base32.replace(/=+$/, '').toUpperCase()]
    .map((c) => 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'.indexOf(c).toString(2).padStart(5, '0'))
    .join('');
  const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((b) => parseInt(b, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac('sha1', key).update(counter).digest();
  const offset = (h[19] ?? 0) & 0xf;
  return String((h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, '0');
}

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

  it('answers 429 once a client IP used up its sign-up, sign-in and 2FA code attempts', async () => {
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
  describe('two-factor authentication', () => {
    /** Enables 2FA for a signed-in browser: the password, then the first code turns it on. */
    async function enable(b: ReturnType<typeof browser>) {
      const res = await b.request('/auth/two-factor/enable', { body: { password: PASSWORD } });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { totpURI: string; backupCodes: string[] };
      const secret = new URL(body.totpURI).searchParams.get('secret') ?? '';
      const verify = await b.request('/auth/two-factor/verify-totp', {
        body: { code: totp(secret) },
      });
      expect(verify.status).toBe(200);
      return { secret, backupCodes: body.backupCodes, totpURI: body.totpURI };
    }

    async function signInStep(b: ReturnType<typeof browser>, email: string) {
      const res = await b.request('/auth/sign-in/email', { body: { email, password: PASSWORD } });
      expect(res.status).toBe(200);
      return { res, body: (await res.json()) as { twoFactorRedirect?: boolean } };
    }

    /** A browser that passed the code step with "remember this device", then signed out. */
    async function trustedDevice(email: string, secret: string) {
      const device = browser();
      await signInStep(device, email);
      const verify = await device.request('/auth/two-factor/verify-totp', {
        body: { code: totp(secret), trustDevice: true },
      });
      expect(verify.status).toBe(200);
      await device.request('/auth/sign-out', { body: {} });
      return device;
    }

    async function twoFactorRow(email: string) {
      const [row] = await db
        .select({ enabled: user.twoFactorEnabled, tf: twoFactor })
        .from(user)
        .leftJoin(twoFactor, eq(twoFactor.userId, user.id))
        .where(eq(user.email, email));
      return row;
    }

    it('enables 2FA only after the first code, with the password, and keeps the secrets encrypted', async () => {
      const { b, email } = await signedIn();
      const wrong = await b.request('/auth/two-factor/enable', {
        body: { password: 'wrong password!' },
      });
      expect(wrong.status).toBe(400);

      const res = await b.request('/auth/two-factor/enable', { body: { password: PASSWORD } });
      const { totpURI, backupCodes } = (await res.json()) as {
        totpURI: string;
        backupCodes: string[];
      };
      const uri = new URL(totpURI);
      expect(uri.protocol).toBe('otpauth:');
      expect(uri.searchParams.get('issuer')).toBe('Voidbinder');
      expect(uri.searchParams.get('digits')).toBe('6');
      expect(uri.searchParams.get('period')).toBe('30');
      expect(backupCodes).toHaveLength(10);
      expect((await twoFactorRow(email))?.enabled).toBe(false);

      const secret = uri.searchParams.get('secret') ?? '';
      expect(
        (await b.request('/auth/two-factor/verify-totp', { body: { code: '000000' } })).status,
      ).toBe(401);
      expect((await twoFactorRow(email))?.enabled).toBe(false);
      const verify = await b.request('/auth/two-factor/verify-totp', {
        body: { code: totp(secret) },
      });
      expect(verify.status).toBe(200);
      const row = await twoFactorRow(email);
      expect(row?.enabled).toBe(true);
      expect(row?.tf?.verified).toBe(true);

      // At rest: AES-GCM with TWO_FACTOR_ENCRYPTION_KEY around Better Auth's own encryption of the
      // secret; the backup codes with the 2FA key alone. Neither shows the plain values.
      const cipher = secretCipher(deps.auth.twoFactorKey);
      const stored = `${row?.tf?.secret} ${row?.tf?.backupCodes}`;
      for (const plain of [secret, ...backupCodes]) expect(stored).not.toContain(plain);
      expect(await cipher.decrypt(row?.tf?.secret ?? '')).toMatch(/^\$ba\$|^[0-9a-f]+$/);
      expect(JSON.parse(await cipher.decrypt(row?.tf?.backupCodes ?? ''))).toEqual(backupCodes);
    });

    it('asks for the code after the password and signs in only with a valid one', async () => {
      const { b, email } = await signedIn();
      const { secret } = await enable(b);

      const other = browser();
      const { body } = await signInStep(other, email);
      expect(body).toMatchObject({ twoFactorRedirect: true, twoFactorMethods: ['totp'] });
      expect([...other.jar.keys()].some((k) => k.endsWith('session_token'))).toBe(false);
      expect((await other.request('/me')).status).toBe(401);

      const wrong = await other.request('/auth/two-factor/verify-totp', {
        body: { code: '000000' },
      });
      expect(wrong.status).toBe(401);
      expect((await other.request('/me')).status).toBe(401);

      const ok = await other.request('/auth/two-factor/verify-totp', {
        body: { code: totp(secret) },
      });
      expect(ok.status).toBe(200);
      expect((await other.request('/me')).status).toBe(200);
    });

    it('takes a backup code once and answers a wrong one like a wrong TOTP code', async () => {
      const { b, email } = await signedIn();
      const { backupCodes } = await enable(b);
      const code = backupCodes[0] ?? '';

      const first = browser();
      await signInStep(first, email);
      const wrongTotp = await first.request('/auth/two-factor/verify-totp', {
        body: { code: '000000' },
      });
      const wrongBackup = await first.request('/auth/two-factor/verify-backup-code', {
        body: { code: 'AAAAA-BBBBB' },
      });
      expect(wrongBackup.status).toBe(wrongTotp.status);
      expect(await wrongBackup.json()).toEqual(await wrongTotp.json());

      const used = await first.request('/auth/two-factor/verify-backup-code', { body: { code } });
      expect(used.status).toBe(200);
      expect((await first.request('/me')).status).toBe(200);

      const second = browser();
      await signInStep(second, email);
      const again = await second.request('/auth/two-factor/verify-backup-code', {
        body: { code },
      });
      expect(again.status).toBe(401);
      expect(await again.json()).toEqual({ code: 'INVALID_CODE', message: 'Invalid code' });
      expect((await second.request('/me')).status).toBe(401);
    });

    it('skips the challenge on a device trusted for 30 days', async () => {
      const { b, email } = await signedIn();
      const { secret } = await enable(b);

      const device = browser();
      await signInStep(device, email);
      const verify = await device.request('/auth/two-factor/verify-totp', {
        body: { code: totp(secret), trustDevice: true },
      });
      expect(verify.status).toBe(200);
      const trust = device.setCookies().find((c) => c.includes('trust_device='));
      expect(trust).toMatch(/Max-Age=2592000/i);
      expect(trust).toMatch(/; HttpOnly/i);
      await device.request('/auth/sign-out', { body: {} });
      expect((await device.request('/me')).status).toBe(401);

      const { body } = await signInStep(device, email);
      expect(body.twoFactorRedirect).toBeUndefined();
      expect((await device.request('/me')).status).toBe(200);

      // Another browser still gets the challenge.
      expect((await signInStep(browser(), email)).body.twoFactorRedirect).toBe(true);
    });

    it('regenerates backup codes and disables 2FA only with the password', async () => {
      const { b, email } = await signedIn();
      const { backupCodes } = await enable(b);

      const badRegen = await b.request('/auth/two-factor/generate-backup-codes', {
        body: { password: 'wrong password!' },
      });
      expect(badRegen.status).toBe(400);
      const regen = await b.request('/auth/two-factor/generate-backup-codes', {
        body: { password: PASSWORD },
      });
      expect(regen.status).toBe(200);
      const fresh = ((await regen.json()) as { backupCodes: string[] }).backupCodes;
      expect(fresh).toHaveLength(10);
      expect(fresh).not.toContain(backupCodes[0]);

      expect(
        (await b.request('/auth/two-factor/disable', { body: { password: 'wrong password!' } }))
          .status,
      ).toBe(400);
      expect((await b.request('/auth/two-factor/disable', { body: {} })).status).toBe(400);
      expect((await twoFactorRow(email))?.enabled).toBe(true);

      const off = await b.request('/auth/two-factor/disable', { body: { password: PASSWORD } });
      expect(off.status).toBe(200);
      const row = await twoFactorRow(email);
      expect(row?.enabled).toBe(false);
      expect(row?.tf).toBeNull();
      expect((await signInStep(browser(), email)).body.twoFactorRedirect).toBeUndefined();
    });

    it('gives a native (bearer) client the same challenge and its token after the code', async () => {
      const { b, email } = await signedIn();
      const { secret } = await enable(b);

      // The native client keeps the challenge cookie (Better Auth's Expo plugin stores cookies).
      const native = browser();
      const { res, body } = await signInStep(native, email);
      expect(body.twoFactorRedirect).toBe(true);
      expect(res.headers.get('set-auth-token')).toBeNull();

      const verify = await native.request('/auth/two-factor/verify-totp', {
        body: { code: totp(secret) },
      });
      expect(verify.status).toBe(200);
      const token = verify.headers.get('set-auth-token');
      expect(token).toBeTruthy();

      const app = browser();
      app.useBearer(token ?? '');
      expect((await app.request('/me')).status).toBe(200);
    });

    it('forgets every trusted device when 2FA is turned off and on again elsewhere', async () => {
      const { b, email } = await signedIn();
      const { secret } = await enable(b);
      const device = await trustedDevice(email, secret);
      expect((await signInStep(device, email)).body.twoFactorRedirect).toBeUndefined();
      await device.request('/auth/sign-out', { body: {} });

      const off = await b.request('/auth/two-factor/disable', { body: { password: PASSWORD } });
      expect(off.status).toBe(200);
      await enable(b);
      expect((await signInStep(device, email)).body.twoFactorRedirect).toBe(true);
    });

    it('keeps 2FA through a password reset and forgets the trusted devices', async () => {
      const { b, email } = await signedIn('en');
      const { secret } = await enable(b);
      const other = await trustedDevice(email, secret);
      await other.request('/auth/request-password-reset', { body: { email } });
      const reset = await other.request('/auth/reset-password', {
        body: {
          token: tokenIn(lastMailTo(email), '/reset-password'),
          newPassword: 'a brand new password',
        },
      });
      expect(reset.status).toBe(200);
      const signIn = await other.request('/auth/sign-in/email', {
        body: { email, password: 'a brand new password' },
      });
      expect(((await signIn.json()) as { twoFactorRedirect?: boolean }).twoFactorRedirect).toBe(
        true,
      );
      expect((await twoFactorRow(email))?.enabled).toBe(true);
    });

    it('withdraws a deletion request only once the second factor passed', async () => {
      const { b, email } = await signedIn();
      const { secret } = await enable(b);
      expect((await b.request('/me', { method: 'DELETE' })).status).toBe(202);

      const again = browser();
      await signInStep(again, email);
      const [pending] = await db.select().from(user).where(eq(user.email, email));
      expect(pending?.deletionRequestedAt).toBeInstanceOf(Date);

      await again.request('/auth/two-factor/verify-totp', { body: { code: totp(secret) } });
      const [withdrawn] = await db.select().from(user).where(eq(user.email, email));
      expect(withdrawn?.deletionRequestedAt).toBeNull();
    });
  });
});
