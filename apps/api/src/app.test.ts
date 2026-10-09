import { zValidator } from '@hono/zod-validator';
import type { CardStore } from '@voidbinder/core';
import { ErrorResponseSchema } from '@voidbinder/shared/api';
import { Hono } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import type { AppEnv } from './app';
import { notFound, onError, throwOnInvalid } from './middleware/errors';
import { testApp } from './test-helpers';

afterEach(() => vi.restoreAllMocks());

describe('GET /health', () => {
  it('is ok when the database answers', async () => {
    const res = await testApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', db: 'ok', version: 'test' });
  });

  it('is degraded with 503 when the ping fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await testApp({ dbUp: false }).request('/health');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'degraded', db: 'error', version: 'test' });
  });

  it('sets security, cache and request id headers', async () => {
    const res = await testApp().request('/health', { headers: { 'X-Request-Id': 'abc' } });
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    expect(res.headers.get('X-Request-Id')).toBe('abc');
  });
});

describe('errors', () => {
  it('answers unknown paths, including /, with a JSON 404', async () => {
    const res = await testApp().request('/', { headers: { 'X-Request-Id': 'r1' } });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: { code: 'not_found', message: 'Not found', requestId: 'r1' },
    });
  });

  // A throwaway app with the same handlers: the real routes have no input or failure to test yet.
  const app = new Hono<AppEnv>()
    .use((c, next) => {
      c.set('requestId', 'r2');
      return next();
    })
    .post(
      '/items',
      zValidator('json', z.object({ name: z.string().min(1) }), throwOnInvalid),
      (c) => c.json(c.req.valid('json')),
    )
    .get('/teapot', () => {
      throw new HTTPException(409, { message: 'Already there' });
    })
    .get('/boom', () => {
      throw new Error('secret detail');
    })
    .notFound(notFound)
    .onError(onError);

  it('turns a Zod validation failure into 400 with issues', async () => {
    const res = await app.request('/items', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '' }),
    });
    expect(res.status).toBe(400);
    const body = ErrorResponseSchema.parse(await res.json());
    expect(body.error).toMatchObject({ code: 'invalid_request', requestId: 'r2' });
    expect(body.error.issues?.[0]?.path).toEqual(['name']);
  });

  it('keeps the status of an HTTPException', async () => {
    const res = await app.request('/teapot');
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: { code: 'conflict', message: 'Already there', requestId: 'r2' },
    });
  });

  it('never leaks the message or stack of an unexpected error', async () => {
    const logged = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const res = await app.request('/boom');
    expect(res.status).toBe(500);
    const text = await res.text();
    expect(text).not.toContain('secret detail');
    expect(JSON.parse(text)).toEqual({
      error: { code: 'internal', message: 'Internal server error', requestId: 'r2' },
    });
    expect(logged.mock.calls[0]?.[0]).toContain('secret detail');
  });
});

describe('CORS', () => {
  it('admits the app origin and Expo web dev with credentials, nothing else', async () => {
    const app = testApp();
    for (const origin of ['https://app.example.test', 'http://localhost:8081']) {
      const res = await app.request('/health', { headers: { Origin: origin } });
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(res.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    }
    const res = await app.request('/health', { headers: { Origin: 'https://evil.example' } });
    expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});

describe('access log', () => {
  it('writes one JSON line per request', async () => {
    const lines = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    await testApp().request('/health', { headers: { 'X-Request-Id': 'r3' } });
    expect(lines).toHaveBeenCalledTimes(1);
    expect(JSON.parse(String(lines.mock.calls[0]?.[0]))).toMatchObject({
      level: 'info',
      requestId: 'r3',
      method: 'GET',
      path: '/health',
      status: 200,
      cf: {},
    });
  });
});

describe('POST /admin/import/scryfall', () => {
  it('starts the import with the admin token only', async () => {
    const jobs: { type: string }[] = [];
    const jobQueue = { send: async (job: { type: string }) => void jobs.push(job) };
    const post = (app: ReturnType<typeof testApp>, token?: string) =>
      app.request('/admin/import/scryfall', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });

    // No import running (the 409 is tested against Postgres in routes/admin.test.ts).
    const cardStore = { importRunning: async () => false } as Partial<CardStore> as CardStore;
    const app = testApp({ adminToken: 'secret-token', jobQueue, cardStore });
    expect((await post(app)).status).toBe(401);
    expect((await post(app, 'wrong-token')).status).toBe(401);
    const res = await post(app, 'secret-token');
    expect(res.status).toBe(202);
    expect(await res.json()).toEqual({ status: 'started' });
    expect(jobs).toEqual([{ type: 'scryfall-import', payload: {} }]);

    // Without ADMIN_TOKEN the route does not exist.
    expect((await post(testApp({ jobQueue }), 'anything')).status).toBe(404);
  });
});
