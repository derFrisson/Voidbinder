import type { BlobStore } from '@voidbinder/core';
import type { TcgdexCard, TcgdexSet, TcgdexSetBrief } from './types';

// Reading from TCGdex (https://tcgdex.dev/rest, https://github.com/tcgdex/cards-database, checked
// 2026-10-10). The REST API is the bulk path: GET /v2/{lang}/sets (brief list), /sets/{id} (set
// with its card ids) and /cards/{id} (the full card, one request per card and language). The
// repository holds TypeScript sources, not data files, its releases have no assets, and the
// GraphQL endpoint answers brief cards without the card fields and takes no language, so none of
// them is a dump. TCGdex states no rate limit and asks to be considerate: the client keeps
// under 10 requests per second, retries 429 and 5xx (it answers 503 now and then), and the
// importer only refetches what changed (see pipeline.ts).

export const USER_AGENT = 'Voidbinder/0.1 (+https://voidbinder.de)';
const API = 'https://api.tcgdex.net/v2';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

export interface Pace {
  /** Minimum time between two request starts. */
  intervalMs: number;
  /** First retry delay, multiplied by the attempt number; `Retry-After` wins when longer. */
  retryDelayMs: number;
  attempts: number;
}

/** About 9 requests per second. */
export const DEFAULT_PACE: Pace = { intervalMs: 110, retryDelayMs: 1000, attempts: 4 };

/** `Retry-After` as delay seconds or an HTTP date; 0 when absent, unreadable or in the past. */
export function retryAfterMs(header: string | null, now = Date.now()): number {
  if (!header?.trim()) return 0;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - now;
  return Number.isFinite(ms) ? Math.max(0, ms) : 0;
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export interface Reply<T> {
  /** The body as TCGdex sent it (kept as the raw copy). */
  text: string;
  data: T;
}

export class TcgdexClient {
  private next = 0;

  /** `base` and `headers` let another JSON API share the pacing (pokemontcg.io, VB-118). */
  constructor(
    private readonly fetchFn: Fetch,
    private readonly pace: Pace = DEFAULT_PACE,
    private readonly base: string = API,
    private readonly headers: Record<string, string> = {},
  ) {}

  /** Waits for this request's slot: request starts are at least `intervalMs` apart. */
  private async slot() {
    const at = Math.max(Date.now(), this.next);
    this.next = at + this.pace.intervalMs;
    if (at > Date.now()) await sleep(at - Date.now());
  }

  /** One paced request with retries: `read`'s result, null on 404, an error once the attempts are used up. */
  private async request<T>(
    url: string,
    init: RequestInit,
    read: (res: Response) => Promise<T>,
  ): Promise<T | null> {
    let failure = '';
    for (let attempt = 1; attempt <= this.pace.attempts; attempt++) {
      await this.slot();
      let retryAfter = 0;
      try {
        const res = await this.fetchFn(url, init);
        if (res.status === 404) return null;
        if (res.ok) return await read(res);
        failure = `answered ${res.status}`;
        if (res.status !== 429 && res.status < 500) break;
        retryAfter = retryAfterMs(res.headers.get('Retry-After'));
      } catch (err) {
        failure = String(err);
      }
      if (attempt < this.pace.attempts)
        await sleep(Math.max(this.pace.retryDelayMs * attempt, Math.min(retryAfter, 30_000)));
    }
    throw new Error(`${init.method ?? 'GET'} ${url} ${failure}`);
  }

  /** GET `path` below the base (/v2); null on 404, an error once the attempts are used up. */
  get<T>(path: string): Promise<Reply<T> | null> {
    return this.request(
      `${this.base}${path}`,
      { headers: { 'User-Agent': USER_AGENT, Accept: 'application/json', ...this.headers } },
      async (res) => {
        const text = await res.text();
        return { text, data: JSON.parse(text) as T };
      },
    );
  }

  /** HEAD on any URL (an asset) through the same pacing: true on 2xx, false on 404. */
  async exists(url: string): Promise<boolean> {
    const ok = await this.request(
      url,
      { method: 'HEAD', headers: { 'User-Agent': USER_AGENT } },
      async () => true,
    );
    return ok ?? false;
  }

  /** Every set of a language (names only), raw copy included. */
  async sets(lang: string): Promise<Reply<TcgdexSetBrief[]>> {
    const reply = await this.get<TcgdexSetBrief[]>(`/${lang}/sets`);
    if (!reply) throw new Error(`TCGdex has no /${lang}/sets`);
    return reply;
  }

  /** A set with its card ids; null when TCGdex has no such set in that language. */
  set(lang: string, id: string) {
    return this.get<TcgdexSet>(`/${lang}/sets/${encodeURIComponent(id)}`);
  }

  /** A card; the id is encoded once more than it looks (`exu-%3F` is a real id). */
  card(lang: string, id: string) {
    return this.get<TcgdexCard>(`/${lang}/cards/${encodeURIComponent(id)}`);
  }
}

/** `fn` over `items` with at most `limit` running at once, results in order. */
export async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let next = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i] as T);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

export async function putJson(blobs: BlobStore, key: string, text: string) {
  await blobs.put(key, text, { contentType: 'application/json' });
}

export async function readText(blobs: BlobStore, key: string): Promise<string> {
  const blob = await blobs.get(key);
  if (!blob) throw new Error(`${key} is missing`);
  return new Response(blob.body as ReadableStream<Uint8Array>).text();
}
