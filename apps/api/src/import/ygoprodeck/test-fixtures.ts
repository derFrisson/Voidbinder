import { readFileSync } from 'node:fs';
import type { Fetch } from './source';

export { MemoryBlobStore } from '../scryfall/test-fixtures';

// Test doubles for the YGOPRODeck import: the fixture files behind a fake `fetch`. No network in
// tests. The fixtures are real API objects (YGOPRODeck, 2026-10-10) with `card_prices` and the
// view counters dropped, the card_sets and card_images trimmed, and two invented set codes: Blue-Eyes
// White Dragon's `LOB-DE001` (a German variant of `LOB-EN001`) and Raigeki's `LOB-DE099` (a German
// code with no English print), since the live API lists English codes only.

const dir = new URL('../../../test/fixtures/ygoprodeck/', import.meta.url);
export const fixture = (name: string): string => readFileSync(new URL(name, dir).pathname, 'utf8');

export interface FakeYgoprodeck {
  en?: string;
  de?: string;
  /** Status of `cardsets.php` (500 simulates an outage mid-run). */
  setsStatus?: number;
  /** Receives every requested URL. */
  requests?: string[];
}

/** `fetch` answering `cardinfo.php` (English, German) and `cardsets.php` from the fixtures. */
export function fakeYgoprodeck(opts: FakeYgoprodeck = {}): Fetch {
  const base = 'https://db.ygoprodeck.com/api/v7';
  const files: Record<string, () => Response> = {
    [`${base}/cardinfo.php?misc=yes`]: () => new Response(opts.en ?? fixture('cardinfo_en.json')),
    [`${base}/cardinfo.php?language=de`]: () =>
      new Response(opts.de ?? fixture('cardinfo_de.json')),
    [`${base}/cardsets.php`]: () =>
      new Response(fixture('cardsets.json'), { status: opts.setsStatus ?? 200 }),
  };
  return async (url) => {
    opts.requests?.push(url);
    return files[url]?.() ?? new Response('not found', { status: 404 });
  };
}
