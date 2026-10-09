import type { BlobStore } from '@voidbinder/core';
import { jsonLines } from '../util';
import type { ScryfallBulkData, ScryfallList, ScryfallSet } from './types';

// Reading from Scryfall (https://scryfall.com/docs/api/bulk-data, checked 2026-10-09): the bulk
// files are gzip-compressed JSON Lines on data.scryfall.io (no rate limit); the API asks for a
// descriptive User-Agent and at most 10 requests per second, which two requests per run respect.

export const USER_AGENT = 'Voidbinder/0.1 (+https://voidbinder.de)';
const API = 'https://api.scryfall.com';

export type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

async function get(fetchFn: Fetch, url: string): Promise<Response> {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return res;
}

export type BulkFiles = Record<'default_cards' | 'all_cards', string>;

/** Today's download URIs of the two bulk files the importer reads. */
export async function bulkFiles(fetchFn: Fetch): Promise<BulkFiles> {
  const list = (await (
    await get(fetchFn, `${API}/bulk-data`)
  ).json()) as ScryfallList<ScryfallBulkData>;
  const uri = (type: string) => {
    const file = list.data.find((b) => b.type === type);
    if (!file) throw new Error(`Scryfall bulk-data has no ${type}`);
    return file.jsonl_download_uri;
  };
  return { default_cards: uri('default_cards'), all_cards: uri('all_cards') };
}

/** Streams a bulk file into the blob store unchanged (the raw dump, ADR 0003). */
export async function download(fetchFn: Fetch, blobs: BlobStore, uri: string, key: string) {
  const res = await get(fetchFn, uri);
  if (!res.body) throw new Error(`GET ${uri} has no body`);
  const info = await blobs.put(key, res.body, { contentType: 'application/gzip' });
  return { key, size: info.size };
}

export const chunkKey = (prefix: string, index: number) =>
  `${prefix}/${String(index).padStart(5, '0')}.jsonl`;

/**
 * Splits a raw `.jsonl.gz` dump into uncompressed chunks of `chunkLines` lines that pass `keep`,
 * streaming: the dump is never held in memory. The chunks let each Workflow step read only its
 * own part.
 */
export async function split(
  blobs: BlobStore,
  rawKey: string,
  prefix: string,
  chunkLines: number,
  keep: (line: string) => boolean = () => true,
) {
  const raw = await blobs.get(rawKey);
  if (!raw) throw new Error(`${rawKey} is missing`);
  let buffer: string[] = [];
  let chunks = 0;
  let lines = 0;
  const flush = async () => {
    await blobs.put(chunkKey(prefix, chunks++), `${buffer.join('\n')}\n`, {
      contentType: 'application/x-ndjson',
    });
    buffer = [];
  };
  for await (const line of jsonLines(raw.body as ReadableStream<Uint8Array>, { gzip: true })) {
    if (!keep(line)) continue;
    lines++;
    buffer.push(line);
    if (buffer.length === chunkLines) await flush();
  }
  if (buffer.length) await flush();
  return { chunks, lines };
}

/** A filter on the object's top-level `lang` without parsing the whole line. */
export function langFilter(languages: string[]): (line: string) => boolean {
  const wanted = new Set(languages);
  // `lang` precedes card_faces and all_parts in Scryfall's objects, which carry no `lang`.
  return (line) => wanted.has(/"lang":"([^"]+)"/.exec(line)?.[1] ?? '');
}

export async function readChunk(blobs: BlobStore, key: string): Promise<string[]> {
  const chunk = await blobs.get(key);
  if (!chunk) throw new Error(`${key} is missing`);
  const text = await new Response(chunk.body as ReadableStream<Uint8Array>).text();
  return text.split('\n').filter((l) => l.trim());
}

/** All sets (one page today; follows `next_page` if Scryfall starts paging), raw copy kept. */
export async function fetchSets(
  fetchFn: Fetch,
  blobs: BlobStore,
  key: string,
): Promise<ScryfallSet[]> {
  const all: ScryfallSet[] = [];
  let url: string | undefined = `${API}/sets`;
  let raw = '';
  while (url) {
    const text = await (await get(fetchFn, url)).text();
    raw += `${text}\n`;
    const page = JSON.parse(text) as ScryfallList<ScryfallSet> & { next_page?: string };
    all.push(...page.data);
    url = page.has_more ? page.next_page : undefined;
  }
  await blobs.put(key, raw, { contentType: 'application/json' });
  return all;
}

/** Deletes every blob under `prefix` (the run's chunks once it succeeded). */
export async function deletePrefix(blobs: BlobStore, prefix: string) {
  let cursor: string | undefined;
  let deleted = 0;
  do {
    const page = await blobs.list(prefix, cursor);
    await Promise.all(page.objects.map((o) => blobs.delete(o.key)));
    deleted += page.objects.length;
    cursor = page.cursor;
  } while (cursor);
  return deleted;
}
