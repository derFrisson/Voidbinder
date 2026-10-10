import { ErrorResponseSchema } from '@voidbinder/shared/api';
import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { AppEnv } from '../app';
import { createApp } from '../app';
import { databaseUrl, freshDatabase, testDeps } from '../test-helpers';
import {
  requireTurnstile,
  skipsTurnstile,
  TURNSTILE_TEST_SECRET,
  type TurnstileConfig,
} from './turnstile';

const SIGN_UP = 'https://api.test/auth/sign-up/email';

/** The middleware in front of a handler that answers 200 "through", with a fake Siteverify. */
function setup(
  siteverify: () => Response | Promise<Response>,
  config: Partial<TurnstileConfig> = {},
) {
  const fetchFn = vi.fn<typeof fetch>(async () => siteverify());
  const app = new Hono<AppEnv>()
    .use(requestId())
    .use(
      requireTurnstile({
        secret: 'secret-1',
        skip: false,
        nativeBypass: false,
        fetch: fetchFn,
        ...config,
      }),
    )
    .all('*', (c) => c.text('through'));
  const post = (
    url: string,
    { headers = {}, body }: { headers?: Record<string, string>; body?: unknown } = {},
  ) =>
    app.request(url, {
      method: 'POST',
      headers: { ...(body !== undefined && { 'content-type': 'application/json' }), ...headers },
      ...(body !== undefined && { body: JSON.stringify(body) }),
    });
  return { app, fetchFn, post };
}

const verdict = (success: boolean, codes: string[] = []) =>
  Response.json({ success, 'error-codes': codes });

async function errorCode(res: Response) {
  return ErrorResponseSchema.parse(await res.json()).error.code;
}

describe('requireTurnstile', () => {
  it('passes a token from the header and sends secret, token and the client IP to Siteverify', async () => {
    const { post, fetchFn } = setup(() => verdict(true));
    const res = await post(SIGN_UP, {
      headers: { 'cf-turnstile-response': 'tok-1', 'cf-connecting-ip': '203.0.113.7' },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('through');
    const [url, init] = fetchFn.mock.calls[0] ?? [];
    expect(url).toBe('https://challenges.cloudflare.com/turnstile/v0/siteverify');
    expect(init?.method).toBe('POST');
    expect(Object.fromEntries(init?.body as URLSearchParams)).toEqual({
      secret: 'secret-1',
      response: 'tok-1',
      remoteip: '203.0.113.7',
    });
  });

  it('takes the token from a JSON body field and leaves the body readable', async () => {
    const { app, fetchFn } = setup(() => verdict(true));
    const res = await app.request(SIGN_UP, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: 'a@example.test', 'cf-turnstile-response': 'tok-2' }),
    });
    expect(res.status).toBe(200);
    expect((fetchFn.mock.calls[0]?.[1]?.body as URLSearchParams).get('response')).toBe('tok-2');
  });

  it('answers 400 turnstile_failed when Siteverify says no', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { post } = setup(() => verdict(false, ['timeout-or-duplicate']));
    const res = await post(SIGN_UP, { headers: { 'cf-turnstile-response': 'spent' } });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('turnstile_failed');
    // The log names the reason and never the token.
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('timeout-or-duplicate'));
    expect(warn).not.toHaveBeenCalledWith(expect.stringContaining('spent'));
    warn.mockRestore();
  });

  it('answers 400 turnstile_failed without calling Siteverify when there is no token', async () => {
    const { post, fetchFn } = setup(() => verdict(true));
    for (const res of [
      await post(SIGN_UP),
      await post(SIGN_UP, { body: { email: 'a@example.test' } }),
      await post(SIGN_UP, { headers: { 'cf-turnstile-response': '' } }),
    ]) {
      expect(res.status).toBe(400);
      expect(await errorCode(res)).toBe('turnstile_failed');
    }
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('answers 503 turnstile_unavailable when Siteverify cannot be reached or understood', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    const headers = { 'cf-turnstile-response': 'tok' };
    const network = setup(() => Promise.reject(new TypeError('network down')));
    const down = setup(() => new Response('bad gateway', { status: 502 }));
    const garbage = setup(() => new Response('<html>', { status: 200 }));
    for (const { post } of [network, down, garbage]) {
      const res = await post(SIGN_UP, { headers });
      expect(res.status).toBe(503);
      expect(await errorCode(res)).toBe('turnstile_unavailable');
    }
    error.mockRestore();
  });

  it('answers 503 and logs an error when Siteverify rejects our secret, not 400', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const code of ['missing-input-secret', 'invalid-input-secret', 'internal-error']) {
      const { post } = setup(() => verdict(false, [code]));
      const res = await post(SIGN_UP, { headers: { 'cf-turnstile-response': 'tok' } });
      expect(res.status).toBe(503);
      expect(await errorCode(res)).toBe('turnstile_unavailable');
      expect(error).toHaveBeenLastCalledWith(expect.stringContaining(code));
    }
    error.mockRestore();
  });

  it('covers the reset request and the verification resend, and only POST on those paths', async () => {
    const { post, app, fetchFn } = setup(() => verdict(false));
    for (const path of [
      '/auth/request-password-reset',
      '/auth/forget-password',
      '/auth/send-verification-email',
    ]) {
      expect((await post(`https://api.test${path}`)).status).toBe(400);
    }
    // Everything else is not this middleware's business.
    expect((await post('https://api.test/auth/sign-in/email')).status).toBe(200);
    expect((await post('https://api.test/auth/reset-password')).status).toBe(200);
    expect((await app.request(SIGN_UP)).status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('skips the check when configured (local development) without calling Siteverify', async () => {
    const { post, fetchFn } = setup(() => verdict(false), { skip: true });
    expect((await post(SIGN_UP)).status).toBe(200);
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('lets a bearer request through only with TURNSTILE_NATIVE_BYPASS on', async () => {
    const headers = { authorization: 'Bearer session-token' };
    const off = setup(() => verdict(false));
    expect((await off.post(SIGN_UP, { headers })).status).toBe(400);
    const on = setup(() => verdict(false), { nativeBypass: true });
    expect((await on.post(SIGN_UP, { headers })).status).toBe(200);
    // Without the header the flag changes nothing.
    expect((await on.post(SIGN_UP)).status).toBe(400);
  });
});

describe('skipsTurnstile', () => {
  it("skips only Cloudflare's test secret on the local environment", () => {
    expect(skipsTurnstile(TURNSTILE_TEST_SECRET, 'local')).toBe(true);
    expect(skipsTurnstile(TURNSTILE_TEST_SECRET, 'dev')).toBe(false);
    expect(skipsTurnstile(TURNSTILE_TEST_SECRET, 'prod')).toBe(false);
    expect(skipsTurnstile(TURNSTILE_TEST_SECRET, undefined)).toBe(false);
    expect(skipsTurnstile('0x4AAAAAAreal-secret', 'local')).toBe(false);
    expect(skipsTurnstile(undefined, 'local')).toBe(false);
  });
});

describe('the API app', () => {
  it('refuses a sign-up without a Turnstile token before Better Auth sees it', async () => {
    const app = createApp({
      ...testDeps(),
      turnstile: { secret: 'secret-1', skip: false, nativeBypass: false },
      openPlatform: () => ({ close: async () => undefined }) as never,
    });
    const res = await app.request(SIGN_UP, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.example.test' },
      body: JSON.stringify({ name: 'Ada', email: 'ada@example.test', password: 'correct horse' }),
    });
    expect(res.status).toBe(400);
    expect(await errorCode(res)).toBe('turnstile_failed');
  });
});

// A real Better Auth behind the check: DATABASE_URL like auth.test.ts.
describe.skipIf(!databaseUrl)('the API app, with Better Auth behind the check', () => {
  let db: Awaited<ReturnType<typeof freshDatabase>>;
  beforeAll(async () => void (db = await freshDatabase()));
  afterAll(() => db.drop());

  // Better Auth answers 404 to `/auth/sign-up/email/` today. This catches an upgrade that starts
  // to accept it (`skipTrailingSlashes`): the exact-path check would let that request by unchecked.
  it('never lets a trailing-slash sign-up reach the handler without a check', async () => {
    const app = createApp({
      ...testDeps(),
      turnstile: { secret: 'secret-1', skip: false, nativeBypass: false },
      openPlatform: () => ({ db: db.db, close: async () => undefined }) as never,
    });
    const res = await app.request(`${SIGN_UP}/`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'https://app.example.test' },
      body: JSON.stringify({ name: 'Ada', email: 'ada@example.test', password: 'correct horse' }),
    });
    expect([400, 404]).toContain(res.status);
  });
});
