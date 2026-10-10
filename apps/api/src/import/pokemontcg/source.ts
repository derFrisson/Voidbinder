import { TcgdexClient, type Fetch, type Pace, type Reply } from '../tcgdex/source';

// Reading from the Pokémon TCG API v2 (https://docs.pokemontcg.io, served by Scrydex now; checked
// 2026-10-10). The backup image source for the Pokémon prints TCGdex has no picture for (VB-118):
// GET /v2/sets (every set, one page) and /v2/cards?q=set.id:<id> (a set's cards, paged). Without a
// key the API allows 1,000 requests a day and 30 a minute; with `X-Api-Key` 20,000 a day. The API
// is deprecated: registrations are closed and existing keys work until 2027-03-01. It answers 500
// now and then (a page of 250 cards did, 100 did not), so pages are 100 and 5xx are retried. The
// card images are plain URLs on images.pokemontcg.io, no key needed.

export const API = 'https://api.pokemontcg.io/v2';

/** One request every 2.5 s: 24 a minute, under the keyless 30. */
export const PACE: Pace = { intervalMs: 2500, retryDelayMs: 5000, attempts: 4 };
const PAGE_SIZE = 100;

export interface PtcgSet {
  id: string;
  name: string;
  /** The PTCGO code (`SHF`, `PR-SM`); several sets can share one (`SHF`: Shining Fates and its Shiny Vault). */
  ptcgoCode?: string;
  /** `YYYY/MM/DD`. */
  releaseDate: string;
  total: number;
}

export interface PtcgCard {
  id: string;
  name: string;
  number: string;
  images?: { small?: string; large?: string };
}

interface Page<T> {
  data: T[];
  page: number;
  pageSize: number;
  count: number;
  totalCount: number;
}

/** The paced, retrying client; `key` is POKEMONTCG_API_KEY (optional). */
export const pokemontcgClient = (fetchFn: Fetch, key?: string, pace: Pace = PACE) =>
  new TcgdexClient(fetchFn, pace, API, key ? { 'X-Api-Key': key } : {});

/** Every page of a list endpoint: the items and each page's body as sent (the raw copy). */
export async function allPages<T>(
  client: TcgdexClient,
  path: string,
): Promise<{ data: T[]; bodies: string[] }> {
  const data: T[] = [];
  const bodies: string[] = [];
  for (let page = 1; ; page++) {
    const sep = path.includes('?') ? '&' : '?';
    const reply: Reply<Page<T>> | null = await client.get(
      `${path}${sep}page=${page}&pageSize=${PAGE_SIZE}`,
    );
    if (!reply) throw new Error(`pokemontcg.io has no ${path}`);
    data.push(...reply.data.data);
    bodies.push(reply.text);
    if (!reply.data.data.length || data.length >= reply.data.totalCount) return { data, bodies };
  }
}

export const setsPath = '/sets';

/**
 * A set's cards, only the fields the importer reads. The colon stays literal: `set.id%3A…`
 * answers 500. Set ids are `[a-z0-9]+`.
 */
export const cardsPath = (setId: string) =>
  `/cards?q=set.id:${encodeURIComponent(setId)}&select=id,name,number,images`;
