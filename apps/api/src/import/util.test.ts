import { describe, expect, it } from 'vitest';
import { fixture, gzip } from './scryfall/test-fixtures';
import { batches, jsonLines, sourceHash } from './util';

async function collect(lines: AsyncIterable<string>) {
  const out: string[] = [];
  for await (const line of lines) out.push(line);
  return out;
}

describe('jsonLines', () => {
  const text = fixture('default_cards.jsonl');

  it('streams the gzipped fixture line by line', async () => {
    const lines = await collect(jsonLines(gzip(text), { gzip: true }));
    expect(lines).toHaveLength(30);
    expect(lines.map((l) => (JSON.parse(l) as { id: string }).id)).toHaveLength(30);
  });

  it('joins lines split across chunks and keeps a last line without newline', async () => {
    const bytes = new TextEncoder().encode(text.trimEnd());
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < bytes.length; i += 97) controller.enqueue(bytes.slice(i, i + 97));
        controller.close();
      },
    });
    expect(await collect(jsonLines(stream, { gzip: false }))).toEqual(text.trimEnd().split('\n'));
  });
});

describe('batches and sourceHash', () => {
  it('splits into ranges of at most the batch size', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 500)).toEqual([]);
  });

  it('hashes equal payloads equally whatever their key order', async () => {
    expect(await sourceHash({ a: 1, b: { c: [1, 2], d: null } })).toBe(
      await sourceHash({ b: { d: null, c: [1, 2] }, a: 1 }),
    );
    expect(await sourceHash({ a: 1 })).not.toBe(await sourceHash({ a: 2 }));
  });
});
