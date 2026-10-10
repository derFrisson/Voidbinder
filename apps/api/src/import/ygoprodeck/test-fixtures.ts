import { readFileSync } from 'node:fs';
import { banlistDatesUrl } from './banlist-dates';
import type { Fetch } from './source';

export { MemoryBlobStore } from '../scryfall/test-fixtures';

// Test doubles for the YGOPRODeck import: the fixture files behind a fake `fetch`. No network in
// tests. The fixtures are real API objects (YGOPRODeck, 2026-10-10) with `card_prices` and the
// view counters dropped, the card_sets and card_images trimmed, and two invented set codes: Blue-Eyes
// White Dragon's `LOB-DE001` (a German variant of `LOB-EN001`) and Raigeki's `LOB-DE099` (a German
// code with no English print), since the live API lists English codes only. `yugipedia_*.json`
// have the shape of Yugipedia's `action=ask` answer with hand-picked titles and dates (VB-81).

const dir = new URL('../../../test/fixtures/ygoprodeck/', import.meta.url);
export const fixture = (name: string): string => readFileSync(new URL(name, dir).pathname, 'utf8');

export interface FakeYgoprodeck {
  en?: string;
  de?: string;
  /** Status of `cardsets.php` (500 simulates an outage mid-run). */
  setsStatus?: number;
  /** Status of the Yugipedia ban list dates (500: the lookup fails, the run goes on). */
  datesStatus?: number;
  /** Receives every requested URL. */
  requests?: string[];
}

/**
 * `fetch` answering `cardinfo.php` (English, German), `cardsets.php` and the Yugipedia ban list
 * dates from the fixtures.
 */
export function fakeYgoprodeck(opts: FakeYgoprodeck = {}): Fetch {
  const base = 'https://db.ygoprodeck.com/api/v7';
  const files: Record<string, () => Response> = {
    [`${base}/cardinfo.php?misc=yes`]: () => new Response(opts.en ?? fixture('cardinfo_en.json')),
    [`${base}/cardinfo.php?language=de`]: () =>
      new Response(opts.de ?? fixture('cardinfo_de.json')),
    [`${base}/cardsets.php`]: () =>
      new Response(fixture('cardsets.json'), { status: opts.setsStatus ?? 200 }),
    [banlistDatesUrl('tcg')]: () =>
      new Response(fixture('yugipedia_tcg.json'), { status: opts.datesStatus ?? 200 }),
    [banlistDatesUrl('ocg')]: () =>
      new Response(fixture('yugipedia_ocg.json'), { status: opts.datesStatus ?? 200 }),
  };
  return async (url) => {
    opts.requests?.push(url);
    return files[url]?.() ?? new Response('not found', { status: 404 });
  };
}
