import type { BlobInfo, BlobPutOptions, BlobStore, ByteStream } from '@voidbinder/core';
import { readFileSync } from 'node:fs';
import type { Fetch } from './source';

// Test doubles for the Scryfall import: the fixture files behind a fake `fetch`, and blobs in
// memory. No network in tests.

const dir = new URL('../../../test/fixtures/scryfall/', import.meta.url);
export const fixture = (name: string): string => readFileSync(new URL(name, dir).pathname, 'utf8');

export function gzip(text: string): ReadableStream<Uint8Array> {
  return new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
}

export interface FakeScryfall {
  defaultCards?: string;
  allCards?: string;
  /** Status of `GET /sets` (500 simulates an outage mid-run). */
  setsStatus?: number;
}

/** `fetch` answering the bulk-data index, the two bulk files and `/sets` from the fixtures. */
export function fakeScryfall(opts: FakeScryfall = {}): Fetch {
  const files: Record<string, () => Response> = {
    'https://api.scryfall.com/bulk-data': () =>
      Response.json({
        has_more: false,
        data: ['default_cards', 'all_cards'].map((type) => ({
          type,
          updated_at: '2026-10-09T21:05:47.389+00:00',
          jsonl_download_uri: `https://data.test/${type}.jsonl.gz`,
          compressed_size: 0,
        })),
      }),
    'https://data.test/default_cards.jsonl.gz': () =>
      new Response(gzip(opts.defaultCards ?? fixture('default_cards.jsonl'))),
    'https://data.test/all_cards.jsonl.gz': () =>
      new Response(gzip(opts.allCards ?? fixture('all_cards.jsonl'))),
    'https://api.scryfall.com/sets': () =>
      new Response(fixture('sets.json'), { status: opts.setsStatus ?? 200 }),
  };
  return async (url) => files[url]?.() ?? new Response('not found', { status: 404 });
}

export class MemoryBlobStore implements BlobStore {
  readonly objects = new Map<string, { bytes: Uint8Array; info: BlobInfo }>();

  async put(key: string, body: ByteStream | Uint8Array | string, options: BlobPutOptions) {
    const bytes =
      typeof body === 'string'
        ? new TextEncoder().encode(body)
        : body instanceof Uint8Array
          ? body
          : new Uint8Array(await new Response(body as ReadableStream).arrayBuffer());
    const info: BlobInfo = {
      key,
      size: bytes.length,
      etag: `"${key}"`,
      uploaded: new Date(),
      contentType: options.contentType,
    };
    this.objects.set(key, { bytes, info });
    return info;
  }

  async get(key: string) {
    const o = this.objects.get(key);
    return o ? { ...o.info, body: new Blob([o.bytes as Uint8Array<ArrayBuffer>]).stream() } : null;
  }

  async head(key: string) {
    return this.objects.get(key)?.info ?? null;
  }

  async delete(key: string) {
    this.objects.delete(key);
  }

  async list(prefix: string) {
    const objects = [...this.objects.values()]
      .map((o) => o.info)
      .filter((i) => i.key.startsWith(prefix));
    return { objects };
  }
}
