import { describe, expect, it } from 'vitest';
import { mapLimit, TcgdexClient, type Fetch } from './source';

const json = (body: unknown, status = 200, headers: HeadersInit = {}) =>
  new Response(JSON.stringify(body), { status, headers });
const fast = { intervalMs: 0, retryDelayMs: 0, attempts: 3 };

describe('TcgdexClient', () => {
  it('answers null for a 404 and keeps the raw text', async () => {
    const client = new TcgdexClient(
      async (url) => (url.endsWith('/no') ? json({}, 404) : json([1])),
      fast,
    );
    expect(await client.get('/en/cards/no')).toBeNull();
    expect(await client.get('/en/sets')).toEqual({ text: '[1]', data: [1] });
  });

  it('encodes card ids once more than they look: exu-%3F is a real id', async () => {
    const urls: string[] = [];
    const client = new TcgdexClient(async (url) => (urls.push(url), json({})), fast);
    await client.card('en', 'exu-%3F');
    await client.card('de', 'swshp-SWSH001');
    expect(urls).toEqual([
      'https://api.tcgdex.net/v2/en/cards/exu-%253F',
      'https://api.tcgdex.net/v2/de/cards/swshp-SWSH001',
    ]);
  });

  it('sends a descriptive User-Agent', async () => {
    let agent = '';
    const client = new TcgdexClient(async (_url, init) => {
      agent = new Headers(init?.headers).get('User-Agent') ?? '';
      return json({});
    }, fast);
    await client.get('/en/sets');
    expect(agent).toContain('Voidbinder');
  });

  it('retries 503, 429 and a network error, then succeeds', async () => {
    const answers = [
      () => json({}, 503),
      () => json({}, 429, { 'Retry-After': '0' }),
      () => Promise.reject(new TypeError('network')),
    ];
    let n = 0;
    const fetchFn: Fetch = async () => {
      const next = answers[n++];
      return next ? next() : json({ ok: true });
    };
    const client = new TcgdexClient(fetchFn, { ...fast, attempts: 4 });
    expect((await client.get('/en/sets'))?.data).toEqual({ ok: true });
    expect(n).toBe(4);
  });

  it('gives up after the attempts and names the status', async () => {
    let n = 0;
    const client = new TcgdexClient(async () => (n++, json({}, 502)), fast);
    await expect(client.get('/en/sets')).rejects.toThrow(/answered 502/);
    expect(n).toBe(3);
  });

  it('does not retry a 4xx other than 429', async () => {
    let n = 0;
    const client = new TcgdexClient(async () => (n++, json({}, 400)), fast);
    await expect(client.get('/en/sets')).rejects.toThrow(/answered 400/);
    expect(n).toBe(1);
  });

  it('keeps request starts one interval apart, also for parallel callers', async () => {
    const starts: number[] = [];
    const client = new TcgdexClient(async () => (starts.push(Date.now()), json({})), {
      ...fast,
      intervalMs: 40,
    });
    await Promise.all(Array.from({ length: 5 }, () => client.get('/en/sets')));
    const gaps = starts.slice(1).map((t, i) => t - (starts[i] ?? 0));
    // Timers may fire a millisecond early; the point is that no gap is near zero.
    expect(Math.min(...gaps)).toBeGreaterThanOrEqual(30);
  });
});

describe('mapLimit', () => {
  it('keeps the order and never runs more than `limit` at once', async () => {
    let running = 0;
    let peak = 0;
    const out = await mapLimit([1, 2, 3, 4, 5, 6], 2, async (n) => {
      peak = Math.max(peak, ++running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
      return n * 10;
    });
    expect(out).toEqual([10, 20, 30, 40, 50, 60]);
    expect(peak).toBe(2);
  });
});
