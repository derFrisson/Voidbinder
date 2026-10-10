import { log } from '../../middleware/log';
import { TcgdexClient, type Fetch, type Pace, type Reply } from '../tcgdex/source';

// Reading the Pokémon TCG API's data (https://pokemontcg.io, served by Scrydex now) from its data
// repository (https://github.com/PokemonTCG/pokemon-tcg-data, checked 2026-10-10): the backup
// image source for the Pokémon prints TCGdex has no picture for (VB-118). sets/en.json (every set,
// one file) and cards/en/<set id>.json (a set's cards) hold the same records the API answers. The
// API itself is not usable from a Worker: keyless it allows 30 requests a minute per IP, the
// Workers' shared egress IPs answered 429 to the first request of every attempt, it answered 500
// or 502 to about half the requests from elsewhere too (2026-10-10), and key registrations are
// closed. The repository says its data stays available after the API goes offline (2027-03-01);
// it lags the API on SV promos (75 cards, the API has 196). The card images are plain URLs on
// images.pokemontcg.io, no key needed.

export const DATA = 'https://raw.githubusercontent.com/PokemonTCG/pokemon-tcg-data/master';

/** About 4 requests a second; a run is about 40 requests. */
export const PACE: Pace = { intervalMs: 250, retryDelayMs: 2000, attempts: 3 };

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

/** Logs every request (url, status, ms) so a failing run shows in `wrangler tail`. */
const logged =
  (fetchFn: Fetch): Fetch =>
  async (url, init) => {
    const start = Date.now();
    try {
      const res = await fetchFn(url, init);
      log('info', {
        message: 'pokemontcg request',
        url,
        status: res.status,
        ms: Date.now() - start,
      });
      return res;
    } catch (err) {
      log('warn', {
        message: 'pokemontcg request',
        url,
        error: String(err),
        ms: Date.now() - start,
      });
      throw err;
    }
  };

/** The paced, retrying, logging client. */
export const pokemontcgClient = (fetchFn: Fetch, pace: Pace = PACE) =>
  new TcgdexClient(logged(fetchFn), pace, DATA);

/** A JSON array file of the repository, body as sent (the raw copy); an error when it is missing. */
export async function list<T>(client: TcgdexClient, path: string): Promise<Reply<T[]>> {
  const reply = await client.get<T[]>(path);
  if (!reply) throw new Error(`pokemon-tcg-data has no ${path}`);
  return reply;
}

export const setsPath = '/sets/en.json';

/** A set's cards. Set ids are `[a-z0-9]+`. */
export const cardsPath = (setId: string) => `/cards/en/${encodeURIComponent(setId)}.json`;
