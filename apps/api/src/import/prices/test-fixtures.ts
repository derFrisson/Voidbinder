import { existsSync, readFileSync } from 'node:fs';
import type { Fetch } from '../scryfall/source';

// The TCGCSV fixtures (test/fixtures/tcgcsv/, hand-written in the shape of its answers) behind a
// fake `fetch`. No network in tests.

const dir = new URL('../../../test/fixtures/tcgcsv/', import.meta.url);
export const tcgcsvFixture = (path: string): string =>
  readFileSync(new URL(path, dir).pathname, 'utf8');

export interface FakeTcgcsv {
  /** Contents of last-updated.txt. */
  lastUpdated?: string;
  /** Replaces a file: `1/2864/prices` → answer text. */
  files?: Record<string, string>;
  /** Every requested URL, in order. */
  requests?: string[];
  /** User-Agent of every request. */
  userAgents?: string[];
}

/** `https://tcgcsv.com/tcgplayer/<path>` → `<path>.json` of the fixtures; anything else 404. */
export function fakeTcgcsv(opts: FakeTcgcsv = {}): Fetch {
  return async (url, init) => {
    opts.requests?.push(url);
    opts.userAgents?.push(new Headers(init?.headers).get('User-Agent') ?? '');
    if (url === 'https://tcgcsv.com/last-updated.txt')
      return new Response(opts.lastUpdated ?? tcgcsvFixture('last-updated.txt'));
    const path = url.replace('https://tcgcsv.com/tcgplayer/', '');
    const replaced = opts.files?.[path];
    if (replaced !== undefined) return new Response(replaced);
    const file = new URL(`${path}.json`, dir).pathname;
    return existsSync(file)
      ? new Response(readFileSync(file, 'utf8'))
      : new Response('not found', { status: 404 });
  };
}
