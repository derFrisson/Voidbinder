import type { BlobStore } from '@voidbinder/core';
import { chunkKey, USER_AGENT, type Fetch } from '../scryfall/source';
import type { YgoSet } from './types';

export { chunkKey, deletePrefix, readChunk, type Fetch } from '../scryfall/source';

// Reading from YGOPRODeck (https://ygoprodeck.com/api-guide/, checked 2026-10-10): the whole
// catalog is one `cardinfo.php` response per language (a few MB, gzip on the wire), the sets one
// `cardsets.php` response. The guide allows 20 requests per second and blocks an IP for an hour
// above that; a run makes one request per step (three with `en` and `de`), minutes apart in
// practice and never per card. Images are never fetched here: their URLs go to `external_ids`
// for the image mirror (VB-57), which downloads each once.

const API = 'https://db.ygoprodeck.com/api/v7';

async function get(fetchFn: Fetch, url: string): Promise<Response> {
  const res = await fetchFn(url, {
    headers: { 'User-Agent': USER_AGENT, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`GET ${url} answered ${res.status}`);
  return res;
}

/** English with `misc=yes` (TCG/OCG dates and formats, `?` stats); other languages by `language=`. */
export const cardinfoUrl = (lang: string) =>
  `${API}/cardinfo.php?${lang === 'en' ? 'misc=yes' : `language=${lang}`}`;

/**
 * Stores one language's full `cardinfo.php` response gzip-compressed (the raw dump, ADR 0003).
 * The answer is chunked (no Content-Length), which R2 cannot take as a stream, so it is read
 * whole (about 25 MB) first.
 */
export async function downloadCardinfo(
  fetchFn: Fetch,
  blobs: BlobStore,
  lang: string,
  key: string,
) {
  const body = await (await get(fetchFn, cardinfoUrl(lang))).arrayBuffer();
  const gz = await new Response(
    new Blob([body]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer();
  const info = await blobs.put(key, new Uint8Array(gz), { contentType: 'application/gzip' });
  return { key, size: info.size };
}

/**
 * The objects of the top-level `data` array of a (gzip) JSON document, one JSON text each,
 * read incrementally: only the current chunk and one partial object are held in memory. A
 * minimal scanner (depth and string state), not a parser; the objects are parsed by the caller.
 */
export async function* dataObjects(
  body: ReadableStream<Uint8Array>,
  { gzip }: { gzip: boolean },
): AsyncGenerator<string> {
  const bytes = gzip ? body.pipeThrough(new DecompressionStream('gzip')) : body;
  const reader = bytes.pipeThrough(new TextDecoderStream()).getReader();
  // `{` for objects, `[` for arrays; the cards are the objects directly in the root's array.
  const stack: number[] = [];
  let inString = false;
  let escaped = false;
  let pending = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const text = pending + value;
    let start = pending ? 0 : -1;
    // The pending part was scanned with the previous chunk: continue after it.
    for (let i = pending.length; i < text.length; i++) {
      const c = text.charCodeAt(i);
      if (inString) {
        if (escaped) escaped = false;
        else if (c === 92) escaped = true;
        else if (c === 34) inString = false;
      } else if (c === 34) inString = true;
      else if (c === 123) {
        if (stack.length === 2 && stack[1] === 91) start = i;
        stack.push(c);
      } else if (c === 91) stack.push(c);
      else if (c === 125 || c === 93) {
        stack.pop();
        if (c === 125 && stack.length === 2 && stack[1] === 91 && start >= 0) {
          // Raw line breaks can only be whitespace between tokens (JSON strings escape them).
          yield text.slice(start, i + 1).replace(/[\r\n]+/g, ' ');
          start = -1;
        }
      }
    }
    pending = start >= 0 ? text.slice(start) : '';
  }
}

/**
 * Splits a raw `cardinfo` dump into chunks of `chunkLines` objects, one JSON object per line, so
 * each Workflow step reads only its own part.
 */
export async function splitCardinfo(
  blobs: BlobStore,
  rawKey: string,
  prefix: string,
  chunkLines: number,
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
  for await (const line of dataObjects(raw.body as ReadableStream<Uint8Array>, { gzip: true })) {
    lines++;
    buffer.push(line);
    if (buffer.length === chunkLines) await flush();
  }
  if (buffer.length) await flush();
  // An answer without cards (an error object, a changed shape) must fail the run, not finish it.
  if (!lines) throw new Error(`${rawKey} holds no cards`);
  return { chunks, lines };
}

/** All sets, raw copy kept. The answer is a bare array. */
export async function fetchSets(fetchFn: Fetch, blobs: BlobStore, key: string): Promise<YgoSet[]> {
  const text = await (await get(fetchFn, `${API}/cardsets.php`)).text();
  const sets = JSON.parse(text) as unknown;
  if (!Array.isArray(sets) || !sets.length) throw new Error('cardsets.php answered no sets');
  await blobs.put(key, text, { contentType: 'application/json' });
  return sets as YgoSet[];
}
