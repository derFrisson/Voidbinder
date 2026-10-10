import { describe, expect, it } from 'vitest';
import { dataObjects } from './source';
import { fixture } from './test-fixtures';

/** The text as a byte stream in chunks of `size` bytes: the boundaries fall anywhere. */
function chunked(text: string, size: number) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (let i = 0; i < bytes.length; i += size) controller.enqueue(bytes.slice(i, i + size));
      controller.close();
    },
  });
}

const collect = async (body: ReadableStream<Uint8Array>, gzip = false) => {
  const out: string[] = [];
  for await (const line of dataObjects(body, { gzip })) out.push(line);
  return out;
};

describe('dataObjects', () => {
  const text = fixture('cardinfo_en.json');
  const expected = (JSON.parse(text) as { data: unknown[] }).data.map((c) => JSON.stringify(c));

  // Size 1 streams the fixture byte by byte: about 1 s locally, over 5 s on a busy CI runner.
  it.each([1, 7, 100, 4096, 1_000_000])(
    'splits the cards whatever the chunk size (%i)',
    { timeout: 30_000 },
    async (size) => {
      const lines = await collect(chunked(text, size));
      expect(lines.map((l) => JSON.stringify(JSON.parse(l)))).toEqual(expected);
      expect(lines.every((l) => !l.includes('\n'))).toBe(true);
    },
  );

  it('reads a gzip stream', async () => {
    const gz = new Blob([text]).stream().pipeThrough(new CompressionStream('gzip'));
    expect(await collect(gz, true)).toHaveLength(expected.length);
  });

  it('is not confused by braces, brackets, quotes and escapes inside strings', async () => {
    const tricky = [
      { id: 1, desc: 'a } ] { [ "quoted" \\ backslash \\" end', nested: { list: [{ x: '}' }] } },
      { id: 2, desc: '' },
    ];
    const lines = await collect(chunked(JSON.stringify({ data: tricky }), 5));
    expect(lines.map((l) => JSON.parse(l))).toEqual(tricky);
  });

  it('reads only the objects of the root array, and none from an answer without it', async () => {
    const doc = '{"meta":{"rows":[{"a":1}]},"data":[{"id":1}]}';
    expect(await collect(chunked(doc, 3))).toEqual(['{"id":1}']);
    expect(await collect(chunked('{"error":"too many requests"}', 3))).toEqual([]);
  });
});
