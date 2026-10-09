// Helpers every catalog importer uses (Scryfall now; Yu-Gi-Oh! and Pokémon copy the pattern).

/** Splits `items` into consecutive slices of at most `size`. */
export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

/** JSON with object keys sorted at every level, so equal payloads always serialize equally. */
export function stableJson(value: unknown): string {
  return JSON.stringify(value, (_key, v: unknown) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)))
      : v,
  );
}

/** Hex SHA-256 of the normalized payload: the `source_hash` that decides whether a row changed. */
export async function sourceHash(value: unknown): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stableJson(value)));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * The lines of a (gzip-compressed) JSON Lines stream, read incrementally: only the current chunk
 * and one partial line are held in memory.
 */
export async function* jsonLines(
  body: ReadableStream<Uint8Array>,
  { gzip }: { gzip: boolean },
): AsyncGenerator<string> {
  const bytes = gzip ? body.pipeThrough(new DecompressionStream('gzip')) : body;
  const reader = bytes.pipeThrough(new TextDecoderStream()).getReader();
  let rest = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    const parts = (rest + value).split('\n');
    rest = parts.pop() ?? '';
    for (const line of parts) if (line.trim()) yield line;
  }
  if (rest.trim()) yield rest;
}
