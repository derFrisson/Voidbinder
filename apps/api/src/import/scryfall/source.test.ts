import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { bulkFiles, type Fetch } from './source';

const list = JSON.stringify({
  data: [
    { type: 'default_cards', jsonl_download_uri: 'https://data/d.jsonl.gz' },
    { type: 'all_cards', jsonl_download_uri: 'https://data/a.jsonl.gz' },
  ],
});

/** A fetch that answers the given statuses in order, then 200 with the bulk list. */
const flaky = (...statuses: Array<[number, Record<string, string>?]>) => {
  const fn = vi.fn<Fetch>(async () => {
    const next = statuses.shift();
    return next
      ? new Response('slow down', { status: next[0], headers: next[1] ?? {} })
      : new Response(list);
  });
  return fn;
};

describe('Scryfall 429 backoff', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('retries after a 429 without Retry-After (1 s)', async () => {
    const fn = flaky([429]);
    const done = bulkFiles(fn);
    await vi.advanceTimersByTimeAsync(999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await done).toEqual({
      default_cards: 'https://data/d.jsonl.gz',
      all_cards: 'https://data/a.jsonl.gz',
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('honours Retry-After', async () => {
    const fn = flaky([429, { 'Retry-After': '5' }]);
    const done = bulkFiles(fn);
    await vi.advanceTimersByTimeAsync(4999);
    expect(fn).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('gives up after 3 attempts', async () => {
    const fn = flaky([429], [429], [429]);
    const done = bulkFiles(fn);
    const assertion = expect(done).rejects.toThrow('answered 429');
    await vi.advanceTimersByTimeAsync(10_000);
    await assertion;
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('does not retry other errors', async () => {
    const fn = flaky([500]);
    await expect(bulkFiles(fn)).rejects.toThrow('answered 500');
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
