import { readFileSync } from 'node:fs';
import { MemoryBlobStore } from '../scryfall/test-fixtures';
import { TcgdexClient, type Fetch } from './source';
import type { TcgdexCard, TcgdexSet } from './types';

// Test doubles for the TCGdex import: real TCGdex objects (prices stripped) behind a fake `fetch`.
// test/fixtures/tcgdex/ holds three sets of 8 cards (swsh3: Pokémon, Trainer and Energy cards with
// reverse variants; base1: first edition cards; swshp: two cards without a German localization)
// and the Pocket set A1, which the importer must skip. base1-4's variants are made up: TCGdex has
// no card with all four.

export { MemoryBlobStore };

const dir = new URL('../../../test/fixtures/tcgdex/', import.meta.url);
const read = (path: string): string => readFileSync(new URL(path, dir).pathname, 'utf8');
export const fixture = <T>(path: string): T => JSON.parse(read(path)) as T;
export const card = (lang: string, id: string) => fixture<TcgdexCard>(`cards/${lang}/${id}.json`);
export const setDetail = (lang: string, id: string) =>
  fixture<TcgdexSet>(`sets/${lang}/${id}.json`);

export interface FakeTcgdex {
  /** Replaces the answer to a path (below /v2) before the fixtures are looked at. */
  override?: (path: string) => Response | undefined;
  /** Every path requested, in order. */
  calls?: string[];
}

/** `fetch` answering the set list, set details and cards from the fixtures; 404 for the rest. */
export function fakeTcgdex(opts: FakeTcgdex = {}): Fetch {
  return async (url) => {
    const path = new URL(url).pathname.replace(/^\/v2/, '');
    opts.calls?.push(path);
    const overridden = opts.override?.(path);
    if (overridden) return overridden;
    const decoded = decodeURIComponent(path);
    const m = /^\/(\w+)\/(sets|cards)(?:\/(.+))?$/.exec(decoded);
    const file = m && (m[3] ? `${m[2]}/${m[1]}/${m[3]}.json` : `${m[2]}.${m[1]}.json`);
    try {
      return file ? new Response(read(file)) : new Response('not found', { status: 404 });
    } catch {
      return new Response('not found', { status: 404 });
    }
  };
}

/** A client without pacing: tests do not wait. */
export const testClient = (fetchFn: Fetch, attempts = 3) =>
  new TcgdexClient(fetchFn, { intervalMs: 0, retryDelayMs: 0, attempts });
