import { describe, expect, it } from 'vitest';
import { MemoryBlobStore } from '../scryfall/test-fixtures';
import { USER_AGENT } from '../scryfall/source';
import {
  cents,
  EMPTY,
  extended,
  fetchRaw,
  finishOf,
  lastUpdated,
  results,
  type TcgPrice,
  type TcgProduct,
} from './tcgcsv';
import { fakeTcgcsv, tcgcsvFixture } from './test-fixtures';

describe('TCGCSV parsing', () => {
  it('reads products with their extended data and prices without totalItems', () => {
    const products = results<TcgProduct>(tcgcsvFixture('3/604/products.json'), 'products');
    expect(products).toHaveLength(6);
    expect(extended(products[0] as TcgProduct, 'Number')).toBe('001/102');
    expect(extended(products[5] as TcgProduct, 'Number')).toBeNull();
    const prices = results<TcgPrice>(tcgcsvFixture('3/604/prices.json'), 'prices');
    expect(prices[0]).toMatchObject({ productId: 42346, subTypeName: 'Holofoil' });
  });

  it('fails on an unsuccessful answer instead of reading no prices', () => {
    expect(() => results('{"success":false,"errors":["boom"],"results":[]}', 'prices 1')).toThrow(
      'prices 1: ["boom"]',
    );
    expect(() => results('{"success":true}', 'prices 1')).toThrow();
  });

  it('turns dollars into integer cents', () => {
    expect(cents(70.76)).toBe(7076);
    expect(cents(0.29)).toBe(29);
    expect(cents(9999)).toBe(999900);
    expect(cents(null)).toBeNull();
  });

  it('names printings as catalog finishes', () => {
    expect(finishOf('Normal')).toBe('normal');
    expect(finishOf('Unlimited')).toBe('normal');
    expect(finishOf('Holofoil')).toBe('holo');
    expect(finishOf('Reverse Holofoil')).toBe('reverse');
    expect(finishOf('1st Edition')).toBe('first_edition');
    expect(finishOf('Limited Edition')).toBe('limited_edition');
  });

  it('reads last-updated.txt as an ISO timestamp', async () => {
    expect(await lastUpdated(fakeTcgcsv(), 0)).toBe('2026-10-09T20:05:19.000Z');
    await expect(lastUpdated(fakeTcgcsv({ lastUpdated: 'soon' }), 0)).rejects.toThrow();
  });

  it('reads a missing group file as empty only where that is allowed', async () => {
    const blobs = new MemoryBlobStore();
    const path = '/tcgplayer/1/1/products';
    expect(await fetchRaw(fakeTcgcsv(), blobs, path, 'k', 0, true)).toBe(EMPTY);
    expect(blobs.objects.size).toBe(0);
    await expect(fetchRaw(fakeTcgcsv(), blobs, path, 'k', 0)).rejects.toThrow('answered 404');
  });

  it('keeps the raw answer gzip-compressed and sends the User-Agent', async () => {
    const blobs = new MemoryBlobStore();
    const userAgents: string[] = [];
    const text = await fetchRaw(
      fakeTcgcsv({ userAgents }),
      blobs,
      '/tcgplayer/1/groups',
      'raw/dev/tcgcsv/2026-10-09/1/groups.json.gz',
      0,
    );
    expect(userAgents).toEqual([USER_AGENT]);
    const stored = await blobs.get('raw/dev/tcgcsv/2026-10-09/1/groups.json.gz');
    const body = (stored?.body as ReadableStream).pipeThrough(new DecompressionStream('gzip'));
    expect(await new Response(body).text()).toBe(text);
  });
});
