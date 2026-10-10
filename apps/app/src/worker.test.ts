import { describe, expect, it } from 'vitest';
import { securityHeaders, securityHeadersFor } from './security-headers';
import worker from './worker';

// The Worker with a fake `API` service binding that records what reaches it.
function harness(answer: (req: Request) => Response = () => new Response('{}')) {
  const seen: Request[] = [];
  const env = {
    API: { fetch: async (req: Request) => (seen.push(req), answer(req)) },
    ASSETS: {
      fetch: async () =>
        new Response('<!doctype html>', { headers: { 'content-type': 'text/html' } }),
    },
  } as unknown as Env;
  const call = (path: string, init?: RequestInit) =>
    worker.fetch(new Request(`https://app.voidbinder.de${path}`, init) as never, env);
  return { seen, call };
}

describe('worker', () => {
  it('forwards /api/* to the API without the prefix, query and method included', async () => {
    const { seen, call } = harness();
    await call('/api/auth/sign-in/email?x=1', {
      method: 'POST',
      body: '{"email":"a@b.test"}',
      headers: { 'content-type': 'application/json', cookie: 'c=1' },
    });
    const [req] = seen as [Request];
    expect(new URL(req.url).pathname).toBe('/auth/sign-in/email');
    expect(new URL(req.url).search).toBe('?x=1');
    expect(req.method).toBe('POST');
    expect(req.headers.get('cookie')).toBe('c=1');
    expect(await req.text()).toBe('{"email":"a@b.test"}');
  });

  it('passes the client IP on as cf-connecting-ip', async () => {
    const { seen, call } = harness();
    await call('/api/me', { headers: { 'cf-connecting-ip': '203.0.113.7' } });
    expect((seen as [Request])[0].headers.get('cf-connecting-ip')).toBe('203.0.113.7');
  });

  it('strips set-auth-token and keeps the cookies of the answer', async () => {
    const { call } = harness(() => {
      const headers = new Headers({ 'set-auth-token': 'secret' });
      headers.append(
        'set-cookie',
        '__Secure-better-auth.session_token=s; Path=/; HttpOnly; Secure',
      );
      return new Response('{}', { status: 200, headers });
    });
    const res = await call('/api/auth/sign-in/email', { method: 'POST' });
    expect(res.headers.get('set-auth-token')).toBeNull();
    expect(res.headers.getSetCookie()).toHaveLength(1);
  });

  it('serves the app with the security headers for anything else', async () => {
    const { seen, call } = harness();
    const res = await call('/collection');
    expect(seen).toHaveLength(0);
    for (const [name, value] of Object.entries(securityHeaders))
      expect(res.headers.get(name)).toBe(value);
    expect(res.headers.get('content-security-policy')).not.toMatch(/script-src[^;]*unsafe-inline/);
  });

  it('adds the Plausible host to connect-src only when one is configured', () => {
    const connect = (host?: string) =>
      /connect-src ([^;]*)/.exec(securityHeadersFor(host)['Content-Security-Policy'] ?? '')?.[1];
    expect(connect()).toBe("'self'");
    expect(connect('')).toBe("'self'");
    expect(connect('https://plausible.example.test/')).toBe(
      "'self' https://plausible.example.test",
    );
  });

  it('does not proxy paths that merely start with "api"', async () => {
    const { seen, call } = harness();
    await call('/apiary');
    expect(seen).toHaveLength(0);
  });
});
