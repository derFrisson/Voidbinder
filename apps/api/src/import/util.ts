// Helpers every catalog importer uses (Scryfall now; Yu-Gi-Oh! and Pokémon copy the pattern).

/** What an importer needs to purge the API's edge cache (README "Caching"); absent in tests. */
export interface EdgeCacheDeps {
  /** Purges the edge-cached responses with these `Cache-Tag`s; never throws. */
  purgeCache?(tags: string[]): Promise<void>;
  /** Waits durably (Workflows `step.sleep`). */
  sleep?(name: string, seconds: number): Promise<void>;
}

/** `max_age` and `stale_while_revalidate` of the `HYPERDRIVE_CACHED` configs (docs/environments.md). */
export const HYPERDRIVE_MAX_AGE = 300;
export const HYPERDRIVE_SWR = 60;
/**
 * The wait before a purge: the Hyperdrive window plus a minute, so a refill that started in the
 * window's last second has landed at the edge before the purge removes it (420 s, ADR 0004).
 */
export const PURGE_WAIT_SECONDS = HYPERDRIVE_MAX_AGE + HYPERDRIVE_SWR + 60;

/**
 * The last step of a run that changed the catalog or the prices: purges the API's edge cache by
 * tag. It first waits out the Hyperdrive-cached reads (PURGE_WAIT_SECONDS), which would otherwise
 * refill the edge with the rows from before the import for another ten minutes.
 */
export async function purgeEdgeCache(
  deps: EdgeCacheDeps,
  step: <T>(name: string, fn: () => Promise<T>) => Promise<T>,
  tags: string[],
): Promise<void> {
  await deps.sleep?.('wait for the Hyperdrive cache', PURGE_WAIT_SECONDS);
  await step('purge cache', async () => deps.purgeCache?.(tags));
}

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
